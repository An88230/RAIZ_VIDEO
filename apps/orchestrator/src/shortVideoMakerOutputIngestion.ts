import { readFile, stat, writeFile } from "node:fs/promises";

import {
  appendJobEvent,
  getJobPaths,
  getJobStatus,
  type PersistenceOptions,
  updateJobStatus
} from "./persistence.js";
import type { ShortVideoMakerRealHttpResponseArtifact } from "./shortVideoMakerRealHttpSender.js";

export type OutputManifestStatus = "ingested" | "failed";
export type OutputManifestSeverity = "error" | "warning";

export interface OutputManifestCheck {
  name: string;
  passed: boolean;
  severity: OutputManifestSeverity;
  message: string;
}

export interface ShortVideoMakerOutputManifest {
  job_id: string;
  adapter: "short_video_maker";
  status: OutputManifestStatus;
  source_response_path: string;
  output_path: string | null;
  final_video_path: string | null;
  checks: OutputManifestCheck[];
  warnings: string[];
  errors: string[];
  created_at: string;
}

export class JobOutputIngestionStateError extends Error {
  constructor(jobId: string, status: string) {
    super(`Job ${jobId} must be rendering before output ingestion. Current status is ${status}.`);
    this.name = "JobOutputIngestionStateError";
  }
}

export async function ingestShortVideoMakerOutput(
  jobId: string,
  options: PersistenceOptions = {}
): Promise<ShortVideoMakerOutputManifest> {
  const paths = getJobPaths(jobId, options);
  const status = await getJobStatus(jobId, options);

  if (status.status !== "rendering") {
    throw new JobOutputIngestionStateError(jobId, status.status);
  }

  const checks: OutputManifestCheck[] = [];
  const responseResult = await readResponseArtifact(paths.shortVideoMakerResponsePath);

  if (responseResult.error) {
    checks.push({
      name: "short_video_maker_response_exists",
      passed: false,
      severity: "error",
      message: responseResult.error
    });
  } else {
    checks.push({
      name: "short_video_maker_response_exists",
      passed: true,
      severity: "error",
      message: "short-video-maker-response.json was found and parsed."
    });
  }

  const outputPath = responseResult.response ? getOutputPathFromResponse(responseResult.response) : null;

  checks.push({
    name: "response_output_path_declared",
    passed: outputPath !== null,
    severity: "error",
    message:
      outputPath === null
        ? "Short-video-maker response did not include a local output path."
        : "Short-video-maker response included a local output path."
  });

  const outputFileExists = outputPath !== null ? await isExistingFile(outputPath) : false;
  checks.push({
    name: "response_output_file_exists",
    passed: outputFileExists,
    severity: "error",
    message:
      outputPath === null
        ? "No output path was available to verify."
        : outputFileExists
          ? "Declared output file exists."
          : "Declared output file was not found."
  });

  const errors = checks
    .filter((check) => check.severity === "error" && !check.passed)
    .map((check) => check.message);
  const warnings = checks
    .filter((check) => check.severity === "warning" && !check.passed)
    .map((check) => check.message);
  const finalVideoPath = errors.length === 0 ? outputPath : null;
  const manifest: ShortVideoMakerOutputManifest = {
    job_id: jobId,
    adapter: "short_video_maker",
    status: errors.length === 0 ? "ingested" : "failed",
    source_response_path: paths.shortVideoMakerResponsePath,
    output_path: outputPath,
    final_video_path: finalVideoPath,
    checks,
    warnings,
    errors,
    created_at: new Date().toISOString()
  };

  await writeFile(paths.outputManifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  if (manifest.status === "ingested") {
    await updateJobStatus(jobId, "rendered", {
      ...options,
      adapter: "short_video_maker",
      output_path: finalVideoPath,
      metadata: {
        ...(status.metadata ?? {}),
        output_manifest_path: paths.outputManifestPath,
        final_video_path: finalVideoPath
      }
    });
    await appendJobEvent(
      jobId,
      {
        type: "job.output_ingested",
        adapter: "short_video_maker",
        output_manifest_path: paths.outputManifestPath,
        final_video_path: finalVideoPath
      },
      options
    );
  } else {
    await updateJobStatus(jobId, "failed", {
      ...options,
      adapter: "short_video_maker",
      output_path: null,
      error: `Output ingestion failed: ${errors.join(" ")}`,
      metadata: {
        ...(status.metadata ?? {}),
        output_manifest_path: paths.outputManifestPath,
        final_video_path: null
      }
    });
    await appendJobEvent(
      jobId,
      {
        type: "job.output_ingestion_failed",
        adapter: "short_video_maker",
        output_manifest_path: paths.outputManifestPath,
        errors
      },
      options
    );
  }

  return manifest;
}

async function readResponseArtifact(
  path: string
): Promise<{ response: ShortVideoMakerRealHttpResponseArtifact | null; error: string | null }> {
  try {
    return {
      response: JSON.parse(await readFile(path, "utf8")) as ShortVideoMakerRealHttpResponseArtifact,
      error: null
    };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return {
        response: null,
        error: "short-video-maker-response.json was not found."
      };
    }

    if (error instanceof SyntaxError) {
      return {
        response: null,
        error: "short-video-maker-response.json is not valid JSON."
      };
    }

    throw error;
  }
}

async function isExistingFile(path: string): Promise<boolean> {
  try {
    const outputStats = await stat(path);
    return outputStats.isFile();
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

function getOutputPathFromResponse(response: ShortVideoMakerRealHttpResponseArtifact): string | null {
  const body = response.response_body;
  const candidates = [
    readNestedString(response as unknown, ["output_path"]),
    readNestedString(response as unknown, ["outputPath"]),
    readNestedString(response as unknown, ["output", "local_path"]),
    readNestedString(response as unknown, ["output", "path"]),
    readNestedString(body, ["output_path"]),
    readNestedString(body, ["outputPath"]),
    readNestedString(body, ["local_path"]),
    readNestedString(body, ["localPath"]),
    readNestedString(body, ["file_path"]),
    readNestedString(body, ["filePath"]),
    readNestedString(body, ["video_path"]),
    readNestedString(body, ["videoPath"]),
    readNestedString(body, ["output", "local_path"]),
    readNestedString(body, ["output", "localPath"]),
    readNestedString(body, ["output", "path"]),
    readNestedString(body, ["video", "path"]),
    readNestedString(body, ["result", "output_path"]),
    readNestedString(body, ["result", "outputPath"])
  ];

  return candidates.find((candidate) => candidate !== null) ?? null;
}

function readNestedString(value: unknown, path: string[]): string | null {
  let current = value;

  for (const segment of path) {
    if (!isRecord(current)) {
      return null;
    }

    current = current[segment];
  }

  return typeof current === "string" && current.trim().length > 0 ? current : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
