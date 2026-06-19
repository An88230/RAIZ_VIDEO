import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir, writeFile } from "node:fs/promises";
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
  message?: string;
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
      const timeoutMs = getRenderTimeoutMs();
      const renderResult = await runNode(
        [renderScriptPath, `--job=${input.jobPath}`, `--out=${input.outputDir}`],
        repoRoot,
        timeoutMs
      );
      const ok = renderResult.exitCode === 0 && !renderResult.timedOut && (await pathExists(outputPath));

      return {
        ok,
        outputPath,
        rawVideoPath: resolve(input.outputDir, "raw.mp4"),
        voicePath: resolve(input.outputDir, "voice.aiff"),
        captionsSrtPath: resolve(input.outputDir, "captions.srt"),
        captionsAssPath: resolve(input.outputDir, "captions.ass"),
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
  const outputManifest: ShortVideoMakerOutputManifest = {
    job_id: jobId,
    adapter: "remotion_direct",
    status: "ingested",
    source_response_path: manifestPath,
    output_path: result.outputPath,
    final_video_path: result.outputPath,
    checks: outputManifestChecks,
    warnings: [],
    errors: [],
    created_at: completedAt
  };
  await writeFile(paths.outputManifestPath, `${JSON.stringify(outputManifest, null, 2)}\n`);

  const finalStatus = await updateJobStatus(jobId, "rendered", {
    storageRoot: options.storageRoot,
    adapter: "remotion_direct",
    output_path: result.outputPath,
    metadata: {
      ...startedMetadata,
      render_completed_at: completedAt,
      render_manifest_path: manifestPath,
      output_manifest_path: paths.outputManifestPath,
      final_video_path: result.outputPath
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
