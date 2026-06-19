import type { ShortVideoMakerPayload } from "./shortVideoMakerPayloadMapper.js";

/**
 * Maps RAIZ's internal adapter payload to the actual upstream short-video-maker
 * REST contract (`POST /api/short-video`), which expects `{ scenes, config }`.
 *
 * This is the translation that the connection contract (docs) flagged as
 * required before any real send. It produces a structurally valid upstream
 * request and reports the semantic limitations of the upstream engine
 * (English-only Kokoro TTS, Pexels-sourced footage, always-on captions) instead
 * of silently sending an incompatible body.
 */

export type ShortVideoMakerOrientation = "portrait" | "landscape";
export type ShortVideoMakerCaptionPosition = "top" | "center" | "bottom";
export type ShortVideoMakerMusicVolume = "muted" | "low" | "medium" | "high";

export interface ShortVideoMakerUpstreamScene {
  text: string;
  searchTerms: string[];
}

export interface ShortVideoMakerUpstreamConfig {
  paddingBack: number;
  captionPosition: ShortVideoMakerCaptionPosition;
  voice: string;
  orientation: ShortVideoMakerOrientation;
  music?: string;
  musicVolume?: ShortVideoMakerMusicVolume;
}

export interface ShortVideoMakerUpstreamRequest {
  scenes: ShortVideoMakerUpstreamScene[];
  config: ShortVideoMakerUpstreamConfig;
}

export interface ShortVideoMakerUpstreamMapOptions {
  /** Search terms applied to every scene when the job does not provide its own. */
  defaultSearchTerms?: string[];
  /** Caption position from the RAIZ job (the adapter payload does not carry it). */
  captionPosition?: ShortVideoMakerCaptionPosition;
  /** Explicit Kokoro voice id override (e.g. `af_heart`, `bm_lewis`). */
  voiceId?: string;
  /** Upstream music mood tag (from `GET /api/music-tags`), not a file path. */
  musicTag?: string;
  musicVolume?: ShortVideoMakerMusicVolume;
  paddingBackMs?: number;
  /** Hard cap on scene count; remaining text is merged into the last scene. */
  maxScenes?: number;
}

export interface ShortVideoMakerUpstreamMapResult {
  request: ShortVideoMakerUpstreamRequest;
  /** Human-readable semantic gaps between the RAIZ job and this engine. */
  limitations: string[];
  scene_count: number;
  search_terms_source: "job" | "default";
}

// A conservative subset of known Kokoro voice ids. Kokoro only narrates English.
const KOKORO_VOICES = new Set([
  "af_heart",
  "af_alloy",
  "af_aoede",
  "af_bella",
  "af_jessica",
  "af_kore",
  "af_nicole",
  "af_nova",
  "af_river",
  "af_sarah",
  "af_sky",
  "am_adam",
  "am_echo",
  "am_eric",
  "am_fenrir",
  "am_liam",
  "am_michael",
  "am_onyx",
  "am_puck",
  "am_santa",
  "bf_alice",
  "bf_emma",
  "bf_isabella",
  "bf_lily",
  "bm_daniel",
  "bm_fable",
  "bm_george",
  "bm_lewis"
]);
const KOKORO_DEFAULT_VOICE = "af_heart";
const DEFAULT_SEARCH_TERMS = ["abstract"];
const DEFAULT_PADDING_BACK_MS = 1500;
const DEFAULT_CAPTION_POSITION: ShortVideoMakerCaptionPosition = "bottom";

export function mapToShortVideoMakerUpstreamRequest(
  payload: ShortVideoMakerPayload,
  options: ShortVideoMakerUpstreamMapOptions = {}
): ShortVideoMakerUpstreamMapResult {
  const limitations: string[] = [];

  const sceneTexts = splitIntoSceneTexts(payload.script.hook, payload.script.text, options.maxScenes);
  const safeSceneTexts = sceneTexts.length > 0 ? sceneTexts : [payload.script.title.trim() || "RAIZ video"];

  const providedTerms = sanitizeSearchTerms(options.defaultSearchTerms);
  const searchTermsSource: "job" | "default" = providedTerms.length > 0 ? "job" : "default";
  const searchTerms = providedTerms.length > 0 ? providedTerms : [...DEFAULT_SEARCH_TERMS];

  const scenes: ShortVideoMakerUpstreamScene[] = safeSceneTexts.map((text) => ({
    text,
    searchTerms: [...searchTerms]
  }));

  const voice = resolveVoice(payload, options, limitations);
  const orientation: ShortVideoMakerOrientation =
    payload.composition.aspect_ratio === "9:16" ? "portrait" : "landscape";

  const config: ShortVideoMakerUpstreamConfig = {
    paddingBack: options.paddingBackMs ?? DEFAULT_PADDING_BACK_MS,
    captionPosition: options.captionPosition ?? DEFAULT_CAPTION_POSITION,
    voice,
    orientation
  };

  if (options.musicTag) {
    config.music = options.musicTag;
  }

  if (options.musicVolume) {
    config.musicVolume = options.musicVolume;
  }

  collectSemanticLimitations(payload, searchTermsSource, limitations);

  return {
    request: { scenes, config },
    limitations,
    scene_count: scenes.length,
    search_terms_source: searchTermsSource
  };
}

function resolveVoice(
  payload: ShortVideoMakerPayload,
  options: ShortVideoMakerUpstreamMapOptions,
  limitations: string[]
): string {
  if (options.voiceId) {
    return options.voiceId;
  }

  const declared = payload.voice.voice_name?.trim();

  if (declared && KOKORO_VOICES.has(declared)) {
    return declared;
  }

  if (declared) {
    limitations.push(
      `Declared voice "${declared}" is not a Kokoro voice; falling back to "${KOKORO_DEFAULT_VOICE}".`
    );
  }

  return KOKORO_DEFAULT_VOICE;
}

function collectSemanticLimitations(
  payload: ShortVideoMakerPayload,
  searchTermsSource: "job" | "default",
  limitations: string[]
): void {
  if (payload.composition.language !== "en") {
    limitations.push(
      "short-video-maker narrates with Kokoro TTS, which only supports English. " +
        "Non-English narration cannot be spoken by this engine; use an external audio path or a different engine."
    );
  }

  if (!payload.captions.enabled) {
    limitations.push("short-video-maker always renders captions; captions.enabled=false cannot be honored.");
  }

  const brollSource = payload.assets.summary?.broll_source;
  if (brollSource && brollSource !== "pexels") {
    limitations.push(
      `Background footage is sourced from Pexels via per-scene searchTerms; the declared broll_source "${brollSource}" is not used by this engine.`
    );
  }

  if (searchTermsSource === "default") {
    limitations.push(
      "Scene searchTerms are placeholder defaults; provide meaningful terms so the footage matches the script."
    );
  }
}

function splitIntoSceneTexts(
  hook: string | null,
  scriptText: string,
  maxScenes?: number
): string[] {
  const segments: string[] = [];
  const trimmedHook = hook?.trim();

  if (trimmedHook) {
    segments.push(trimmedHook);
  }

  for (const part of scriptText.split(/[.!?؟…\n]+/)) {
    const trimmed = part.trim();

    if (trimmed) {
      segments.push(trimmed);
    }
  }

  if (maxScenes && maxScenes > 0 && segments.length > maxScenes) {
    const head = segments.slice(0, maxScenes - 1);
    const tail = segments.slice(maxScenes - 1).join(" ");
    return [...head, tail];
  }

  return segments;
}

function sanitizeSearchTerms(terms: string[] | undefined): string[] {
  if (!terms) {
    return [];
  }

  return [...new Set(terms.map((term) => term.trim()).filter((term) => term.length > 0))];
}
