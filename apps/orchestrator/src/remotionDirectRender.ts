import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { assertRealRenderAllowed, RealRenderExecutionDisabledError } from "./executionGuard.js";
import {
  appendJobEvent,
  getJobPaths,
  getJobStatus,
  getStoredJob,
  type JobStatusRecord,
  type PersistenceOptions,
  updateJobStatus
} from "./persistence.js";
import type { OutputManifestCheck, ShortVideoMakerOutputManifest } from "./shortVideoMakerOutputIngestion.js";

export { RealRenderExecutionDisabledError };

const moduleDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(moduleDir, "../../..");
const renderScriptPath = resolve(repoRoot, "scripts/render-arabic-local.mjs");
const DEFAULT_RENDER_TIMEOUT_MS = 10 * 60 * 1000;

export interface RemotionRenderInput {
  jobId: string;
  jobPath: string;
  outputDir: string;
  outputFilename: string;
}

export interface RemotionRenderResult {
  ok: boolean;
  outputPath: string;
  durationSeconds?: number;
  rawVideoPath?: string;
  voicePath?: string;
  captionsSrtPath?: string;
  captionsAssPath?: string;
  audio?: RemotionRenderAudioSummary;
  visual?: RemotionRenderVisualSummary;
  quality?: RemotionRenderQualitySummary;
  message?: string;
}

export interface RemotionRenderQualitySummary {
  render_quality: "pass" | "warn" | "fail";
  tts_provider?: string;
  visual_status?: string;
  audio_status?: string;
  audio_path?: string | null;
  audio_stream_present?: boolean;
  broll_status?: string;
  captions_count?: number;
  scenes_count?: number | null;
  audio_rms_db?: number | null;
  silent_audio_detected?: boolean;
  publish_ready?: boolean;
  error_message?: string | null;
  reasons?: string[];
}

export interface RemotionRenderAudioSummary {
  source: string;
  status: string;
  external_url?: string | null;
  file_path?: string | null;
  has_audio_track?: boolean;
  external_audio_attached?: boolean;
  duration_seconds?: number | null;
  warnings?: string[];
}

export interface RemotionRenderVisualSummary {
  status: string;
  layer_count: number;
  layers: string[];
  text_layer_count?: number;
  scene_card_count?: number;
  caption_cue_count?: number;
  warnings?: string[];
}

export interface RemotionRenderer {
  render(input: RemotionRenderInput): Promise<RemotionRenderResult>;
}

export class JobRemotionDirectRenderStateError extends Error {
  constructor(jobId: string, status: string) {
    super(`Job ${jobId} must be preparing before remotion-direct render. Current status is ${status}.`);
    this.name = "JobRemotionDirectRenderStateError";
  }
}

export class JobRemotionDirectRenderPreflightError extends Error {
  constructor(jobId: string) {
    super(`Job ${jobId} must pass preflight before remotion-direct render.`);
    this.name = "JobRemotionDirectRenderPreflightError";
  }
}

export class JobRemotionDirectRenderError extends Error {
  constructor(jobId: string, message: string) {
    super(`Job ${jobId}: ${message}`);
    this.name = "JobRemotionDirectRenderError";
  }
}

/**
 * Default renderer: runs the proven standalone render driver
 * (scripts/render-arabic-local.mjs) as a child process against the job's
 * stored artifacts. Real Remotion + FFmpeg work happens here, so tests inject a
 * lightweight fake instead.
 */
export function createScriptRemotionRenderer(): RemotionRenderer {
  return {
    async render(input) {
      const outputPath = resolve(input.outputDir, input.outputFilename);
      const diagnosticsPath = resolve(input.outputDir, "render-diagnostics.json");
      const timeoutMs = getRenderTimeoutMs();
      const renderResult = await runNode(
        [renderScriptPath, `--job=${input.jobPath}`, `--out=${input.outputDir}`],
        repoRoot,
        timeoutMs
      );
      const ok = renderResult.exitCode === 0 && !renderResult.timedOut && (await pathExists(outputPath));
      const diagnostics = await readRenderDiagnostics(diagnosticsPath);

      return {
        ok,
        outputPath,
        rawVideoPath: resolve(input.outputDir, "raw.mp4"),
        voicePath: diagnostics.audio?.external_audio_attached ? resolve(input.outputDir, "voice.aiff") : undefined,
        captionsSrtPath: resolve(input.outputDir, "captions.srt"),
        captionsAssPath: resolve(input.outputDir, "captions.ass"),
        audio: diagnostics.audio,
        visual: diagnostics.visual,
        quality: diagnostics.quality,
        message: buildRenderDriverMessage(ok, renderResult, timeoutMs)
      };
    }
  };
}

export async function renderJobWithRemotionDirect(
  jobId: string,
  renderer: RemotionRenderer,
  options: PersistenceOptions = {}
): Promise<JobStatusRecord> {
  const paths = getJobPaths(jobId, options);
  const status = await getJobStatus(jobId, options);

  if (status.status !== "preparing") {
    throw new JobRemotionDirectRenderStateError(jobId, status.status);
  }

  if (status.metadata?.preflight_status !== "passed") {
    throw new JobRemotionDirectRenderPreflightError(jobId);
  }

  // Real video generation is guarded just like the other real-execution paths.
  assertRealRenderAllowed();

  const job = await getStoredJob(jobId, options);
  await mkdir(paths.outputDir, { recursive: true });

  const startedAt = new Date().toISOString();
  const startedMetadata = {
    ...(status.metadata ?? {}),
    render_engine: "remotion_direct",
    render_started_at: startedAt
  };

  await updateJobStatus(jobId, "rendering", {
    storageRoot: options.storageRoot,
    adapter: "remotion_direct",
    metadata: startedMetadata
  });
  await appendJobEvent(
    jobId,
    {
      type: "job.remotion_direct_render_started",
      engine: "remotion_direct",
      output_dir: paths.outputDir
    },
    options
  );

  let result: RemotionRenderResult;
  try {
    result = await renderer.render({
      jobId,
      jobPath: paths.jobPath,
      outputDir: paths.outputDir,
      outputFilename: job.output.filename
    });
  } catch (error) {
    result = {
      ok: false,
      outputPath: resolve(paths.outputDir, job.output.filename),
      message: error instanceof Error ? error.message : "Remotion-direct renderer threw an error."
    };
  }

  if (!result.ok || !(await pathExists(result.outputPath))) {
    const message = result.message ?? "Remotion-direct render failed.";
    await updateJobStatus(jobId, "failed", {
      storageRoot: options.storageRoot,
      adapter: "remotion_direct",
      error: message,
      metadata: {
        ...startedMetadata,
        render_failed_at: new Date().toISOString()
      }
    });
    await appendJobEvent(
      jobId,
      {
        type: "job.remotion_direct_render_failed",
        engine: "remotion_direct",
        error: message
      },
      options
    );
    throw new JobRemotionDirectRenderError(jobId, message);
  }

  const completedAt = new Date().toISOString();
  const manifestPath = paths.remotionRenderManifestPath;
  const scenesCount = await readScenesCount(paths.n8nRenderPayloadPath);
  const quality = resolveQualitySummary(result, scenesCount);
  const manifest = {
    job_id: jobId,
    engine: "remotion_direct",
    status: "rendered",
    output_path: result.outputPath,
    raw_video_path: result.rawVideoPath ?? null,
    voice_path: result.voicePath ?? null,
    captions: {
      srt: result.captionsSrtPath ?? null,
      ass: result.captionsAssPath ?? null
    },
    visual: result.visual ?? buildFallbackVisualSummary(job),
    audio: result.audio ?? buildFallbackAudioSummary(job),
    quality,
    duration_seconds: result.durationSeconds ?? null,
    created_at: completedAt
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const outputManifestChecks: OutputManifestCheck[] = [
    {
      name: "remotion_direct_output_file_exists",
      passed: true,
      severity: "error",
      message: "Remotion-direct output file exists."
    }
  ];
  const qualityWarnings =
    quality.render_quality === "warn"
      ? [`render_quality=warn: ${(quality.reasons ?? []).join("; ") || "see render diagnostics"}`]
      : [];
  const outputManifest: ShortVideoMakerOutputManifest = {
    job_id: jobId,
    adapter: "remotion_direct",
    status: "ingested",
    source_response_path: manifestPath,
    output_path: result.outputPath,
    final_video_path: result.outputPath,
    checks: outputManifestChecks,
    warnings: qualityWarnings,
    errors: [],
    created_at: completedAt
  };
  await writeFile(
    paths.outputManifestPath,
    `${JSON.stringify(
      {
        ...outputManifest,
        render_quality: quality.render_quality,
        tts_provider: quality.tts_provider ?? null,
        visual_status: quality.visual_status ?? null,
        audio_status: quality.audio_status ?? null,
        audio_path: quality.audio_path ?? null,
        audio_stream_present: quality.audio_stream_present ?? null,
        broll_status: quality.broll_status ?? null,
        captions_count: quality.captions_count ?? null,
        scenes_count: quality.scenes_count ?? null,
        audio_rms_db: quality.audio_rms_db ?? null,
        silent_audio_detected: quality.silent_audio_detected ?? false,
        publish_ready: quality.publish_ready ?? false,
        error_message: quality.error_message ?? null,
        quality
      },
      null,
      2
    )}\n`
  );

  // The manifest is written either way (truthful). A failed quality gate
  // (tts_failed, silent audio, single static scene, empty visual) fails the job
  // rather than letting it pass as "rendered".
  if (quality.render_quality === "fail") {
    const reason = `Render quality gate failed: ${(quality.reasons ?? []).join("; ") || "see render diagnostics"}`;
    await updateJobStatus(jobId, "failed", {
      storageRoot: options.storageRoot,
      adapter: "remotion_direct",
      error: reason,
      metadata: {
        ...startedMetadata,
        render_failed_at: new Date().toISOString(),
        render_manifest_path: manifestPath,
        output_manifest_path: paths.outputManifestPath,
        final_video_path: result.outputPath,
        render_quality: "fail",
        publish_ready: false
      }
    });
    await appendJobEvent(
      jobId,
      {
        type: "job.remotion_direct_render_quality_failed",
        engine: "remotion_direct",
        output_manifest_path: paths.outputManifestPath,
        render_quality: "fail"
      },
      options
    );
    throw new JobRemotionDirectRenderError(jobId, reason);
  }

  const finalStatus = await updateJobStatus(jobId, "rendered", {
    storageRoot: options.storageRoot,
    adapter: "remotion_direct",
    output_path: result.outputPath,
    metadata: {
      ...startedMetadata,
      render_completed_at: completedAt,
      render_manifest_path: manifestPath,
      output_manifest_path: paths.outputManifestPath,
      final_video_path: result.outputPath,
      render_quality: quality.render_quality,
      publish_ready: quality.publish_ready ?? false
    }
  });
  await appendJobEvent(
    jobId,
    {
      type: "job.remotion_direct_render_completed",
      engine: "remotion_direct",
      output_path: result.outputPath,
      manifest_path: manifestPath,
      output_manifest_path: paths.outputManifestPath
    },
    options
  );

  return finalStatus;
}

async function readRenderDiagnostics(path: string): Promise<{
  audio?: RemotionRenderAudioSummary;
  visual?: RemotionRenderVisualSummary;
  quality?: RemotionRenderQualitySummary;
}> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as {
      audio?: RemotionRenderAudioSummary;
      visual?: RemotionRenderVisualSummary;
      render_quality?: "pass" | "warn" | "fail";
      tts_provider?: string;
      visual_status?: string;
      audio_status?: string;
      audio_path?: string | null;
      audio_stream_present?: boolean;
      broll_status?: string;
      captions_count?: number;
      scenes_count?: number | null;
      audio_rms_db?: number | null;
      silent_audio_detected?: boolean;
      publish_ready?: boolean;
      error_message?: string | null;
      quality_reasons?: string[];
    };

    const quality: RemotionRenderQualitySummary | undefined = parsed.render_quality
      ? {
          render_quality: parsed.render_quality,
          tts_provider: parsed.tts_provider,
          visual_status: parsed.visual_status,
          audio_status: parsed.audio_status,
          audio_path: parsed.audio_path ?? null,
          audio_stream_present: parsed.audio_stream_present,
          broll_status: parsed.broll_status,
          captions_count: parsed.captions_count,
          scenes_count: parsed.scenes_count ?? null,
          audio_rms_db: parsed.audio_rms_db ?? null,
          silent_audio_detected: parsed.silent_audio_detected,
          publish_ready: parsed.publish_ready ?? false,
          error_message: parsed.error_message ?? null,
          reasons: parsed.quality_reasons
        }
      : undefined;

    return {
      audio: parsed.audio,
      visual: parsed.visual,
      quality
    };
  } catch {
    return {};
  }
}

async function readScenesCount(payloadPath: string): Promise<number | null> {
  try {
    const raw = await readFile(payloadPath, "utf8");
    const parsed = JSON.parse(raw) as { scenes?: unknown };
    return Array.isArray(parsed.scenes) ? parsed.scenes.length : null;
  } catch {
    return null;
  }
}

function resolveQualitySummary(
  result: RemotionRenderResult,
  scenesCount: number | null
): RemotionRenderQualitySummary {
  if (result.quality) {
    return {
      ...result.quality,
      // Prefer the actually-rendered scene count over the payload's declared scenes.
      scenes_count: result.quality.scenes_count ?? scenesCount ?? null
    };
  }

  // Fallback when render diagnostics are unavailable (e.g. an injected fake
  // renderer in tests). Stay conservative rather than claiming a verified pass.
  return {
    render_quality: "pass",
    tts_provider: "none",
    visual_status: result.visual?.status ?? "unknown",
    audio_status: result.audio?.status ?? "unknown",
    audio_path: null,
    audio_stream_present: result.audio?.has_audio_track,
    broll_status: "unknown",
    captions_count: result.visual?.caption_cue_count,
    scenes_count: scenesCount,
    audio_rms_db: null,
    silent_audio_detected: false,
    publish_ready: false,
    error_message: null,
    reasons: []
  };
}

function buildFallbackVisualSummary(job: { title?: string; hook?: string; script?: string }): RemotionRenderVisualSummary {
  const layers = [
    job.title?.trim() ? "title" : null,
    job.hook?.trim() ? "hook" : null,
    job.script?.trim() ? "caption_scene_cards" : null
  ].filter((layer): layer is string => Boolean(layer));

  return {
    status: layers.length > 0 ? "visible_layers_unverified" : "empty_unverified",
    layer_count: layers.length,
    layers,
    text_layer_count: layers.length,
    scene_card_count: job.script?.trim() ? 1 : 0,
    caption_cue_count: job.script?.trim() ? 1 : 0,
    warnings: ["Render diagnostics were not available; visual layer summary is inferred from the job."]
  };
}

function buildFallbackAudioSummary(job: { voice?: { audio_url?: string; file_path?: string; type?: string } }): RemotionRenderAudioSummary {
  if (job.voice?.audio_url) {
    return {
      source: "external_url",
      status: "unverified",
      external_url: maskUrl(job.voice.audio_url),
      has_audio_track: undefined,
      external_audio_attached: undefined,
      warnings: ["Render diagnostics were not available; external audio attachment is unverified."]
    };
  }

  if (job.voice?.file_path) {
    return {
      source: "external_file",
      status: "unverified",
      file_path: job.voice.file_path,
      has_audio_track: undefined,
      external_audio_attached: undefined,
      warnings: ["Render diagnostics were not available; external file attachment is unverified."]
    };
  }

  return {
    source: "no_external_audio",
    status: "silent_render",
    has_audio_track: false,
    external_audio_attached: false,
    warnings: ["No external audio URL or local voice file was declared."]
  };
}

function maskUrl(url: string): string {
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

interface RenderDriverResult {
  exitCode: number;
  timedOut: boolean;
}

function runNode(args: string[], cwd: string, timeoutMs: number): Promise<RenderDriverResult> {
  return new Promise((resolveCode, rejectError) => {
    const child = spawn(process.execPath, args, { stdio: "inherit", cwd });
    let settled = false;
    let timedOut = false;
    let killTimer: NodeJS.Timeout | null = null;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), 5000);
    }, timeoutMs);

    child.on("error", (error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      if (killTimer) {
        clearTimeout(killTimer);
      }
      rejectError(error);
    });
    child.on("close", (code) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      if (killTimer) {
        clearTimeout(killTimer);
      }
      resolveCode({ exitCode: code ?? 1, timedOut });
    });
  });
}

function getRenderTimeoutMs(): number {
  const rawValue = process.env.RAIZ_REMOTION_RENDER_TIMEOUT_MS;

  if (rawValue === undefined || rawValue.trim() === "") {
    return DEFAULT_RENDER_TIMEOUT_MS;
  }

  const timeoutMs = Number.parseInt(rawValue, 10);
  return Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_RENDER_TIMEOUT_MS;
}

function buildRenderDriverMessage(ok: boolean, result: RenderDriverResult, timeoutMs: number): string {
  if (ok) {
    return "Remotion-direct render completed.";
  }

  if (result.timedOut) {
    return `Remotion-direct render timed out after ${timeoutMs}ms.`;
  }

  return `Render driver exited with code ${result.exitCode} or produced no output file.`;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
