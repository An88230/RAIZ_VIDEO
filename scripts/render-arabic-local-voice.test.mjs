#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  acquireBlockBrollAssets,
  buildBlockTimelineFromDurations,
  buildNarrationBlocks,
  captionsFromBlockTimeline,
  generateGeminiTtsForBlocks,
  buildScenePlan,
  buildVisualPlan,
  fileUrlToLocalPath,
  maskUrl,
  resolveAmbientPlan,
  resolveBrollPlan,
  resolveLocalRenderSupportPlan,
  resolveVoicePlan
} from "./render-arabic-local.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = resolve(repoRoot, "scripts/render-arabic-local.mjs");
const tempRoot = mkdtempSync(resolve(tmpdir(), "raiz-voice-test-"));

try {
  const dryCheck = spawnSync(
    process.execPath,
    [
      scriptPath,
      "--job=samples/valid-arabic-9x16-job.json",
      `--out=${resolve(tempRoot, "dry-check")}`,
      "--dry-check"
    ],
    {
      cwd: repoRoot,
      encoding: "utf8"
    }
  );

  if (dryCheck.status !== 0) {
    throw new Error(`Expected dry voice check to pass: ${dryCheck.stderr || dryCheck.stdout}`);
  }

  if (
    !dryCheck.stderr.includes("[voice][warning]") ||
    !dryCheck.stderr.includes('voice.type="edge_tts"') ||
    !dryCheck.stderr.includes("not implemented") ||
    !dryCheck.stderr.includes("rendering without narration audio")
  ) {
    throw new Error("Expected edge_tts dry voice check to print an explicit silent-render warning.");
  }

  if (!dryCheck.stdout.includes("[voice] dry check source: no_external_audio")) {
    throw new Error("Expected edge_tts dry voice check to use no_external_audio.");
  }

  for (const expectedWarning of [
    "job.title is accepted by the schema",
    "assets.music is reserved/unsupported",
    'captions.font="Cairo-Bold" is reserved/unsupported',
    'captions.position="center" is reserved/unsupported',
    "captions.burn_in=true is not configurable",
    "output.drive_folder is ignored"
  ]) {
    if (!dryCheck.stderr.includes("[render][warning]") || !dryCheck.stderr.includes(expectedWarning)) {
      throw new Error(`Expected dry render check to warn about unsupported field: ${expectedWarning}`);
    }
  }

  const externalVoicePath = resolve(tempRoot, "voice.aiff");
  writeFileSync(externalVoicePath, "fake-aiff");
  const externalPlan = resolveVoicePlan(
    {
      voice: {
        type: "external_file",
        file_path: externalVoicePath
      }
    },
    { repoRoot }
  );

  if (externalPlan.source !== "external_file" || externalPlan.warnings.length !== 0) {
    throw new Error("Expected existing external_file voice to avoid fallback warnings.");
  }

  const missingExternalPlan = resolveVoicePlan(
    {
      voice: {
        type: "external_file",
        file_path: resolve(tempRoot, "missing-voice.aiff")
      }
    },
    { repoRoot }
  );

  if (
    missingExternalPlan.source !== "no_external_audio" ||
    !missingExternalPlan.warnings.some((warning) => warning.includes("was not found") && warning.includes("without narration audio"))
  ) {
    throw new Error("Expected missing external_file voice to warn before silent render.");
  }

  const externalUrl = "https://gemini.example.test/audio.wav?token=secret-token&signature=secret-signature";
  const externalUrlPlan = resolveVoicePlan({
    voice: {
      type: "external_file",
      audio_url: externalUrl
    }
  });

  if (
    externalUrlPlan.source !== "external_url" ||
    externalUrlPlan.externalUrl !== externalUrl ||
    externalUrlPlan.externalUrlMasked !== "https://gemini.example.test/audio.wav?__redacted__=true" ||
    externalUrlPlan.warnings.length !== 0
  ) {
    throw new Error("Expected external audio URL voice plan to preserve runtime URL and expose only a masked URL.");
  }

  if (maskUrl(externalUrl).includes("secret-token") || maskUrl(externalUrl).includes("secret-signature")) {
    throw new Error("Expected masked audio URLs not to expose query secrets.");
  }

  const supportPlan = resolveLocalRenderSupportPlan({
    title: "Reserved title",
    language: "en",
    direction: "ltr",
    template: {
      style_preset: "cinematic"
    },
    assets: {
      broll_source: "pixabay",
      music: "storage/audio/music.mp3",
      logo: "storage/logo.png"
    },
    captions: {
      enabled: false,
      format: "none",
      font: "Cairo-Bold",
      position: "top",
      burn_in: false,
      style_preset: "bold"
    },
    output: {
      drive_folder: "local"
    }
  });

  for (const expectedWarning of [
    "assets.logo is reserved/unsupported",
    'assets.broll_source="pixabay" is reserved/unsupported',
    "captions.enabled=false is not implemented",
    'captions.format="none" is reserved/unsupported',
    "captions.burn_in=false is not configurable",
    'captions.style_preset="bold" is reserved/unsupported',
    'template.style_preset="cinematic" is reserved/unsupported',
    'language="en" is accepted by the schema',
    'direction="ltr" is accepted by the schema'
  ]) {
    if (!supportPlan.warnings.some((warning) => warning.includes(expectedWarning))) {
      throw new Error(`Expected render support plan to warn about unsupported field: ${expectedWarning}`);
    }
  }

  const pexelsPlan = resolveBrollPlan(
    { assets: { broll_source: "pexels", search_terms: ["dark desk", "night city"], broll_count: 2 } },
    { repoRoot }
  );

  if (
    pexelsPlan.source !== "pexels" ||
    pexelsPlan.query !== "dark desk" ||
    pexelsPlan.count !== 2 ||
    pexelsPlan.shouldFetch !== true ||
    pexelsPlan.folder !== resolve(repoRoot, "storage/assets/broll/pexels")
  ) {
    throw new Error("Expected pexels b-roll plan to fetch the first search term into the pexels folder.");
  }

  const ambientPlan = resolveAmbientPlan({ mood: "dark" }, { repoRoot });

  if (
    ambientPlan.mood !== "dark" ||
    ambientPlan.track !== "dark_soft_pulse" ||
    !["available", "missing_file"].includes(ambientPlan.status)
  ) {
    throw new Error("Expected mood=dark to map to dark_soft_pulse ambient track.");
  }

  const minimalAmbientPlan = resolveAmbientPlan({ mood: "unknown" }, { repoRoot });

  if (minimalAmbientPlan.track !== "soft_noise_texture") {
    throw new Error("Expected unknown mood to fall back to soft_noise_texture.");
  }

  const pexelsNoTerms = resolveBrollPlan({ assets: { broll_source: "pexels" } }, { repoRoot });

  if (
    pexelsNoTerms.shouldFetch !== false ||
    !pexelsNoTerms.warnings.some((warning) => warning.includes("no usable assets.search_terms"))
  ) {
    throw new Error("Expected pexels without search terms to skip the fetch with a warning.");
  }

  const narrationBlocks = buildNarrationBlocks({
    title: "الانطفاء اللامع",
    narration_blocks: [
      {
        block_id: "ignored-custom-id",
        voiceover_text: "ينطفئ الإنسان على مراحل.",
        caption: "ينطفئ على مراحل",
        visual_query: "dark portrait office",
        mood: "quiet"
      },
      {
        block_id: "ignored-custom-id-2",
        voiceover_text: "ثم يبحث عن اسم لما يشعر به.",
        caption: "اسم الشعور ينقذه",
        visual_query: "writing notebook night",
        mood: "reflective"
      }
    ]
  });

  if (
    narrationBlocks.length !== 2 ||
    narrationBlocks[0].caption !== "ينطفئ على مراحل" ||
    narrationBlocks[1].visual_query !== "writing notebook night"
  ) {
    throw new Error("Expected declared narration_blocks to normalize into render blocks.");
  }

  const audioDir = resolve(tempRoot, "audio");
  const ttsBlocks = await generateGeminiTtsForBlocks({
    blocks: narrationBlocks,
    audioDir,
    apiKey: "test-gemini-key",
    voiceName: "Kore",
    async ttsGenerator({ outPath }) {
      writeFileSync(outPath, "fake-wav");
      return { ok: true, path: outPath };
    },
    durationProbe(path) {
      return path.endsWith("B01.wav") ? 1.25 : 2.75;
    },
    logger: silentLogger()
  });

  if (
    !ttsBlocks.ok ||
    ttsBlocks.audioBlocks.length !== 2 ||
    !ttsBlocks.audioBlocks.every((block) => existsSync(block.audio_path)) ||
    !ttsBlocks.audioBlocks[0].audio_path.endsWith("B01.wav") ||
    !ttsBlocks.audioBlocks[1].audio_path.endsWith("B02.wav")
  ) {
    throw new Error("Expected block Gemini TTS to create one WAV file per narration block.");
  }

  const blockTimeline = buildBlockTimelineFromDurations(ttsBlocks.audioBlocks);

  if (
    blockTimeline[0].start_sec !== 0 ||
    blockTimeline[0].end_sec !== 1.25 ||
    blockTimeline[1].start_sec !== 1.25 ||
    blockTimeline[1].end_sec !== 4 ||
    !blockTimeline.every((block) => block.timing_source === "audio_duration")
  ) {
    throw new Error("Expected block timeline to be cumulative and based on real audio durations.");
  }

  const blockCaptions = captionsFromBlockTimeline(blockTimeline);

  if (
    blockCaptions.length !== blockTimeline.length ||
    blockCaptions.some(
      (caption, index) =>
        caption.fromSec !== blockTimeline[index].start_sec ||
        caption.toSec !== blockTimeline[index].end_sec ||
        caption.text !== blockTimeline[index].caption
    )
  ) {
    throw new Error("Expected caption timing to equal block timing with one caption per block.");
  }

  const noKeyMedia = await acquireBlockBrollAssets({
    blocks: narrationBlocks,
    mediaDir: resolve(tempRoot, "media-no-key"),
    source: "pexels",
    pexelsApiKey: "",
    logger: silentLogger()
  });

  if (noKeyMedia.status !== "abstract_fallback" || noKeyMedia.assets.length !== 0) {
    throw new Error("Expected missing Pexels/Pixabay keys to use abstract_fallback without failing render prep.");
  }

  const badMetadataMedia = await acquireBlockBrollAssets({
    blocks: narrationBlocks.slice(0, 1),
    mediaDir: resolve(tempRoot, "media-bad-metadata"),
    source: "pexels",
    pexelsApiKey: "test-pexels-key",
    httpClient: {
      async get(url) {
        if (url.includes("/videos/search")) {
          return jsonResponse({
            videos: [
              {
                id: 999,
                video_files: [{ link: "https://video.example/missing-license-source.mp4", width: 1080, height: 1920 }]
              }
            ]
          });
        }

        return binaryResponse("fake-video", "video/mp4");
      }
    },
    logger: silentLogger()
  });

  if (badMetadataMedia.assets.length !== 0 || badMetadataMedia.status !== "abstract_fallback") {
    throw new Error("Expected media without source_url/license metadata to be rejected before use.");
  }

  const goodMedia = await acquireBlockBrollAssets({
    blocks: narrationBlocks.slice(0, 1),
    mediaDir: resolve(tempRoot, "media-good"),
    source: "pexels",
    pexelsApiKey: "test-pexels-key",
    httpClient: {
      async get(url) {
        if (url.includes("/videos/search")) {
          return jsonResponse({
            videos: [
              {
                id: 101,
                url: "https://www.pexels.com/video/101/",
                duration: 3,
                user: { name: "Pexels Creator", url: "https://www.pexels.com/@creator" },
                video_files: [{ link: "https://video.example/valid.mp4", width: 1080, height: 1920 }]
              }
            ]
          });
        }

        return binaryResponse("fake-video", "video/mp4");
      }
    },
    logger: silentLogger()
  });

  if (
    goodMedia.status !== "licensed_broll" ||
    goodMedia.assets.length !== 1 ||
    goodMedia.assets[0].license_type !== "Pexels License" ||
    !goodMedia.assets[0].source_url ||
    !existsSync(goodMedia.assets[0].local_path)
  ) {
    throw new Error("Expected licensed Pexels media to include required license metadata and local file.");
  }

  const localWithTerms = resolveBrollPlan(
    { assets: { broll_source: "local", broll_folder: "storage/assets/broll", search_terms: ["ignored"] } },
    { repoRoot }
  );

  if (
    localWithTerms.source !== "local" ||
    localWithTerms.shouldFetch !== false ||
    localWithTerms.folder !== resolve(repoRoot, "storage/assets/broll") ||
    !localWithTerms.warnings.some((warning) => warning.includes('ignored unless broll_source is "pexels"'))
  ) {
    throw new Error("Expected local b-roll plan to ignore search terms with a warning.");
  }

  // Visual plan must NOT dump every caption as stacked "scene cards" (the old
  // clutter bug). It is a clean title + hook + captions + footer layer set.
  const visualPlan = buildVisualPlan({
    title: "عنوان",
    hook: "هوك",
    captions: [
      { text: "مقطع 1", fromSec: 0, toSec: 1 },
      { text: "مقطع 2", fromSec: 1, toSec: 2 }
    ],
    footer: "© RAIZ"
  });

  if (visualPlan.layers.some((layer) => layer.includes("scene"))) {
    throw new Error("Expected no scene-card layer in the visual plan.");
  }

  if (
    visualPlan.captionCount !== 2 ||
    !["title", "hook", "captions", "footer"].every((layer) => visualPlan.layers.includes(layer))
  ) {
    throw new Error("Expected visual plan layers title/hook/captions/footer with captionCount 2.");
  }

  const emptyVisualPlan = buildVisualPlan({ title: "", hook: "", captions: [], footer: "" });

  if (emptyVisualPlan.layerCount !== 0 || emptyVisualPlan.warnings.length === 0) {
    throw new Error("Expected an empty visual plan to report zero layers with a warning.");
  }

  // Scene plan must be a multi-scene timeline (content scenes + a final card),
  // with no duplicated scene texts and a final scene ending at the duration.
  const scenePlan = buildScenePlan({
    title: "عنوان",
    hook: "هوك افتتاحي",
    script: "جملة أولى. جملة ثانية. جملة ثالثة.",
    footer: "© RAIZ",
    duration: 20
  });

  if (scenePlan.length < 2) {
    throw new Error("Expected at least two scenes (content + final card).");
  }

  if (scenePlan[scenePlan.length - 1].kind !== "final" || scenePlan[scenePlan.length - 1].toSec !== 20) {
    throw new Error("Expected the last scene to be a final card ending at the duration.");
  }

  const contentTexts = scenePlan.filter((scene) => scene.kind === "content").map((scene) => scene.text);
  if (new Set(contentTexts).size !== contentTexts.length) {
    throw new Error("Expected no duplicated scene texts in the scene plan.");
  }

  for (let i = 1; i < scenePlan.length; i += 1) {
    if (scenePlan[i].fromSec < scenePlan[i - 1].fromSec) {
      throw new Error("Expected non-decreasing scene start times.");
    }
  }

  // file: audio_url resolves to a local fixture and attaches as external audio.
  const fileAudioPlan = resolveVoicePlan(
    { voice: { type: "external_file", audio_url: "file:samples/assets/raiz-sample-voice.m4a" } },
    { repoRoot }
  );

  if (
    fileAudioPlan.source !== "external_file" ||
    !fileAudioPlan.externalPath?.endsWith("raiz-sample-voice.m4a") ||
    fileAudioPlan.warnings.length !== 0
  ) {
    throw new Error("Expected file: audio_url to resolve to the committed fixture as external audio.");
  }

  const missingFileAudioPlan = resolveVoicePlan(
    { voice: { type: "external_file", audio_url: "file:samples/assets/does-not-exist.m4a" } },
    { repoRoot }
  );

  if (
    missingFileAudioPlan.source !== "no_external_audio" ||
    !missingFileAudioPlan.warnings.some((warning) => warning.includes("not found"))
  ) {
    throw new Error("Expected a missing file: audio_url to fall back to no audio with a warning.");
  }

  if (
    fileUrlToLocalPath("file:samples/x.m4a", repoRoot) !== resolve(repoRoot, "samples/x.m4a") ||
    fileUrlToLocalPath("file:///abs/x.m4a") !== "/abs/x.m4a" ||
    fileUrlToLocalPath("https://example.test/x.m4a") !== null
  ) {
    throw new Error("Expected fileUrlToLocalPath to resolve file: paths and ignore non-file URLs.");
  }
} finally {
  rmSync(tempRoot, { force: true, recursive: true });
}

console.log("Validated render-arabic-local voice source handling and unsupported field warnings.");

function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => "application/json" },
    async json() {
      return body;
    }
  };
}

function binaryResponse(body, contentType) {
  return {
    ok: true,
    status: 200,
    headers: {
      get(name) {
        return name.toLowerCase() === "content-type" ? contentType : "";
      }
    },
    async arrayBuffer() {
      const buffer = Buffer.from(body);
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    }
  };
}

function silentLogger() {
  return {
    log() {},
    warn() {}
  };
}
