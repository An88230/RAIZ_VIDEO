import { mkdir, readFile, writeFile } from "node:fs/promises";

import {
  appendJobEvent,
  getJobPaths,
  getJobStatus,
  getStoredJob,
  type PersistenceOptions,
  updateJobMetadata
} from "./persistence.js";
import type { ShortVideoMakerOutputManifest } from "./shortVideoMakerOutputIngestion.js";

export interface OutputReviewPackage {
  job_id: string;
  status: "ready_for_review";
  final_video_path: string | null;
  job_summary: {
    title: string;
    platform: string;
    language: string;
    direction: string;
    aspect_ratio: string;
    template_id: string;
    output_filename: string;
  };
  render_metadata: {
    adapter: string;
    output_path: string | null;
    output_manifest_path: string;
    review_folder_path: string;
    status_metadata: Record<string, unknown>;
  };
  timestamps: {
    job_created_at: string;
    job_updated_at: string;
    output_manifest_created_at: string | null;
    review_package_created_at: string;
  };
  warnings: string[];
  errors: string[];
}

export class JobOutputReviewPackageStateError extends Error {
  constructor(jobId: string, status: string) {
    super(`Job ${jobId} must be rendered before review package creation. Current status is ${status}.`);
    this.name = "JobOutputReviewPackageStateError";
  }
}

export class JobOutputReviewPackageArtifactError extends Error {
  constructor(jobId: string, artifactName: string) {
    super(`Job ${jobId} requires ${artifactName} before review package creation.`);
    this.name = "JobOutputReviewPackageArtifactError";
  }
}

export async function createOutputReviewPackage(
  jobId: string,
  options: PersistenceOptions = {}
): Promise<OutputReviewPackage> {
  const paths = getJobPaths(jobId, options);
  const status = await getJobStatus(jobId, options);

  if (status.status !== "rendered") {
    throw new JobOutputReviewPackageStateError(jobId, status.status);
  }

  const [job, outputManifest] = await Promise.all([
    getStoredJob(jobId, options),
    readRequiredJson<ShortVideoMakerOutputManifest>(paths.outputManifestPath, jobId, "output-manifest.json")
  ]);
  const createdAt = new Date().toISOString();
  const reviewPackage: OutputReviewPackage = {
    job_id: jobId,
    status: "ready_for_review",
    final_video_path: outputManifest.final_video_path ?? status.output_path,
    job_summary: {
      title: job.title,
      platform: job.platform,
      language: job.language,
      direction: job.direction,
      aspect_ratio: job.aspect_ratio,
      template_id: job.template.template_id,
      output_filename: job.output.filename
    },
    render_metadata: {
      adapter: status.adapter,
      output_path: status.output_path,
      output_manifest_path: paths.outputManifestPath,
      review_folder_path: paths.reviewDir,
      status_metadata: status.metadata ?? {}
    },
    timestamps: {
      job_created_at: status.created_at,
      job_updated_at: status.updated_at,
      output_manifest_created_at: outputManifest.created_at ?? null,
      review_package_created_at: createdAt
    },
    warnings: outputManifest.warnings,
    errors: outputManifest.errors
  };

  await mkdir(paths.reviewDir, { recursive: true });
  await writeFile(paths.reviewPackagePath, `${JSON.stringify(reviewPackage, null, 2)}\n`);
  await updateJobMetadata(
    jobId,
    {
      review_package_path: paths.reviewPackagePath,
      review_folder_path: paths.reviewDir,
      review_package_created: true
    },
    options
  );
  await appendJobEvent(
    jobId,
    {
      type: "job.review_package_created",
      review_package_path: paths.reviewPackagePath,
      review_folder_path: paths.reviewDir
    },
    options
  );

  return reviewPackage;
}

async function readRequiredJson<T>(path: string, jobId: string, artifactName: string): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new JobOutputReviewPackageArtifactError(jobId, artifactName);
    }

    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
