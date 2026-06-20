#!/usr/bin/env node
// RAIZ local Arabic render driver (Remotion-direct + external/local Arabic VO + FFmpeg).
//
// Pipeline:
//   1. Resolve Arabic VO (job external_file path, else macOS `say -v Majed` with a warning).
//   2. Measure VO duration with ffprobe.
//   3. Build timed caption cues + write captions.srt / captions.ass sidecars.
//   4. Render the visual layer with Remotion (1080x1920, RTL Arabic).
//   5. Mux the VO into the silent Remotion output with FFmpeg (no libass needed).
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
import { basename, dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const remotionDir = resolve(repoRoot, "apps/render-remotion");
const FPS = 30;
// Remotion composition ids allow only a-z A-Z 0-9 and "-". RAIZ template ids use
// underscores (e.g. raiz_dark_hook_01), so map "_" -> "-" to bridge the two.
const DEFAULT_COMPOSITION_ID = "raiz-dark-hook-01";
const SAY_VOICE = "Majed";
const MACOS_SAY_FALLBACK_SOURCE = "macos_say_fallback";

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
  const externalPath =
    voiceType === "external_file" && typeof voice.file_path === "string" && voice.file_path.trim()
      ? resolve(root, voice.file_path)
      : null;

  if (externalPath && existsSync(externalPath)) {
    return {
      source: "external_file",
      externalPath,
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
      `Requested external voice file was not found at ${externalPath}; falling back to macOS say voice "${SAY_VOICE}".`
    );
  } else if (voiceType === "external_file") {
    warnings.push(
      `Requested voice.type="external_file" without a usable file_path; falling back to macOS say voice "${SAY_VOICE}".`
    );
  } else {
    warnings.push(
      `Requested voice provider is not implemented in scripts/render-arabic-local.mjs (${requestSummary}); falling back to macOS say voice "${SAY_VOICE}".`
    );
  }

  return {
    source: MACOS_SAY_FALLBACK_SOURCE,
    externalPath: null,
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
    !["local", "none"].includes(assets.broll_source)
  ) {
    warnings.push(
      `assets.broll_source="${assets.broll_source}" is reserved/unsupported in render-arabic-local v1; only local b-roll folders are used.`
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

function logRenderSupportWarnings(warnings) {
  for (const warning of warnings) {
    console.warn(`[render][warning] ${warning}`);
  }
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

function main() {
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

  const outDir = resolve(repoRoot, args.out || `storage/renders/${jobId}`);
  mkdirSync(outDir, { recursive: true });

  const outputFilename =
    typeof job.output?.filename === "string" && /\.mp4$/.test(job.output.filename)
      ? job.output.filename
      : `${jobId}.mp4`;
  const voiceAiff = resolve(outDir, "voice.aiff");
  const rawVideo = resolve(outDir, "raw.mp4");
  const finalVideo = resolve(outDir, outputFilename);
  const propsPath = resolve(outDir, "remotion-props.json");
  const srtPath = resolve(outDir, "captions.srt");
  const assPath = resolve(outDir, "captions.ass");

  console.log(`RAIZ local Arabic render`);
  console.log(`  job:   ${jobPath}`);
  console.log(`  jobId: ${jobId}`);
  console.log(`  out:   ${outDir}`);

  const voicePlan = resolveVoicePlan(job);
  const renderSupportPlan = resolveLocalRenderSupportPlan(job);
  logVoiceWarnings(voicePlan.warnings);
  logRenderSupportWarnings(renderSupportPlan.warnings);

  if (args.dryVoiceCheck) {
    console.log(`[voice] dry check source: ${voicePlan.source}`);
    console.log(`[render] dry check warnings: ${renderSupportPlan.warnings.length}`);
    return;
  }

  // 1. Voice-over: external file if provided and present, else local macOS TTS.
  if (voicePlan.source === "external_file" && voicePlan.externalPath) {
    console.log(`\n[voice] using external VO: ${voicePlan.externalPath}`);
    copyFileSync(voicePlan.externalPath, voiceAiff);
  } else {
    const narration = hook ? `${hook} ${script}` : script;
    run("generate Arabic VO (say)", "say", ["-v", SAY_VOICE, "-o", voiceAiff, narration]);
  }

  // 2. Duration.
  const durationSeconds = probeDurationSeconds(voiceAiff);
  console.log(`\n[duration] VO is ${durationSeconds.toFixed(3)}s -> ${Math.round(durationSeconds * FPS)} frames @ ${FPS}fps`);

  // 3. Captions.
  const { scriptCues, allCues } = buildCues(hook, script, durationSeconds);
  writeFileSync(srtPath, buildSrt(allCues), "utf8");
  writeFileSync(assPath, buildAss(allCues), "utf8");
  console.log(`[captions] wrote ${allCues.length} cues -> captions.srt, captions.ass`);

  // 3.5 Local b-roll background (optional). Brand-first: local folder only here.
  let brollSrc;
  let brollDurationSeconds;
  let publicBrollPath;
  if (job.assets?.broll_source === "local" && job.assets?.broll_folder) {
    const brollFolder = resolve(repoRoot, job.assets.broll_folder);
    if (existsSync(brollFolder)) {
      const pick = pickBrollClip(brollFolder);
      if (pick) {
        const ext = extname(pick.path) || ".mp4";
        const publicBrollDir = resolve(remotionDir, "public/broll");
        mkdirSync(publicBrollDir, { recursive: true });
        publicBrollPath = resolve(publicBrollDir, `${jobId}${ext}`);
        copyFileSync(pick.path, publicBrollPath);
        brollSrc = `broll/${jobId}${ext}`;
        brollDurationSeconds = probeDurationSeconds(pick.path);
        console.log(`\n[broll] background: ${basename(pick.path)} (${pick.w}x${pick.h}) -> public/${brollSrc}`);
      }
    } else {
      console.log(`\n[broll] declared local folder not found: ${brollFolder} (rendering on black).`);
    }
  }

  // 4. Remotion render (visual layer, silent).
  const props = {
    hook,
    title: job.title || "",
    captions: scriptCues,
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
    // The b-roll copy is only needed during the Remotion render.
    if (publicBrollPath && existsSync(publicBrollPath)) {
      rmSync(publicBrollPath, { force: true });
    }
  }

  // 5. Mux VO into the silent render.
  run("FFmpeg mux audio", "ffmpeg", [
    "-y",
    "-i",
    rawVideo,
    "-i",
    voiceAiff,
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

  console.log("\n========================================");
  console.log("✅ RAIZ first Arabic MP4 rendered");
  console.log(`   file:       ${finalVideo}`);
  console.log(`   dimensions: ${dimensions} (expected 1080x1920)`);
  console.log(`   audio:      ${hasAudio || "NONE"}`);
  console.log(`   duration:   ${finalDuration.toFixed(3)}s`);
  console.log(`   captions:   ${srtPath}`);
  console.log("========================================");

  if (dimensions !== "1080x1920") {
    throw new Error(`Expected 1080x1920 output, got ${dimensions}.`);
  }
  if (!hasAudio) {
    throw new Error("Final MP4 has no audio track.");
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
