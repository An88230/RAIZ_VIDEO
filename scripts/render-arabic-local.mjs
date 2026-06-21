#!/usr/bin/env node
// RAIZ local Arabic render driver (Remotion-direct + external/local Arabic VO + FFmpeg).
//
// Pipeline:
//   1. Resolve Arabic VO (external file or external audio URL, else silent with a warning).
//   2. Measure VO duration with ffprobe.
//   3. Build timed caption cues + write captions.srt / captions.ass sidecars.
//   4. Render the visual layer with Remotion (1080x1920, RTL Arabic).
//   5. Attach audio only when an external source is usable (no noisy fallback).
//   6. Verify the final MP4 dimensions/audio with ffprobe.
//
// Usage: node scripts/render-arabic-local.mjs [--job=path.json] [--out=dir]

import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { basename, dirname, extname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { generateGeminiTts } from "./gemini-tts.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Load .env (Node 20.12+) so GEMINI_API_KEY / RAIZ_TTS_PROVIDER are available when
// this driver runs standalone. The key lives only in the gitignored .env file.
try {
  process.loadEnvFile(resolve(repoRoot, ".env"));
} catch {
  // No .env file; rely on the ambient environment.
}
const remotionDir = resolve(repoRoot, "apps/render-remotion");
const FPS = 30;
// Remotion composition ids allow only a-z A-Z 0-9 and "-". RAIZ template ids use
// underscores (e.g. raiz_dark_hook_01), so map "_" -> "-" to bridge the two.
const DEFAULT_COMPOSITION_ID = "raiz-dark-hook-01";
const SAY_VOICE = "Majed";
// Audio at or below this mean volume (dB) is treated as effectively silent.
const SILENCE_DB_THRESHOLD = -60;
const NO_EXTERNAL_AUDIO_SOURCE = "no_external_audio";
const AMBIENT_BY_MOOD = {
  calm: "warm_room_tone",
  dark: "dark_soft_pulse",
  emotional: "cinematic_low_pad",
  minimal: "soft_noise_texture"
};

function parseArgs(argv) {
  const args = { job: "samples/valid-arabic-9x16-job.json", out: null, dryVoiceCheck: false };
  for (const token of argv) {
    if (token === "--dry-voice-check" || token === "--dry-check") {
      args.dryVoiceCheck = true;
      continue;
    }

    const match = /^--([^=]+)=(.*)$/.exec(token);
    if (match) {
      args[match[1]] = match[2];
    }
  }
  return args;
}

export function resolveVoicePlan(job, options = {}) {
  const root = options.repoRoot ?? repoRoot;
  const voice = job.voice ?? {};
  const voiceType = typeof voice.type === "string" && voice.type.trim() ? voice.type.trim() : "unspecified";
  const provider = typeof voice.provider === "string" && voice.provider.trim() ? voice.provider.trim() : null;
  const voiceName = typeof voice.voice_name === "string" && voice.voice_name.trim() ? voice.voice_name.trim() : null;
  const externalUrl = findExternalAudioUrl(job);
  const externalPath =
    voiceType === "external_file" && typeof voice.file_path === "string" && voice.file_path.trim()
      ? resolve(root, voice.file_path)
      : null;

  if (externalUrl && externalUrl.startsWith("file:")) {
    const localAudioPath = fileUrlToLocalPath(externalUrl, root);

    if (localAudioPath && existsSync(localAudioPath)) {
      return {
        source: "external_file",
        externalPath: localAudioPath,
        externalUrl: null,
        externalUrlMasked: null,
        fallbackVoice: null,
        warnings: []
      };
    }

    return {
      source: NO_EXTERNAL_AUDIO_SOURCE,
      externalPath: null,
      externalUrl: null,
      externalUrlMasked: null,
      fallbackVoice: SAY_VOICE,
      warnings: [`Declared file audio_url was not found (${localAudioPath ?? externalUrl}); rendering without narration audio.`]
    };
  }

  if (externalUrl) {
    return {
      source: "external_url",
      externalPath: null,
      externalUrl,
      externalUrlMasked: maskUrl(externalUrl),
      fallbackVoice: null,
      warnings: []
    };
  }

  if (externalPath && existsSync(externalPath)) {
    return {
      source: "external_file",
      externalPath,
      externalUrl: null,
      externalUrlMasked: null,
      fallbackVoice: null,
      warnings: []
    };
  }

  const requestSummary = [
    `voice.type="${voiceType}"`,
    provider ? `provider="${provider}"` : null,
    voiceName ? `voice_name="${voiceName}"` : null
  ]
    .filter(Boolean)
    .join(", ");
  const warnings = [];

  if (externalPath) {
    warnings.push(
      `Requested external voice file was not found at ${externalPath}; rendering without narration audio.`
    );
  } else if (voiceType === "external_file") {
    warnings.push(
      'Requested voice.type="external_file" without a usable file_path or audio_url; rendering without narration audio.'
    );
  } else if (voiceType === "none") {
    warnings.push("No external audio URL or local voice file was supplied; rendering a silent video.");
  } else {
    warnings.push(
      `Requested voice provider is not implemented in scripts/render-arabic-local.mjs (${requestSummary}); rendering without narration audio unless an external audio URL/file is supplied.`
    );
  }

  return {
    source: NO_EXTERNAL_AUDIO_SOURCE,
    externalPath: null,
    externalUrl: null,
    externalUrlMasked: null,
    fallbackVoice: SAY_VOICE,
    warnings
  };
}

function logVoiceWarnings(warnings) {
  for (const warning of warnings) {
    console.warn(`[voice][warning] ${warning}`);
  }
}

export function resolveLocalRenderSupportPlan(job) {
  const warnings = [];
  const assets = job.assets ?? {};
  const captions = job.captions ?? {};
  const template = job.template ?? {};
  const output = job.output ?? {};

  if (typeof job.title === "string" && job.title.trim()) {
    warnings.push(
      "job.title is accepted by the schema but the current Remotion v1 template does not render title text; it is metadata only."
    );
  }

  if (typeof assets.music === "string" && assets.music.trim()) {
    warnings.push(
      "assets.music is reserved/unsupported in render-arabic-local v1; final MP4 is muxed with narration only and no music bed."
    );
  }

  if (typeof assets.logo === "string" && assets.logo.trim()) {
    warnings.push("assets.logo is reserved/unsupported in render-arabic-local v1 and is not composited.");
  }

  if (
    typeof assets.broll_source === "string" &&
    assets.broll_source.trim() &&
    !["local", "none", "pexels"].includes(assets.broll_source)
  ) {
    warnings.push(
      `assets.broll_source="${assets.broll_source}" is reserved/unsupported in render-arabic-local v1; only local and pexels b-roll are wired.`
    );
  }

  if (captions.enabled === false) {
    warnings.push(
      "captions.enabled=false is not implemented in render-arabic-local v1; captions are still generated from script cues."
    );
  }

  if (typeof captions.format === "string" && captions.format !== "ass") {
    warnings.push(
      `captions.format="${captions.format}" is reserved/unsupported in render-arabic-local v1; both SRT/ASS sidecars are written and Remotion captions are still rendered.`
    );
  }

  if (typeof captions.font === "string" && captions.font.trim()) {
    warnings.push(
      `captions.font="${captions.font}" is reserved/unsupported in render-arabic-local v1; the Remotion template uses bundled IBM Plex Sans Arabic.`
    );
  }

  if (typeof captions.position === "string" && captions.position.trim()) {
    warnings.push(
      `captions.position="${captions.position}" is reserved/unsupported in render-arabic-local v1; the current template renders captions at its fixed bottom layout.`
    );
  }

  if (captions.burn_in !== undefined) {
    warnings.push(
      `captions.burn_in=${captions.burn_in} is not configurable in render-arabic-local v1; captions are always burned into the Remotion visual layer.`
    );
  }

  if (typeof captions.style_preset === "string" && captions.style_preset.trim()) {
    warnings.push(
      `captions.style_preset="${captions.style_preset}" is reserved/unsupported in render-arabic-local v1.`
    );
  }

  if (typeof template.style_preset === "string" && template.style_preset.trim()) {
    warnings.push(
      `template.style_preset="${template.style_preset}" is reserved/unsupported in render-arabic-local v1.`
    );
  }

  if (typeof output.drive_folder === "string" && output.drive_folder.trim()) {
    warnings.push(
      "output.drive_folder is ignored by render-arabic-local v1; use --out or the default storage/renders/{job_id} folder."
    );
  }

  if (job.language && job.language !== "ar") {
    warnings.push(
      `language="${job.language}" is accepted by the schema but render-arabic-local v1 is Arabic-first and uses Arabic RTL text rendering.`
    );
  }

  if (job.direction && job.direction !== "rtl") {
    warnings.push(
      `direction="${job.direction}" is accepted by the schema but render-arabic-local v1 renders with RTL Arabic text components.`
    );
  }

  return {
    warnings
  };
}

/**
 * Pure b-roll background plan (no network). Decides whether the render uses a
 * local folder or an optional Pexels fetch. v1 fetches with the FIRST search
 * term (multi-term blending is reserved). search_terms only apply to pexels.
 */
export function resolveBrollPlan(job, options = {}) {
  const root = options.repoRoot ?? repoRoot;
  const assets = job.assets ?? {};
  const source =
    typeof assets.broll_source === "string" && assets.broll_source.trim() ? assets.broll_source.trim() : null;
  const terms = Array.isArray(assets.search_terms)
    ? assets.search_terms.filter((term) => typeof term === "string" && term.trim()).map((term) => term.trim())
    : [];
  const count = Number.isInteger(assets.broll_count) && assets.broll_count > 0 ? assets.broll_count : 3;
  const warnings = [];

  if (source === "pexels") {
    const folder = resolve(root, (assets.broll_folder && assets.broll_folder.trim()) || "storage/assets/broll/pexels");
    const query = terms[0] ?? null;
    if (!query) {
      warnings.push(
        'broll_source="pexels" has no usable assets.search_terms; skipping fetch and using cached clips or a solid background.'
      );
    }
    return { source, folder, query, count, shouldFetch: Boolean(query), warnings };
  }

  if (terms.length > 0) {
    warnings.push('assets.search_terms is ignored unless broll_source is "pexels".');
  }

  if (source === "local" && assets.broll_folder && assets.broll_folder.trim()) {
    return { source, folder: resolve(root, assets.broll_folder.trim()), query: null, count: 0, shouldFetch: false, warnings };
  }

  return { source, folder: null, query: null, count: 0, shouldFetch: false, warnings };
}

function logRenderSupportWarnings(warnings) {
  for (const warning of warnings) {
    console.warn(`[render][warning] ${warning}`);
  }
}

function logBrollWarnings(warnings) {
  for (const warning of warnings) {
    console.warn(`[broll][warning] ${warning}`);
  }
}

export function resolveAmbientPlan(job, options = {}) {
  const root = options.repoRoot ?? repoRoot;
  const mood = typeof job.mood === "string" && job.mood.trim() ? job.mood.trim() : "minimal";
  const track = AMBIENT_BY_MOOD[mood] ?? AMBIENT_BY_MOOD.minimal;
  const ambientDir = resolve(root, "apps/render-remotion/public/ambient");
  const warnings = [];

  for (const ext of [".wav", ".mp3", ".m4a", ".aac"]) {
    const candidate = resolve(ambientDir, `${track}${ext}`);

    if (existsSync(candidate)) {
      return {
        mood,
        track,
        path: candidate,
        status: "available",
        warnings
      };
    }
  }

  warnings.push(
    `Ambient track "${track}" for mood="${mood}" was not found in apps/render-remotion/public/ambient; rendering without ambient bed.`
  );

  return {
    mood,
    track,
    path: null,
    status: "missing_file",
    warnings
  };
}

export function maskUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.username = "";
    parsed.password = "";

    if (parsed.search) {
      parsed.search = "?__redacted__=true";
    }

    return parsed.toString();
  } catch {
    return "[invalid-url]";
  }
}

function findExternalAudioUrl(job) {
  const voice = job.voice ?? {};

  for (const candidate of [
    job.audio_url,
    job.voiceover_url,
    job.tts_url,
    voice.audio_url,
    job.audio?.src,
    job.audio?.url
  ]) {
    if (typeof candidate !== "string" || !candidate.trim()) {
      continue;
    }

    const value = candidate.trim();

    // Local file links (file:relative or file:///absolute) are valid ready audio.
    if (value.startsWith("file:")) {
      return value;
    }

    try {
      const parsed = new URL(value);

      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        return value;
      }
    } catch {
      continue;
    }
  }

  return null;
}

// Resolve a file: audio URL to a local path. Supports file:relative (resolved
// against repo root) and file:///absolute. Returns null if not a file URL.
export function fileUrlToLocalPath(raw, root = repoRoot) {
  if (typeof raw !== "string" || !raw.startsWith("file:")) {
    return null;
  }

  let path = raw.slice("file:".length);

  if (path.startsWith("///")) {
    path = path.slice(2); // file:///abs -> /abs
  } else if (path.startsWith("//")) {
    path = path.slice(2); // file://host-or-abs -> treat remainder as path
  }

  try {
    path = decodeURIComponent(path);
  } catch {
    // keep raw path if it is not valid percent-encoding
  }

  return isAbsolute(path) ? path : resolve(root, path);
}

export function buildVisualPlan({ title, hook, captions, footer }) {
  // MVP composition: title (top) + hook (center) + ONE time-based caption
  // (bottom) + footer. No "scene cards" — dumping every caption at once was the
  // source of the repeated-text clutter.
  const captionCount = Array.isArray(captions)
    ? captions.filter((cue) => cue && typeof cue.text === "string" && cue.text.trim()).length
    : 0;
  const layers = [
    title?.trim() ? "title" : null,
    hook?.trim() ? "hook" : null,
    captionCount > 0 ? "captions" : null,
    footer?.trim() ? "footer" : null
  ].filter(Boolean);

  return {
    layers,
    layerCount: layers.length,
    hasText: Boolean(title?.trim() || hook?.trim() || captionCount > 0),
    captionCount,
    footer: footer?.trim() || null,
    warnings: layers.length > 0 ? [] : ["No visual text layers were available for render."]
  };
}

/**
 * Build a 2–6 scene timeline from the available text. Each content scene shows a
 * single line as the focal text; the last ~3s is a dedicated final card. This is
 * what turns the old static title card into a real multi-scene MVP montage.
 */
export function buildScenePlan({ title, hook, script, footer, duration }) {
  const heading = typeof title === "string" ? title.trim() : "";
  const hookText = typeof hook === "string" ? hook.trim() : "";
  const sentences = String(script ?? "")
    .split(/[.!؟…\n]+/)
    .map((part) => part.trim())
    .filter(Boolean);

  const ordered = [];
  if (hookText) {
    ordered.push(hookText);
  }
  for (const sentence of sentences) {
    // Skip fragments already contained in the hook so the hook scene is not
    // immediately re-shown in pieces.
    if (hookText && hookText.includes(sentence)) {
      continue;
    }
    ordered.push(sentence);
  }

  let lines = [...new Set(ordered)];
  if (lines.length === 0) {
    lines = [heading || footer?.trim() || "RAIZ"];
  }

  const MAX_CONTENT = 5;
  if (lines.length > MAX_CONTENT) {
    const head = lines.slice(0, MAX_CONTENT - 1);
    const tail = lines.slice(MAX_CONTENT - 1).join(" — ");
    lines = [...head, tail];
  }

  const totalDuration = Number.isFinite(duration) && duration > 0 ? duration : 10;
  const finalSeconds = Math.min(3, Math.max(1.5, totalDuration * 0.18));
  const contentSeconds = Math.max(0.8, totalDuration - finalSeconds);
  const per = contentSeconds / lines.length;

  const scenes = lines.map((text, index) => ({
    kind: "content",
    heading,
    text,
    fromSec: Number((index * per).toFixed(3)),
    toSec: Number(((index + 1) * per).toFixed(3)),
    bgVariant: index % 5
  }));

  scenes.push({
    kind: "final",
    heading,
    text: hookText || heading || lines[0],
    fromSec: Number(contentSeconds.toFixed(3)),
    toSec: totalDuration,
    bgVariant: 4
  });

  return scenes;
}

function run(label, command, commandArgs, options = {}) {
  console.log(`\n[run] ${label}: ${command} ${commandArgs.join(" ")}`);
  const result = spawnSync(command, commandArgs, { stdio: "inherit", ...options });
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status}.`);
  }
}

function capture(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, { encoding: "utf8", ...options });
  if (result.status !== 0) {
    throw new Error(`${command} ${commandArgs.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

function concatAudioBlocks(audioBlocks, outPath, listPath) {
  const list = audioBlocks
    .map((block) => `file '${String(block.audio_path).replace(/'/g, "'\\''")}'`)
    .join("\n");
  writeFileSync(listPath, `${list}\n`, "utf8");
  run("FFmpeg concat block audio", "ffmpeg", [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listPath,
    "-c:a",
    "pcm_s16le",
    outPath
  ]);
}

function createMediaHttpClient() {
  return {
    async get(url, options = {}) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 30000);
      try {
        return await fetch(url, { ...options, signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }
    }
  };
}

export async function acquireBlockBrollAssets({
  blocks,
  mediaDir,
  source = "none",
  pexelsApiKey,
  pixabayApiKey,
  httpClient = createMediaHttpClient(),
  logger = console
}) {
  mkdirSync(mediaDir, { recursive: true });

  if (!["pexels", "pixabay"].includes(source)) {
    return {
      status: "abstract_fallback",
      assets: [],
      warnings: [`broll_source="${source || "none"}" does not request licensed search media.`]
    };
  }

  if (source === "pixabay") {
    if (!pixabayApiKey) {
      return {
        status: "abstract_fallback",
        assets: [],
        warnings: ["PIXABAY_API_KEY is not set; using abstract_fallback."]
      };
    }

    return {
      status: "abstract_fallback",
      assets: [],
      warnings: ["Pixabay video acquisition is reserved; current local media search uses Pexels only."]
    };
  }

  if (!pexelsApiKey) {
    return {
      status: "abstract_fallback",
      assets: [],
      warnings: ["PEXELS_API_KEY is not set; using abstract_fallback."]
    };
  }

  const assets = [];
  const warnings = [];

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    const blockId = formatBlockId(index);
    const query = block.visual_query || block.caption || block.voiceover_text;
    const searchUrl = `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&orientation=portrait&per_page=5&size=medium`;
    let response;

    try {
      response = await httpClient.get(searchUrl, {
        headers: { Authorization: pexelsApiKey },
        timeoutMs: 30000
      });
    } catch (error) {
      warnings.push(`Pexels search failed for ${blockId}: ${error.message}`);
      continue;
    }

    if (!response.ok) {
      warnings.push(`Pexels search failed for ${blockId}: HTTP ${response.status}`);
      continue;
    }

    const data = await response.json();
    const video = pickLicensedPexelsVideo(Array.isArray(data.videos) ? data.videos : []);

    if (!video) {
      warnings.push(`No licensed Pexels video with required metadata was found for ${blockId}.`);
      continue;
    }

    const localPath = resolve(mediaDir, `${blockId}.mp4`);
    const download = await downloadLicensedVideo(httpClient, video.rendition.link, localPath, logger);

    if (!download.ok) {
      warnings.push(`${blockId}: ${download.error}`);
      continue;
    }

    const metadata = {
      block_id: blockId,
      local_path: localPath,
      source: "pexels",
      source_asset_id: String(video.id),
      source_url: video.source_url,
      creator_name: video.creator_name,
      creator_url: video.creator_url,
      license_type: "Pexels License",
      license_checked_at: new Date().toISOString(),
      width: video.rendition.width,
      height: video.rendition.height,
      duration_sec: video.duration_sec,
      query_used: query,
      match_score: video.rendition.height > video.rendition.width ? 1 : 0.75,
      safe_status: "needs_review",
      safety_note: "Provider metadata is present; face/logo detection is not implemented in local v1."
    };
    writeFileSync(resolve(mediaDir, `${blockId}.metadata.json`), `${JSON.stringify(metadata, null, 2)}\n`);
    assets.push(metadata);
  }

  writeFileSync(
    resolve(mediaDir, "media-manifest.json"),
    `${JSON.stringify(
      {
        status: assets.length === blocks.length && assets.length > 0 ? "licensed_broll" : assets.length > 0 ? "partial_broll" : "abstract_fallback",
        assets,
        warnings,
        created_at: new Date().toISOString()
      },
      null,
      2
    )}\n`
  );

  return {
    status: assets.length === blocks.length && assets.length > 0 ? "licensed_broll" : assets.length > 0 ? "partial_broll" : "abstract_fallback",
    assets,
    warnings
  };
}

function pickLicensedPexelsVideo(videos) {
  for (const video of videos) {
    const sourceUrl = typeof video?.url === "string" && video.url.trim() ? video.url.trim() : null;
    const rendition = pickPexelsRendition(video?.video_files);

    if (!sourceUrl || !rendition?.link) {
      continue;
    }

    return {
      id: video.id,
      source_url: sourceUrl,
      creator_name: typeof video.user?.name === "string" ? video.user.name : null,
      creator_url: typeof video.user?.url === "string" ? video.user.url : null,
      duration_sec: Number.isFinite(video.duration) ? video.duration : null,
      rendition
    };
  }

  return null;
}

function pickPexelsRendition(videoFiles) {
  if (!Array.isArray(videoFiles)) {
    return null;
  }

  const candidates = videoFiles.filter(
    (file) =>
      file &&
      typeof file.link === "string" &&
      file.link.trim() &&
      Number.isFinite(file.width) &&
      Number.isFinite(file.height) &&
      file.width > 0 &&
      file.height > 0
  );
  const portrait = candidates.filter((file) => file.height >= file.width);
  const pool = portrait.length > 0 ? portrait : candidates;

  if (pool.length === 0) {
    return null;
  }

  pool.sort((a, b) => Math.abs(a.width - 1080) - Math.abs(b.width - 1080));
  return pool[0];
}

async function downloadLicensedVideo(httpClient, url, dest, logger) {
  try {
    const response = await httpClient.get(url, { timeoutMs: 120000 });

    if (!response.ok) {
      return { ok: false, error: `licensed media download failed: HTTP ${response.status}` };
    }

    const contentType = getResponseHeader(response, "content-type");

    if (!contentType.toLowerCase().startsWith("video/")) {
      return { ok: false, error: `licensed media rejected: content-type ${contentType || "missing"} is not video/*` };
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    if (buffer.length === 0) {
      return { ok: false, error: "licensed media rejected: empty video response" };
    }

    writeFileSync(dest, buffer);
    return { ok: true };
  } catch (error) {
    const message = `licensed media download error: ${error.message}`;
    logger.warn?.(`[broll][warning] ${message}`);
    return { ok: false, error: message };
  }
}

function getResponseHeader(response, name) {
  if (typeof response.headers?.get === "function") {
    return response.headers.get(name) ?? "";
  }

  return response.headers?.[name] ?? response.headers?.[name.toLowerCase()] ?? "";
}

// Mean loudness (dB) via ffmpeg volumedetect. Returns null if unmeasurable.
// Digital silence reports about -91 dB, so it never passes the silence gate.
function measureMeanVolumeDb(mediaPath) {
  const result = spawnSync(
    "ffmpeg",
    ["-hide_banner", "-nostats", "-i", mediaPath, "-af", "volumedetect", "-f", "null", "-"],
    { encoding: "utf8" }
  );
  const output = `${result.stderr ?? ""}${result.stdout ?? ""}`;
  const match = /mean_volume:\s*(-?\d+(?:\.\d+)?) dB/.exec(output);
  return match ? Number(match[1]) : null;
}

async function downloadExternalAudio(url, outPath) {
  const maskedUrl = maskUrl(url);

  if (isPlaceholderUrl(url)) {
    return {
      ok: false,
      status: "warning",
      warning: `External audio URL is a placeholder and was not fetched: ${maskedUrl}`
    };
  }

  let response;
  try {
    response = await fetch(url);
  } catch (error) {
    return {
      ok: false,
      status: "warning",
      warning: `External audio URL fetch failed for ${maskedUrl}: ${error.message}`
    };
  }

  const contentType = response.headers.get("content-type") ?? "";

  if (!response.ok) {
    return {
      ok: false,
      status: "warning",
      warning: `External audio URL returned HTTP ${response.status} for ${maskedUrl}.`
    };
  }

  if (!contentType.toLowerCase().startsWith("audio/")) {
    return {
      ok: false,
      status: "warning",
      warning: `External audio URL did not return audio content (${contentType || "missing content-type"}) for ${maskedUrl}.`
    };
  }

  const buffer = Buffer.from(await response.arrayBuffer());

  if (buffer.length === 0) {
    return {
      ok: false,
      status: "warning",
      warning: `External audio URL returned an empty body for ${maskedUrl}.`
    };
  }

  writeFileSync(outPath, buffer);

  return {
    ok: true,
    status: "attached",
    warning: null
  };
}

function isPlaceholderUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname === "example.com" || parsed.hostname.endsWith(".example.com");
  } catch {
    return false;
  }
}

function probeDurationSeconds(mediaPath) {
  const out = capture("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    mediaPath
  ]);
  const seconds = Number.parseFloat(out);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`Could not read a valid duration from ${mediaPath} (got "${out}").`);
  }
  return seconds;
}

function pickBrollClip(folder) {
  let names;
  try {
    names = readdirSync(folder).filter((name) => /\.(mp4|mov|m4v|webm|mkv)$/i.test(name));
  } catch {
    return null;
  }

  const target = 1080 * 1920;
  const scored = [];
  for (const name of names) {
    const path = resolve(folder, name);
    let wh;
    try {
      wh = capture("ffprobe", [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height",
        "-of",
        "csv=p=0",
        path
      ])
        .trim()
        .split("\n")[0];
    } catch {
      continue;
    }
    const [w, h] = wh.split(",").map((value) => Number.parseInt(value, 10));
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
      continue;
    }
    scored.push({ path, w, h, portrait: h > w, areaDist: Math.abs(w * h - target), size: statSync(path).size });
  }

  if (scored.length === 0) {
    return null;
  }

  const portrait = scored.filter((clip) => clip.portrait);
  const pool = portrait.length > 0 ? portrait : scored;
  // Prefer the clip closest to 1080x1920, breaking ties by smallest file (faster decode).
  pool.sort((a, b) => a.areaDist - b.areaDist || a.size - b.size);
  return pool[0];
}

function chunkText(text, maxWords = 7) {
  const phrases = text
    .split(/[.!؟…\n،؛,]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const chunks = [];
  for (const phrase of phrases) {
    const words = phrase.split(/\s+/).filter(Boolean);
    for (let i = 0; i < words.length; i += maxWords) {
      chunks.push(words.slice(i, i + maxWords).join(" "));
    }
  }
  return chunks.length > 0 ? chunks : [text.trim()].filter(Boolean);
}

function formatBlockId(index) {
  return `B${String(index + 1).padStart(2, "0")}`;
}

export function buildNarrationBlocks(job, { hook = "", script = "" } = {}) {
  const declared = Array.isArray(job.narration_blocks) ? job.narration_blocks : [];
  const normalized = declared
    .map((block, index) => normalizeNarrationBlock(block, index))
    .filter(Boolean);

  if (normalized.length > 0) {
    return normalized;
  }

  const scriptChunks = chunkText(script, 9);
  const lines = scriptChunks.length > 0 ? scriptChunks : [hook || job.title || "RAIZ"].filter(Boolean);

  return lines.map((line, index) => ({
    block_id: formatBlockId(index),
    voiceover_text: line,
    caption: line,
    visual_query: line,
    mood: "neutral"
  }));
}

function normalizeNarrationBlock(value, index) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const voiceoverText = firstNonEmptyString(value.voiceover_text, value.voiceover, value.text, value.script);
  const caption = firstNonEmptyString(value.caption, value.on_screen_text, value.text, voiceoverText);
  const visualQuery = firstNonEmptyString(value.visual_query, value.visual, value.broll_query, value.search_query, caption);

  if (!voiceoverText || !caption || !visualQuery) {
    return null;
  }

  return {
    block_id: firstNonEmptyString(value.block_id, value.id, value.scene_id) || formatBlockId(index),
    voiceover_text: voiceoverText,
    caption,
    visual_query: visualQuery,
    mood: firstNonEmptyString(value.mood, value.tone) || "neutral"
  };
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

export async function generateGeminiTtsForBlocks({
  blocks,
  audioDir,
  apiKey,
  voiceName,
  ttsGenerator = generateGeminiTts,
  durationProbe = probeDurationSeconds,
  logger = console
}) {
  mkdirSync(audioDir, { recursive: true });
  const audioBlocks = [];
  const errors = [];

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    const blockId = formatBlockId(index);
    const outPath = resolve(audioDir, `${blockId}.wav`);
    logger.log(`[voice] generating Gemini TTS block ${blockId} -> ${outPath}`);
    const result = await ttsGenerator({
      apiKey,
      text: block.voiceover_text,
      outPath,
      voiceName
    });

    if (!result.ok) {
      errors.push(`Gemini TTS failed for ${blockId}: ${result.error || result.status || "unknown error"}`);
      continue;
    }

    const durationSec = durationProbe(outPath);
    audioBlocks.push({
      ...block,
      block_id: blockId,
      audio_path: outPath,
      duration_sec: Number(durationSec.toFixed(3))
    });
  }

  return {
    ok: errors.length === 0 && audioBlocks.length === blocks.length,
    audioBlocks,
    errors
  };
}

export function buildBlockTimelineFromDurations(blocksWithAudio) {
  let cursor = 0;

  return blocksWithAudio.map((block) => {
    const startSec = Number(cursor.toFixed(3));
    cursor += block.duration_sec;
    const endSec = Number(cursor.toFixed(3));

    return {
      ...block,
      start_sec: startSec,
      end_sec: endSec,
      timing_source: "audio_duration"
    };
  });
}

export function buildEstimatedBlockTimeline(blocks, totalDuration) {
  const safeDuration = Number.isFinite(totalDuration) && totalDuration > 0 ? totalDuration : 10;
  const weights = blocks.map((block) => Math.max(1, [...block.voiceover_text].length));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) || blocks.length || 1;
  let cursor = 0;

  return blocks.map((block, index) => {
    const startSec = Number(cursor.toFixed(3));
    const share = index === blocks.length - 1 ? safeDuration - cursor : (safeDuration * weights[index]) / totalWeight;
    cursor = index === blocks.length - 1 ? safeDuration : Math.min(safeDuration, cursor + share);

    return {
      ...block,
      start_sec: startSec,
      end_sec: Number(cursor.toFixed(3)),
      timing_source: "estimated_duration"
    };
  });
}

export function captionsFromBlockTimeline(blockTimeline) {
  return blockTimeline.map((block) => ({
    block_id: block.block_id,
    text: block.caption,
    fromSec: block.start_sec,
    toSec: block.end_sec
  }));
}

export function scenesFromBlockTimeline(blockTimeline, { title = "", footer = "", mediaAssets = [] } = {}) {
  const mediaByBlock = new Map(mediaAssets.map((asset) => [asset.block_id, asset]));

  return blockTimeline.map((block, index) => {
    const asset = mediaByBlock.get(block.block_id);

    return {
      kind: "content",
      heading: title,
      text: block.caption,
      fromSec: block.start_sec,
      toSec: block.end_sec,
      bgVariant: index % 5,
      footer,
      ...(asset?.public_src
        ? {
            brollSrc: asset.public_src,
            brollDurationInSeconds: asset.duration_sec
          }
        : {})
    };
  });
}

function buildCues(hook, script, totalDuration) {
  const hookChars = [...hook].length;
  const scriptChars = [...script].length;
  const totalChars = hookChars + scriptChars;
  const hookDuration = totalChars > 0 ? Math.min(totalDuration * 0.45, (totalDuration * hookChars) / totalChars) : 0;

  const scriptChunks = chunkText(script);
  const scriptCharTotal = scriptChunks.reduce((sum, chunk) => sum + [...chunk].length, 0) || 1;
  const scriptWindow = Math.max(0.5, totalDuration - hookDuration);

  let cursor = hookDuration;
  const scriptCues = scriptChunks.map((chunk, index) => {
    const share = ([...chunk].length / scriptCharTotal) * scriptWindow;
    const fromSec = cursor;
    const toSec = index === scriptChunks.length - 1 ? totalDuration : Math.min(totalDuration, cursor + share);
    cursor = toSec;
    return { text: chunk, fromSec, toSec };
  });

  const hookCue = hookDuration > 0 ? [{ text: hook.trim(), fromSec: 0, toSec: hookDuration }] : [];
  return { scriptCues, allCues: [...hookCue, ...scriptCues] };
}

function secondsToSrt(seconds) {
  const ms = Math.round(seconds * 1000);
  const hh = String(Math.floor(ms / 3_600_000)).padStart(2, "0");
  const mm = String(Math.floor((ms % 3_600_000) / 60_000)).padStart(2, "0");
  const ss = String(Math.floor((ms % 60_000) / 1000)).padStart(2, "0");
  const mmm = String(ms % 1000).padStart(3, "0");
  return `${hh}:${mm}:${ss},${mmm}`;
}

function secondsToAss(seconds) {
  const cs = Math.round(seconds * 100);
  const h = Math.floor(cs / 360_000);
  const m = Math.floor((cs % 360_000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(c).padStart(2, "0")}`;
}

function buildSrt(cues) {
  return (
    cues
      .map((cue, index) => `${index + 1}\n${secondsToSrt(cue.fromSec)} --> ${secondsToSrt(cue.toSec)}\n${cue.text}`)
      .join("\n\n") + "\n"
  );
}

function buildAss(cues) {
  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    "PlayResX: 1080",
    "PlayResY: 1920",
    "WrapStyle: 2",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    "Style: RAIZ,IBM Plex Sans Arabic,54,&H00FFFFFF,&H000000FF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,3,0,2,90,90,260,1",
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text"
  ].join("\n");
  const events = cues
    .map((cue) => `Dialogue: 0,${secondsToAss(cue.fromSec)},${secondsToAss(cue.toSec)},RAIZ,,0,0,0,,${cue.text.replace(/\n/g, "\\N")}`)
    .join("\n");
  return `${header}\n${events}\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const jobPath = resolve(repoRoot, args.job);
  if (!existsSync(jobPath)) {
    throw new Error(`Job file not found: ${jobPath}`);
  }

  const job = JSON.parse(readFileSync(jobPath, "utf8"));
  const jobId = job.job_id || "raiz-local-render";
  const compositionId = (job.template?.template_id || DEFAULT_COMPOSITION_ID).replace(/_/g, "-");
  const hook = (job.hook || "").trim();
  const script = (job.script || "").trim();
  if (!script) {
    throw new Error("Job has no script text to narrate.");
  }
  const narrationBlocks = buildNarrationBlocks(job, { hook, script });
  if (narrationBlocks.length === 0) {
    throw new Error("Job has no narration blocks to render.");
  }

  const outDir = resolve(repoRoot, args.out || `storage/renders/${jobId}`);
  mkdirSync(outDir, { recursive: true });

  const outputFilename =
    typeof job.output?.filename === "string" && /\.mp4$/.test(job.output.filename)
      ? job.output.filename
      : `${jobId}.mp4`;
  const voiceAiff = resolve(outDir, "voice.aiff");
  const audioDir = basename(outDir) === "output" ? resolve(outDir, "..", "audio") : resolve(outDir, "audio");
  const mediaDir = basename(outDir) === "output" ? resolve(outDir, "..", "media") : resolve(outDir, "media");
  const rawVideo = resolve(outDir, "raw.mp4");
  const finalVideo = resolve(outDir, outputFilename);
  const propsPath = resolve(outDir, "remotion-props.json");
  const srtPath = resolve(outDir, "captions.srt");
  const assPath = resolve(outDir, "captions.ass");
  const diagnosticsPath = resolve(outDir, "render-diagnostics.json");

  console.log(`RAIZ local Arabic render`);
  console.log(`  job:   ${jobPath}`);
  console.log(`  jobId: ${jobId}`);
  console.log(`  out:   ${outDir}`);

  const voicePlan = resolveVoicePlan(job);
  const renderSupportPlan = resolveLocalRenderSupportPlan(job);
  const brollPlan = resolveBrollPlan(job);
  const ambientPlan = resolveAmbientPlan(job);
  logVoiceWarnings(voicePlan.warnings);
  logRenderSupportWarnings(renderSupportPlan.warnings);
  logBrollWarnings(brollPlan.warnings);
  for (const warning of ambientPlan.warnings) {
    console.warn(`[ambient][warning] ${warning}`);
  }

  if (args.dryVoiceCheck) {
    console.log(`[voice] dry check source: ${voicePlan.source}`);
    console.log(`[render] dry check warnings: ${renderSupportPlan.warnings.length}`);
    console.log(`[broll] dry check plan: source=${brollPlan.source ?? "none"} fetch=${brollPlan.shouldFetch}`);
    console.log(`[ambient] dry check mood=${ambientPlan.mood} track=${ambientPlan.track} status=${ambientPlan.status}`);
    return;
  }

  const ttsProvider = (process.env.RAIZ_TTS_PROVIDER || "").trim().toLowerCase();
  let voiceInputPath = null;
  let audioOrigin = "none";
  let ttsError = null;
  let audioPath = null;
  let audioDurationSeconds = null;
  let blockTimeline = null;
  let audioBlocks = [];
  let ttsMode = "none";
  const audioSummary = {
    source: voicePlan.source,
    status: "silent_render",
    external_url: voicePlan.externalUrlMasked ?? null,
    file_path: null,
    external_audio_attached: false,
    tts_provider: ttsProvider || "none",
    warnings: [...voicePlan.warnings]
  };

  // 1. Voice-over.
  if (ttsProvider === "gemini") {
    // Gemini is authoritative when selected. No robotic/mock/silent fallback.
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || !apiKey.trim()) {
      throw new Error(
        "RAIZ_TTS_PROVIDER=gemini but GEMINI_API_KEY is not set. Set it in .env. Refusing to render fallback/robotic audio."
      );
    }

    mkdirSync(audioDir, { recursive: true });
    const voiceoverWav = resolve(audioDir, "voiceover.wav");
    const concatListPath = resolve(audioDir, "voiceover.concat.txt");
    console.log(`\n[voice] generating Gemini TTS per block -> ${audioDir}`);

    const tts = await generateGeminiTtsForBlocks({
      blocks: narrationBlocks,
      audioDir,
      apiKey,
      voiceName: process.env.RAIZ_TTS_VOICE
    });

    if (tts.ok) {
      concatAudioBlocks(tts.audioBlocks, voiceoverWav, concatListPath);
      voiceInputPath = voiceoverWav;
      audioPath = voiceoverWav;
      audioBlocks = tts.audioBlocks;
      blockTimeline = buildBlockTimelineFromDurations(tts.audioBlocks);
      audioDurationSeconds = Number(blockTimeline[blockTimeline.length - 1].end_sec.toFixed(3));
      audioOrigin = "gemini";
      ttsMode = "per_block";
      audioSummary.source = "gemini_tts";
      audioSummary.status = "generated_by_gemini";
      audioSummary.external_audio_attached = true;
      audioSummary.file_path = voiceoverWav;
      audioSummary.blocks = tts.audioBlocks.map((block) => ({
        block_id: block.block_id,
        audio_path: block.audio_path,
        duration_sec: block.duration_sec
      }));
    } else {
      audioOrigin = "tts_failed";
      ttsMode = "per_block";
      ttsError = tts.errors.join("; ") || "Gemini TTS failed.";
      audioSummary.source = "gemini_tts";
      audioSummary.status = "tts_failed";
      audioSummary.warnings.push(ttsError);
      console.warn(`[voice][tts][error] ${ttsError}`);
    }
  } else if (voicePlan.source === "external_file" && voicePlan.externalPath) {
    console.log(`\n[voice] using external VO: ${voicePlan.externalPath}`);
    copyFileSync(voicePlan.externalPath, voiceAiff);
    voiceInputPath = voiceAiff;
    audioPath = voiceAiff;
    audioOrigin = "external_file";
    ttsMode = "single_external";
    audioSummary.status = "attached";
    audioSummary.external_audio_attached = true;
    audioSummary.file_path = voicePlan.externalPath;
  } else if (voicePlan.source === "external_url" && voicePlan.externalUrl) {
    console.log(`\n[voice] fetching external audio URL: ${voicePlan.externalUrlMasked}`);
    const download = await downloadExternalAudio(voicePlan.externalUrl, voiceAiff);

    if (download.ok) {
      voiceInputPath = voiceAiff;
      audioPath = voiceAiff;
      audioOrigin = "external_url";
      ttsMode = "single_external";
      audioSummary.status = "attached";
      audioSummary.external_audio_attached = true;
    } else {
      audioSummary.status = download.status;
      audioSummary.warnings.push(download.warning);
      console.warn(`[voice][warning] ${download.warning}`);
    }
  }

  // 2. Duration.
  const requestedDuration =
    typeof job.duration_seconds === "number" && job.duration_seconds > 0
      ? job.duration_seconds
      : typeof job.duration === "number" && job.duration > 0
        ? job.duration
        : null;
  audioDurationSeconds = audioDurationSeconds ?? (voiceInputPath ? probeDurationSeconds(voiceInputPath) : null);
  const durationSeconds = audioDurationSeconds ?? requestedDuration ?? 10;
  const durationSource = audioDurationSeconds ? "audio" : requestedDuration ? "job_requested" : "default";
  console.log(
    `\n[duration] ${durationSource} duration is ${durationSeconds.toFixed(3)}s -> ${Math.round(durationSeconds * FPS)} frames @ ${FPS}fps`
  );

  // 3. Captions.
  blockTimeline = blockTimeline ?? buildEstimatedBlockTimeline(narrationBlocks, durationSeconds);
  const allCues = captionsFromBlockTimeline(blockTimeline);
  const scriptCues = allCues;
  const visualPlan = buildVisualPlan({
    title: job.title || "",
    hook,
    captions: allCues,
    footer: job.publish?.description || ""
  });
  let scenePlan = scenesFromBlockTimeline(blockTimeline, {
    title: job.title || "",
    footer: job.publish?.description || "",
    mediaAssets: []
  });

  if (visualPlan.layerCount === 0) {
    throw new Error("Refusing to render a visually empty Remotion output.");
  }

  writeFileSync(srtPath, buildSrt(allCues), "utf8");
  writeFileSync(assPath, buildAss(allCues), "utf8");
  console.log(`[captions] wrote ${allCues.length} cues -> captions.srt, captions.ass`);

  // 3.5 Background b-roll (optional): block-level licensed media search.
  // Missing keys or missing matches are graceful and produce abstract_fallback.
  let brollSrc;
  let brollDurationSeconds;
  const publicBrollPaths = [];
  const mediaSearch = await acquireBlockBrollAssets({
    blocks: narrationBlocks,
    mediaDir,
    source: brollPlan.source,
    pexelsApiKey: process.env.PEXELS_API_KEY,
    pixabayApiKey: process.env.PIXABAY_API_KEY
  });

  for (const warning of mediaSearch.warnings) {
    console.warn(`[broll][warning] ${warning}`);
  }

  const mediaAssets = mediaSearch.assets.map((asset) => {
    const ext = extname(asset.local_path) || ".mp4";
    const publicBrollDir = resolve(remotionDir, "public/broll");
    mkdirSync(publicBrollDir, { recursive: true });
    const publicBrollPath = resolve(publicBrollDir, `${jobId}-${asset.block_id}${ext}`);
    copyFileSync(asset.local_path, publicBrollPath);
    publicBrollPaths.push(publicBrollPath);

    return {
      ...asset,
      public_src: `broll/${jobId}-${asset.block_id}${ext}`
    };
  });

  if (mediaAssets.length > 0) {
    scenePlan = scenesFromBlockTimeline(blockTimeline, {
      title: job.title || "",
      footer: job.publish?.description || "",
      mediaAssets
    });
    console.log(`\n[broll] licensed block media: ${mediaAssets.length}/${narrationBlocks.length}`);
  } else if (brollPlan.source === "local" && brollPlan.folder) {
    if (existsSync(brollPlan.folder)) {
      const pick = pickBrollClip(brollPlan.folder);
      if (pick) {
        const ext = extname(pick.path) || ".mp4";
        const publicBrollDir = resolve(remotionDir, "public/broll");
        mkdirSync(publicBrollDir, { recursive: true });
        const publicBrollPath = resolve(publicBrollDir, `${jobId}${ext}`);
        copyFileSync(pick.path, publicBrollPath);
        publicBrollPaths.push(publicBrollPath);
        brollSrc = `broll/${jobId}${ext}`;
        brollDurationSeconds = probeDurationSeconds(pick.path);
        console.log(`\n[broll] background: ${basename(pick.path)} (${pick.w}x${pick.h}) -> public/${brollSrc}`);
      }
    } else {
      console.log(`\n[broll] b-roll folder not found: ${brollPlan.folder} (rendering on black).`);
    }
  }

  // 4. Remotion render (multi-scene visual layer, silent; audio muxed after).
  const brollStatus = mediaSearch.status === "licensed_broll" || mediaSearch.status === "partial_broll"
    ? mediaSearch.status
    : brollSrc
      ? "external_clip"
      : "abstract_fallback";
  const props = {
    hook,
    title: job.title || "",
    seriesTitleAr: job.series_title_ar || job.title || "",
    seriesTitleEn: job.series_title_en || "",
    headlineMainWord: job.headline_main_word || "",
    supportingCaption: job.supporting_caption || "",
    footerText: job.footer_text || visualPlan.footer || "© 2025 Nabil88.ART",
    mood: job.mood || "minimal",
    captions: scriptCues,
    scenes: scenePlan,
    footer: visualPlan.footer,
    brollStatus,
    durationInSeconds: durationSeconds,
    ...(brollSrc ? { brollSrc, brollDurationInSeconds: brollDurationSeconds } : {})
  };
  writeFileSync(propsPath, JSON.stringify(props, null, 2), "utf8");
  try {
    run(
      "Remotion render",
      "npx",
      ["remotion", "render", "src/index.ts", compositionId, rawVideo, `--props=${propsPath}`],
      { cwd: remotionDir }
    );
  } finally {
    // The b-roll copies are only needed during the Remotion render.
    for (const publicBrollPath of publicBrollPaths) {
      if (existsSync(publicBrollPath)) {
        rmSync(publicBrollPath, { force: true });
      }
    }
  }

  // 5. Audio: mux a verified external voice-over, or strip audio entirely.
  // We never ship Remotion's default silent AAC track and call it a success.
  if (voiceInputPath) {
    if (ambientPlan.path) {
      const fadeOutStart = Math.max(0, durationSeconds - 1).toFixed(3);
      run("FFmpeg mux audio with ducked ambient", "ffmpeg", [
        "-y",
        "-i",
        rawVideo,
        "-i",
        voiceInputPath,
        "-stream_loop",
        "-1",
        "-i",
        ambientPlan.path,
        "-filter_complex",
        `[2:a]volume=0.045,afade=t=in:st=0:d=0.8,afade=t=out:st=${fadeOutStart}:d=0.8[ambient];[ambient][1:a]sidechaincompress=threshold=0.035:ratio=8:attack=20:release=300[ducked];[1:a][ducked]amix=inputs=2:duration=first:dropout_transition=0[a]`,
        "-map",
        "0:v:0",
        "-map",
        "[a]",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-movflags",
        "+faststart",
        "-shortest",
        finalVideo
      ]);
    } else {
      run("FFmpeg mux audio", "ffmpeg", [
        "-y",
        "-i",
        rawVideo,
        "-i",
        voiceInputPath,
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-movflags",
        "+faststart",
        "-shortest",
        finalVideo
      ]);
    }
  } else {
    run("FFmpeg finalize (no external audio; drop silent track)", "ffmpeg", [
      "-y",
      "-i",
      rawVideo,
      "-map",
      "0:v:0",
      "-c:v",
      "copy",
      "-an",
      "-movflags",
      "+faststart",
      finalVideo
    ]);
  }

  // 6. Verify.
  const probeField = (field) =>
    capture("ffprobe", [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      `stream=${field}`,
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      finalVideo
    ])
      .trim()
      .split("\n")[0]
      .trim();
  const dimensions = `${probeField("width")}x${probeField("height")}`;
  const hasAudio = capture("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "a",
    "-show_entries",
    "stream=codec_type",
    "-of",
    "csv=p=0",
    finalVideo
  ]);
  const finalDuration = probeDurationSeconds(finalVideo);

  // Audio quality: detect a silent track so it can never pass as a success.
  const hasAudioTrack = Boolean(hasAudio);
  const audioRmsDb = hasAudioTrack ? measureMeanVolumeDb(finalVideo) : null;
  const silentAudioDetected = hasAudioTrack && audioRmsDb !== null && audioRmsDb <= SILENCE_DB_THRESHOLD;

  let audioStatus;
  if (audioOrigin === "gemini") {
    audioStatus = silentAudioDetected ? "silent_audio" : "generated_by_gemini";
  } else if (audioOrigin === "tts_failed") {
    audioStatus = "tts_failed";
  } else if (audioSummary.external_audio_attached) {
    audioStatus = silentAudioDetected ? "silent_audio" : "external_audio";
  } else {
    audioStatus = "no_audio_url";
  }

  const visualStatus = visualPlan.layerCount > 0 ? "visible_layers" : "empty";
  const audioExpected = Boolean(script.trim());
  const sceneCount = scenePlan.length;
  const blocksCount = narrationBlocks.length;
  const audioBlocksCount = audioBlocks.length;
  const captionTimingMatchesBlocks =
    allCues.length === blockTimeline.length &&
    allCues.every(
      (cue, index) =>
        cue.block_id === blockTimeline[index].block_id &&
        cue.fromSec === blockTimeline[index].start_sec &&
        cue.toSec === blockTimeline[index].end_sec
    );
  const syncStatus =
    audioOrigin === "gemini" && audioBlocksCount === blocksCount && captionTimingMatchesBlocks
      ? "pass"
      : audioOrigin === "tts_failed"
        ? "failed"
        : captionTimingMatchesBlocks
          ? "estimated"
          : "failed";

  let renderQuality = "pass";
  const qualityReasons = [];
  if (visualStatus === "empty") {
    renderQuality = "fail";
    qualityReasons.push("no visual text layers");
  }
  if (sceneCount < 2) {
    renderQuality = "fail";
    qualityReasons.push("only a single static scene was produced");
  }
  if (silentAudioDetected) {
    renderQuality = "fail";
    qualityReasons.push("audio track is present but silent");
  }
  if (audioStatus === "tts_failed") {
    renderQuality = "fail";
    qualityReasons.push(ttsError || "Gemini TTS failed");
  }
  if (ttsProvider === "gemini" && audioOrigin === "gemini" && syncStatus !== "pass") {
    renderQuality = "fail";
    qualityReasons.push("Gemini TTS succeeded but captions are not timed from per-block audio durations");
  }
  if (renderQuality !== "fail" && audioExpected && audioStatus === "no_audio_url") {
    renderQuality = renderQuality === "pass" ? "warn" : renderQuality;
    qualityReasons.push("narration expected but no external audio URL was supplied");
  }
  if (renderQuality !== "fail" && brollStatus === "abstract_fallback") {
    renderQuality = renderQuality === "pass" ? "warn" : renderQuality;
    qualityReasons.push("no real b-roll; used an abstract motion background");
  }
  if (renderQuality !== "fail" && brollStatus === "partial_broll") {
    renderQuality = renderQuality === "pass" ? "warn" : renderQuality;
    qualityReasons.push("only some narration blocks have licensed b-roll");
  }
  if (renderQuality !== "fail" && syncStatus !== "pass") {
    renderQuality = renderQuality === "pass" ? "warn" : renderQuality;
    qualityReasons.push("caption sync is not verified from per-block Gemini audio durations");
  }

  // Publish-ready only when the render is clean AND has real audio AND real b-roll.
  const publishReady =
    renderQuality === "pass" &&
    (audioStatus === "generated_by_gemini" || audioStatus === "external_audio") &&
    brollStatus === "licensed_broll" &&
    mediaAssets.length === blocksCount &&
    syncStatus === "pass" &&
    mediaAssets.every((asset) => asset.source_url && asset.license_type);

  const diagnostics = {
    job_id: jobId,
    render_quality: renderQuality,
    quality_reasons: qualityReasons,
    tts_provider: ttsProvider || "none",
    visual_status: visualStatus,
    audio_status: audioStatus,
    audio_path: audioPath,
    audio_stream_present: hasAudioTrack,
    tts_mode: ttsMode,
    blocks_count: blocksCount,
    audio_blocks_count: audioBlocksCount,
    sync_status: syncStatus,
    broll_status: brollStatus,
    media_assets_count: mediaAssets.length,
    captions_count: allCues.length,
    scenes_count: sceneCount,
    audio_rms_db: audioRmsDb,
    silent_audio_detected: silentAudioDetected,
    publish_ready: publishReady,
    error_message: ttsError ? ttsError.slice(0, 300) : null,
    visual: {
      status: visualStatus,
      layer_count: visualPlan.layerCount,
      layers: visualPlan.layers,
      scene_count: sceneCount,
      caption_cue_count: allCues.length,
      block_timeline: blockTimeline.map((block) => ({
        block_id: block.block_id,
        start_sec: block.start_sec,
        end_sec: block.end_sec,
        caption: block.caption,
        timing_source: block.timing_source
      })),
      warnings: visualPlan.warnings
    },
    audio: {
      ...audioSummary,
      status: audioStatus,
      has_audio_track: hasAudioTrack,
      rms_db: audioRmsDb,
      silent_audio_detected: silentAudioDetected,
      duration_seconds: audioDurationSeconds,
      ambient: {
        mood: ambientPlan.mood,
        track: ambientPlan.track,
        status: ambientPlan.status,
        file_path: ambientPlan.path,
        ducking: ambientPlan.path ? "sidechaincompress_under_voice" : "not_applied",
        gain: ambientPlan.path ? 0.045 : null,
        warnings: ambientPlan.warnings
      }
    },
    broll: {
      status: brollStatus,
      source: mediaAssets.length > 0 ? "licensed_block_media" : brollSrc ? "local_clip" : "abstract_motion_background",
      assets: mediaAssets
    },
    duration: {
      requested_seconds: requestedDuration,
      rendered_seconds: finalDuration,
      source: durationSource
    },
    created_at: new Date().toISOString()
  };

  writeFileSync(diagnosticsPath, `${JSON.stringify(diagnostics, null, 2)}\n`, "utf8");

  console.log("\n========================================");
  console.log(`RAIZ render quality: ${renderQuality.toUpperCase()}`);
  console.log(`   file:       ${finalVideo}`);
  console.log(`   dimensions: ${dimensions} (expected 1080x1920)`);
  console.log(`   audio:      ${audioStatus}${audioRmsDb !== null ? ` (${audioRmsDb} dB)` : ""}`);
  console.log(`   tts:        ${ttsProvider || "none"}${audioPath ? ` -> ${audioPath}` : ""}`);
  console.log(`   visual:     ${visualStatus} (${sceneCount} scenes, ${allCues.length} caption cues)`);
  console.log(`   b-roll:     ${brollStatus}`);
  console.log(`   publish_ready: ${publishReady}`);
  console.log(`   duration:   ${finalDuration.toFixed(3)}s`);
  if (qualityReasons.length > 0) {
    console.log(`   notes:      ${qualityReasons.join("; ")}`);
  }
  console.log("========================================");

  if (dimensions !== "1080x1920") {
    throw new Error(`Expected 1080x1920 output, got ${dimensions}.`);
  }
  // render_quality === "fail" is recorded in diagnostics/output-manifest (and the
  // orchestrator fails the job). We do not throw here so a tts_failed/quality-fail
  // render still produces a truthful manifest instead of an opaque crash.
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
