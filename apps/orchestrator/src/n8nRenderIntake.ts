import { validateRaizJob, type RaizJob, type RaizJobValidationIssue } from "@raiz/job-schema";
import { writeFile } from "node:fs/promises";

import { assertRealRenderAllowed } from "./executionGuard.js";
import {
  appendJobEvent,
  createJobRecord,
  getJobPaths,
  prepareJob,
  type JobStatusRecord,
  type PersistenceOptions
} from "./persistence.js";
import { runPreflight } from "./preflight.js";
import {
  renderJobWithRemotionDirect,
  type RemotionRenderer
} from "./remotionDirectRender.js";

export interface N8nRemotionDirectRenderResult extends JobStatusRecord {
  n8n_render_payload_path: string;
}

export class N8nRenderPayloadValidationError extends Error {
  readonly issues: Array<string | RaizJobValidationIssue>;

  constructor(issues: Array<string | RaizJobValidationIssue>) {
    super("Invalid n8n render payload.");
    this.name = "N8nRenderPayloadValidationError";
    this.issues = issues;
  }
}

export class N8nRenderPreflightError extends Error {
  constructor(jobId: string, errors: string[]) {
    super(`Job ${jobId} failed preflight before n8n Remotion render: ${errors.join("; ")}`);
    this.name = "N8nRenderPreflightError";
  }
}

interface N8nNarrationBlock {
  block_id: string;
  voiceover_text: string;
  caption: string;
  visual_query: string;
  mood: string;
}

export async function renderN8nPayloadWithRemotionDirect(
  payload: unknown,
  renderer: RemotionRenderer,
  options: PersistenceOptions = {}
): Promise<N8nRemotionDirectRenderResult> {
  assertRealRenderAllowed();

  const job = mapN8nRenderPayloadToRaizJob(payload);
  const status = await createJobRecord(job, {
    ...options,
    adapter: "remotion_direct"
  });
  const paths = getJobPaths(status.job_id, options);

  await writeFile(paths.n8nRenderPayloadPath, `${JSON.stringify(payload, null, 2)}\n`, { flag: "wx" });
  await appendJobEvent(
    job.job_id,
    {
      type: "job.n8n_render_payload_received",
      source: "n8n",
      payload_path: paths.n8nRenderPayloadPath
    },
    options
  );

  await prepareJob(job.job_id, {
    ...options,
    adapter: "remotion_direct"
  });
  const preflightReport = await runPreflight(job.job_id, options);

  if (preflightReport.status !== "passed") {
    throw new N8nRenderPreflightError(job.job_id, preflightReport.errors);
  }

  const finalStatus = await renderJobWithRemotionDirect(job.job_id, renderer, options);

  return {
    ...finalStatus,
    n8n_render_payload_path: paths.n8nRenderPayloadPath
  };
}

export function mapN8nRenderPayloadToRaizJob(payload: unknown): RaizJob {
  const source = requireObject(payload);
  const issues: string[] = [];
  const jobId = firstString(source, ["video_id", "job_id"]);

  if (!jobId) {
    issues.push("video_id is required.");
  } else if (!/^[a-zA-Z0-9_-]+$/.test(jobId)) {
    issues.push("video_id must contain only letters, numbers, underscores, or hyphens.");
  }

  const format = optionalString(source, "format") ?? "9:16";
  const width = optionalNumber(source, "width") ?? 1080;
  const height = optionalNumber(source, "height") ?? 1920;
  const language = optionalString(source, "language") ?? "ar";
  const rtl = optionalBoolean(source, "rtl") ?? true;
  const payloadBlocks = collectNarrationBlocks(source);
  const script = buildScript(source, payloadBlocks);
  const externalAudioUrl = findExternalAudioUrl(source);
  const durationSeconds = optionalNumber(source, "duration") ?? optionalNumber(source, "duration_seconds");

  if (format !== "9:16") {
    issues.push('format must be "9:16".');
  }

  if (width !== 1080) {
    issues.push("width must be 1080.");
  }

  if (height !== 1920) {
    issues.push("height must be 1920.");
  }

  if (language !== "ar") {
    issues.push('language must be "ar" for the local Remotion v1 render path.');
  }

  if (!rtl) {
    issues.push("rtl must be true for Arabic local Remotion rendering.");
  }

  if (!script.trim()) {
    issues.push("voiceover or captions text is required.");
  }

  if (issues.length > 0) {
    throw new N8nRenderPayloadValidationError(issues);
  }

  const safeJobId = jobId as string;
  const template = optionalString(source, "template") ?? "raiz_dark_hook_01";
  const templateId = template.startsWith("raiz_") ? template : "raiz_dark_hook_01";
  const title = optionalString(source, "topic") ?? safeJobId;
  const hook = optionalString(source, "angle") ?? firstLine(script) ?? title;
  const narrationBlocks =
    payloadBlocks.length > 0 ? payloadBlocks : buildLegacyNarrationBlocks(source, { script, hook, title });
  const searchTerms = collectSearchTerms(source, payloadBlocks.length > 0 ? narrationBlocks : []);
  const footer = optionalString(source, "footer_text") ?? getNestedString(source.brand, "footer") ?? "© 2025 Nabil88.ART";
  const mood = optionalMood(source, "mood");
  const job: RaizJob = {
    job_id: safeJobId,
    platform: "youtube_shorts",
    aspect_ratio: "9:16",
    resolution: {
      width: 1080,
      height: 1920
    },
    language: "ar",
    direction: "rtl",
    title,
    hook,
    ...(durationSeconds && durationSeconds > 0 ? { duration_seconds: durationSeconds } : {}),
    ...(optionalString(source, "series_title_ar") ? { series_title_ar: optionalString(source, "series_title_ar") as string } : {}),
    ...(optionalString(source, "series_title_en") ? { series_title_en: optionalString(source, "series_title_en") as string } : {}),
    ...(optionalString(source, "headline_main_word")
      ? { headline_main_word: optionalString(source, "headline_main_word") as string }
      : {}),
    ...(optionalString(source, "supporting_caption")
      ? { supporting_caption: optionalString(source, "supporting_caption") as string }
      : {}),
    footer_text: footer,
    ...(mood ? { mood } : {}),
    script,
    narration_blocks: narrationBlocks,
    template: {
      engine: "remotion_direct",
      template_id: templateId,
      ...(templateId !== template ? { style_preset: template } : {})
    },
    voice: externalAudioUrl
      ? {
          type: "external_file",
          provider: "external_url",
          voice_name: "external_url",
          audio_url: externalAudioUrl
        }
      : {
          type: "none"
        },
    assets: {
      broll_source: searchTerms.length > 0 ? "pexels" : "none",
      ...(searchTerms.length > 0
        ? {
            search_terms: searchTerms,
            broll_count: Math.min(3, searchTerms.length)
          }
        : {})
    },
    captions: {
      enabled: true,
      format: "ass",
      font: "Cairo-Bold",
      burn_in: true,
      position: "center"
    },
    output: {
      drive_folder: "local",
      filename: `${safeJobId}.mp4`
    },
    publish: {
      youtube: false,
      mode: "manual_only",
      description: footer
    }
  };
  const validation = validateRaizJob(job);

  if (!validation.valid) {
    throw new N8nRenderPayloadValidationError(validation.errors);
  }

  return validation.job;
}

function requireObject(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new N8nRenderPayloadValidationError(["Payload must be a JSON object."]);
  }

  return payload as Record<string, unknown>;
}

function optionalString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function firstString(source: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = optionalString(source, key);

    if (value) {
      return value;
    }
  }

  return null;
}

function optionalNumber(source: Record<string, unknown>, key: string): number | null {
  const value = source[key];

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }

  return null;
}

function optionalBoolean(source: Record<string, unknown>, key: string): boolean | null {
  const value = source[key];

  if (typeof value === "boolean") {
    return value;
  }

  return null;
}

function optionalMood(source: Record<string, unknown>, key: string): "calm" | "dark" | "emotional" | "minimal" | null {
  const value = optionalString(source, key);

  if (value === "calm" || value === "dark" || value === "emotional" || value === "minimal") {
    return value;
  }

  return null;
}

function buildScript(source: Record<string, unknown>, narrationBlocks: N8nNarrationBlock[] = []): string {
  // Merge narration + on-screen text, but dedupe at the LINE level. The bug was
  // that a multi-line `voiceover` string and identical `captions`/`scenes` lines
  // never compared equal as whole strings, so the same words rendered twice
  // (the script ended up holding the full message two or three times over).
  const lines: string[] = [];

  for (const block of narrationBlocks) {
    lines.push(block.voiceover_text);
  }

  const voiceover = optionalString(source, "voiceover");

  if (voiceover) {
    lines.push(...voiceover.split(/\r?\n/));
  }

  lines.push(...textListFromUnknown(source.captions));
  lines.push(...textListFromUnknown(source.scenes));

  return dedupeStrings(lines).join("\n");
}

function collectNarrationBlocks(source: Record<string, unknown>): N8nNarrationBlock[] {
  const value = source.narration_blocks;

  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry, index) => normalizeNarrationBlock(entry, index))
    .filter((block): block is N8nNarrationBlock => Boolean(block));
}

function normalizeNarrationBlock(value: unknown, index: number): N8nNarrationBlock | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const voiceoverText = firstString(record, ["voiceover_text", "voiceover", "text", "script"]);
  const caption = firstString(record, ["caption", "on_screen_text", "text"]) ?? voiceoverText;
  const visualQuery = firstString(record, ["visual_query", "visual", "broll_query", "search_query"]) ?? caption;

  if (!voiceoverText || !caption || !visualQuery) {
    return null;
  }

  return {
    block_id: firstString(record, ["block_id", "id", "scene_id"]) ?? formatBlockId(index),
    voiceover_text: voiceoverText,
    caption,
    visual_query: visualQuery,
    mood: firstString(record, ["mood", "tone"]) ?? "neutral"
  };
}

function buildLegacyNarrationBlocks(
  source: Record<string, unknown>,
  input: { script: string; hook: string; title: string }
): N8nNarrationBlock[] {
  const captions = dedupeStrings([...textListFromUnknown(source.captions), ...textListFromUnknown(source.scenes)]);
  const voiceLines = dedupeStrings(input.script.split(/\r?\n/));
  const lines = captions.length > 0 ? captions : voiceLines;

  if (lines.length === 0) {
    return [
      {
        block_id: "B01",
        voiceover_text: input.script,
        caption: input.hook || input.title,
        visual_query: input.title,
        mood: "neutral"
      }
    ];
  }

  return lines.map((line, index) => ({
    block_id: formatBlockId(index),
    voiceover_text: voiceLines[index] ?? line,
    caption: line,
    visual_query: visualQueryForLegacyBlock(source, index) ?? line,
    mood: "neutral"
  }));
}

function visualQueryForLegacyBlock(source: Record<string, unknown>, index: number): string | null {
  const scenes = source.scenes;

  if (!Array.isArray(scenes)) {
    return null;
  }

  const scene = scenes[index];

  if (!scene || typeof scene !== "object" || Array.isArray(scene)) {
    return null;
  }

  return firstString(scene as Record<string, unknown>, ["visual_query", "visual", "caption", "text"]);
}

function textListFromUnknown(value: unknown): string[] {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (typeof entry === "string") {
      const trimmed = entry.trim();
      return trimmed ? [trimmed] : [];
    }

    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return [];
    }

    const record = entry as Record<string, unknown>;
    const text = firstString(record, ["text", "caption", "voiceover", "audio", "line"]);
    return text ? [text] : [];
  });
}

function collectSearchTerms(source: Record<string, unknown>, narrationBlocks: N8nNarrationBlock[] = []): string[] {
  const terms = new Set<string>();

  for (const block of narrationBlocks) {
    collectTermValue(block.visual_query, terms);
  }

  collectTermsFromUnknown(source.beats, terms);
  collectTermsFromUnknown(source.scenes, terms);
  collectTermsFromUnknown(source.narration_blocks, terms);

  return [...terms];
}

function collectTermsFromUnknown(value: unknown, terms: Set<string>): void {
  if (!Array.isArray(value)) {
    return;
  }

  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }

    const record = entry as Record<string, unknown>;

    for (const key of [
      "visual_query",
      "visual",
      "broll_query",
      "broll_search_terms",
      "brollSearchTerms",
      "search_terms",
      "searchTerms",
      "broll_terms"
    ]) {
      collectTermValue(record[key], terms);
    }
  }
}

function collectTermValue(value: unknown, terms: Set<string>): void {
  if (typeof value === "string") {
    const trimmed = value.trim();

    if (trimmed) {
      terms.add(trimmed);
    }

    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectTermValue(item, terms);
    }
  }
}

function findExternalAudioUrl(source: Record<string, unknown>): string | null {
  return (
    optionalUrlString(source, "audio_url") ??
    optionalUrlString(source, "voiceover_url") ??
    optionalUrlString(source, "tts_url") ??
    getNestedUrlString(source.voice, "audio_url") ??
    getNestedUrlString(source.audio, "src") ??
    getNestedUrlString(source.audio, "url")
  );
}

function optionalUrlString(source: Record<string, unknown>, key: string): string | null {
  const value = optionalString(source, key);

  if (!value) {
    return null;
  }

  // Accept ready local file links (file:relative / file:///absolute) in addition
  // to http(s). The render layer validates and attaches the file before muxing.
  if (value.startsWith("file:")) {
    return value;
  }

  return isHttpUrl(value) ? value : null;
}

function getNestedUrlString(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return optionalUrlString(value as Record<string, unknown>, key);
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = value.trim();

    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

function getNestedString(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const nestedValue = (value as Record<string, unknown>)[key];

  if (typeof nestedValue !== "string") {
    return null;
  }

  const trimmed = nestedValue.trim();
  return trimmed ? trimmed : null;
}

function firstLine(value: string): string | null {
  const line = value
    .split(/\r?\n/)
    .map((part) => part.trim())
    .find(Boolean);

  return line ?? null;
}

function formatBlockId(index: number): string {
  return `B${String(index + 1).padStart(2, "0")}`;
}
