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

export { RealRenderExecutionDisabledError };

const moduleDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(moduleDir, "../../..");
const renderScriptPath = resolve(repoRoot, "scripts/render-arabic-local.mjs");

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
      const exitCode = await runNode(
        [renderScriptPath, `--job=${input.jobPath}`, `--out=${input.outputDir}`],
        repoRoot
      );
      const ok = exitCode === 0 && (await pathExists(outputPath));

      return {
        ok,
        outputPath,
        rawVideoPath: resolve(input.outputDir, "raw.mp4"),
        voicePath: resolve(input.outputDir, "voice.aiff"),
        captionsSrtPath: resolve(input.outputDir, "captions.srt"),
        captionsAssPath: resolve(input.outputDir, "captions.ass"),
        message: ok
          ? "Remotion-direct render completed."
          : `Render driver exited with code ${exitCode} or produced no output file.`
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
  const manifestPath = resolve(paths.jobDir, "render-manifest.remotion-direct.json");
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

  const finalStatus = await updateJobStatus(jobId, "rendered", {
    storageRoot: options.storageRoot,
    adapter: "remotion_direct",
    output_path: result.outputPath,
    metadata: {
      ...startedMetadata,
      render_completed_at: completedAt,
      render_manifest_path: manifestPath
    }
  });
  await appendJobEvent(
    jobId,
    {
      type: "job.remotion_direct_render_completed",
      engine: "remotion_direct",
      output_path: result.outputPath,
      manifest_path: manifestPath
    },
    options
  );

  return finalStatus;
}

function runNode(args: string[], cwd: string): Promise<number> {
  return new Promise((resolveCode, rejectError) => {
    const child = spawn(process.execPath, args, { stdio: "inherit", cwd });
    child.on("error", rejectError);
    child.on("close", (code) => resolveCode(code ?? 1));
  });
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
