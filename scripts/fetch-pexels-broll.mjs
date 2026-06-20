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
const SEARCH_URL = "https://api.pexels.com/videos/search";

// Load .env (Node 20.12+/21+). The key lives only in the gitignored .env file.
try {
  process.loadEnvFile(resolve(repoRoot, ".env"));
} catch {
  // No .env file; fall back to the ambient environment.
}

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

function createFetchHttpClient() {
  return {
    async get(url, options = {}) {
      return fetchWithTimeout(url, options, options.timeoutMs ?? 30000);
    }
  };
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

export function pickPortraitRendition(videoFiles) {
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

export async function fetchPexelsBroll({
  httpClient = createFetchHttpClient(),
  query = "abstract dark cinematic",
  count = 3,
  outDir,
  apiKey,
  timeoutMs = 30000,
  downloadTimeoutMs = 120000,
  logger = console
}) {
  if (!apiKey) {
    logger.log("[pexels] PEXELS_API_KEY is not set; skipping b-roll fetch (no failure).");
    return {
      skipped: true,
      saved: [],
      errors: []
    };
  }

  const normalizedQuery = String(query).trim() || "abstract dark cinematic";
  const normalizedCount = Math.min(Math.max(Number.parseInt(String(count), 10) || 3, 1), 5);
  const resolvedOutDir = resolve(outDir);
  mkdirSync(resolvedOutDir, { recursive: true });

  const searchUrl = `${SEARCH_URL}?query=${encodeURIComponent(normalizedQuery)}&orientation=portrait&per_page=${normalizedCount}&size=medium`;
  logger.log(`[pexels] searching: "${normalizedQuery}" (portrait, up to ${normalizedCount}) -> ${resolvedOutDir}`);

  let res;
  try {
    res = await httpClient.get(searchUrl, {
      headers: { Authorization: apiKey },
      timeoutMs
    });
  } catch (error) {
    const message = `[pexels] search request failed: ${error.message}`;
    logger.log(message);
    return {
      skipped: false,
      saved: [],
      errors: [message]
    };
  }

  if (!res.ok) {
    const message = `[pexels] search failed: HTTP ${res.status} (check the API key / rate limit).`;
    logger.log(message);
    return {
      skipped: false,
      saved: [],
      errors: [message]
    };
  }

  const data = await res.json();
  const videos = Array.isArray(data.videos) ? data.videos : [];
  if (videos.length === 0) {
    logger.log(`[pexels] no results for "${normalizedQuery}".`);
    return {
      skipped: false,
      saved: [],
      errors: []
    };
  }

  const saved = [];
  const errors = [];
  for (const video of videos) {
    const rendition = pickPortraitRendition(video.video_files);
    if (!rendition) {
      continue;
    }
    const dest = resolve(resolvedOutDir, `pexels-${video.id}.mp4`);
    if (existsSync(dest)) {
      logger.log(`[pexels] cached: pexels-${video.id}.mp4`);
      saved.push(dest);
      continue;
    }
    const result = await download(httpClient, rendition.link, dest, downloadTimeoutMs, logger);
    if (result.ok) {
      logger.log(`[pexels] saved: pexels-${video.id}.mp4 (${rendition.width}x${rendition.height})`);
      saved.push(dest);
    } else {
      errors.push(result.error);
    }
  }

  logger.log(`\n[pexels] done: ${saved.length} clip(s) available in ${resolvedOutDir}`);

  return {
    skipped: false,
    saved,
    errors
  };
}

async function download(httpClient, link, dest, timeoutMs, logger) {
  try {
    const res = await httpClient.get(link, { timeoutMs });
    if (!res.ok) {
      const error = `[pexels] download failed: HTTP ${res.status}`;
      logger.log(error);
      return { ok: false, error };
    }

    const contentType = getHeader(res, "content-type");
    if (!contentType.toLowerCase().startsWith("video/")) {
      const error = `[pexels] invalid download content-type: ${contentType || "missing"}`;
      logger.log(error);
      return { ok: false, error };
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length === 0) {
      const error = "[pexels] invalid download body: empty video response";
      logger.log(error);
      return { ok: false, error };
    }

    writeFileSync(dest, buffer);
    return { ok: true };
  } catch (error) {
    const message = `[pexels] download error: ${error.message}`;
    logger.log(message);
    return { ok: false, error: message };
  }
}

function getHeader(response, name) {
  if (typeof response.headers?.get === "function") {
    return response.headers.get(name) ?? "";
  }

  return response.headers?.[name] ?? response.headers?.[name.toLowerCase()] ?? "";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await fetchPexelsBroll({
    query: args.query,
    count: args.count,
    outDir: resolve(repoRoot, args.out),
    apiKey: process.env.PEXELS_API_KEY
  });

  if (result.errors.length > 0) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
