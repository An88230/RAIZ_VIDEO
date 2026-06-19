#!/usr/bin/env node
// Optional Pexels b-roll fetcher for RAIZ. Enriches the local b-roll pool with
// vertical (portrait) clips. Safe by design:
//   - if PEXELS_API_KEY is missing, it warns and exits 0 (never fails the flow)
//   - portrait orientation only, capped clip count, timeboxed network calls
//   - already-downloaded clips are skipped (cached)
//
// Usage:
//   node scripts/fetch-pexels-broll.mjs --query="dark abstract" [--count=3] [--out=storage/assets/broll]

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Load .env (Node 20.12+/21+). The key lives only in the gitignored .env file.
try {
  process.loadEnvFile(resolve(repoRoot, ".env"));
} catch {
  // No .env file; fall back to the ambient environment.
}

const SEARCH_URL = "https://api.pexels.com/videos/search";

function parseArgs(argv) {
  // Default to a dedicated subfolder so Pexels clips stay separate from the
  // user's curated pool. Point a job's broll_folder here to use them.
  const args = { query: "abstract dark cinematic", count: "3", out: "storage/assets/broll/pexels" };
  for (const token of argv) {
    const match = /^--([^=]+)=(.*)$/.exec(token);
    if (match) {
      args[match[1]] = match[2];
    }
  }
  return args;
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function pickPortraitRendition(videoFiles) {
  if (!Array.isArray(videoFiles)) {
    return null;
  }
  const withLink = videoFiles.filter((file) => file && file.link && file.width && file.height);
  const portrait = withLink.filter((file) => file.height > file.width);
  const pool = portrait.length > 0 ? portrait : withLink;
  if (pool.length === 0) {
    return null;
  }
  // Prefer a rendition whose width is closest to 1080 (avoids huge 4K downloads).
  pool.sort((a, b) => Math.abs(a.width - 1080) - Math.abs(b.width - 1080));
  return pool[0];
}

async function download(link, dest, timeoutMs) {
  try {
    const res = await fetchWithTimeout(link, {}, timeoutMs);
    if (!res.ok) {
      console.log(`[pexels] download failed: HTTP ${res.status}`);
      return false;
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    writeFileSync(dest, buffer);
    return true;
  } catch (error) {
    console.log(`[pexels] download error: ${error.message}`);
    return false;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const key = process.env.PEXELS_API_KEY;

  if (!key) {
    console.log("[pexels] PEXELS_API_KEY is not set; skipping b-roll fetch (no failure).");
    return;
  }

  const query = String(args.query).trim() || "abstract dark cinematic";
  const count = Math.min(Math.max(Number.parseInt(args.count, 10) || 3, 1), 5);
  const outDir = resolve(repoRoot, args.out);
  mkdirSync(outDir, { recursive: true });

  const searchUrl = `${SEARCH_URL}?query=${encodeURIComponent(query)}&orientation=portrait&per_page=${count}&size=medium`;
  console.log(`[pexels] searching: "${query}" (portrait, up to ${count}) -> ${outDir}`);

  let res;
  try {
    res = await fetchWithTimeout(searchUrl, { headers: { Authorization: key } }, 30000);
  } catch (error) {
    console.log(`[pexels] search request failed: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  if (!res.ok) {
    console.log(`[pexels] search failed: HTTP ${res.status} (check the API key / rate limit).`);
    process.exitCode = 1;
    return;
  }

  const data = await res.json();
  const videos = Array.isArray(data.videos) ? data.videos : [];
  if (videos.length === 0) {
    console.log(`[pexels] no results for "${query}".`);
    return;
  }

  const saved = [];
  for (const video of videos) {
    const rendition = pickPortraitRendition(video.video_files);
    if (!rendition) {
      continue;
    }
    const dest = resolve(outDir, `pexels-${video.id}.mp4`);
    if (existsSync(dest)) {
      console.log(`[pexels] cached: pexels-${video.id}.mp4`);
      saved.push(dest);
      continue;
    }
    const ok = await download(rendition.link, dest, 120000);
    if (ok) {
      console.log(`[pexels] saved: pexels-${video.id}.mp4 (${rendition.width}x${rendition.height})`);
      saved.push(dest);
    }
  }

  console.log(`\n[pexels] done: ${saved.length} clip(s) available in ${outDir}`);
}

await main();
