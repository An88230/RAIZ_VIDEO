import { readFile, writeFile } from "node:fs/promises";

import type { RaizJob } from "@raiz/job-schema";

import type { ManualReviewApproval } from "./manualReviewGate.js";
import type { OutputReviewPackage } from "./outputReviewPackage.js";
import {
  appendJobEvent,
  getJobPaths,
  getJobStatus,
  getStoredJob,
  type PersistenceOptions,
  updateJobMetadata
} from "./persistence.js";
import type { ShortVideoMakerOutputManifest } from "./shortVideoMakerOutputIngestion.js";

export interface PublishPackage {
  job_id: string;
  status: "ready_for_publish";
  final_video_path: string | null;
  title: string;
  description: string | null;
  hashtags: string[];
  platform_targets: Array<{
    platform: string;
    enabled: boolean;
    status: "placeholder";
  }>;
  approval: {
    approved: true;
    reviewer_note: string | null;
    approval_path: string;
    approved_at: string;
  };
  artifacts: {
    job_path: string;
    status_path: string;
    review_package_path: string;
    output_manifest_path: string;
    manual_review_approval_path: string;
  };
  metadata: {
    source: "raiz_video_factory";
    created_at: string;
  };
}

export class JobPublishPackageStateError extends Error {
  constructor(jobId: string, status: string) {
    super(`Job ${jobId} must be rendered before publish package creation. Current status is ${status}.`);
    this.name = "JobPublishPackageStateError";
  }
}

export class JobPublishPackageApprovalError extends Error {
  constructor(jobId: string) {
    super(`Job ${jobId} must be manually approved before publish package creation.`);
    this.name = "JobPublishPackageApprovalError";
  }
}

export class JobPublishPackageArtifactError extends Error {
  constructor(jobId: string, artifactName: string) {
    super(`Job ${jobId} requires ${artifactName} before publish package creation.`);
    this.name = "JobPublishPackageArtifactError";
  }
}

export async function createPublishPackage(
  jobId: string,
  options: PersistenceOptions = {}
): Promise<PublishPackage> {
  const paths = getJobPaths(jobId, options);
  const status = await getJobStatus(jobId, options);

  if (status.status !== "rendered") {
    throw new JobPublishPackageStateError(jobId, status.status);
  }

  if (status.metadata?.manual_review_approved !== true) {
    throw new JobPublishPackageApprovalError(jobId);
  }

  const [job, outputManifest, reviewPackage, approval] = await Promise.all([
    getStoredJob(jobId, options),
    readRequiredJson<ShortVideoMakerOutputManifest>(paths.outputManifestPath, jobId, "output-manifest.json"),
    readRequiredJson<OutputReviewPackage>(paths.reviewPackagePath, jobId, "review-package.json"),
    readRequiredJson<ManualReviewApproval>(paths.manualReviewApprovalPath, jobId, "manual-review-approval.json")
  ]);

  if (approval.status !== "approved") {
    throw new JobPublishPackageApprovalError(jobId);
  }

  const publishPackage: PublishPackage = {
    job_id: jobId,
    status: "ready_for_publish",
    final_video_path: outputManifest.final_video_path ?? reviewPackage.final_video_path ?? status.output_path,
    title: job.title,
    description: job.publish.description ?? null,
    hashtags: getHashtags(job),
    platform_targets: [
      {
        platform: job.platform,
        enabled: false,
        status: "placeholder"
      }
    ],
    approval: {
      approved: true,
      reviewer_note: approval.reviewer_note,
      approval_path: paths.manualReviewApprovalPath,
      approved_at: approval.approved_at
    },
    artifacts: {
      job_path: paths.jobPath,
      status_path: paths.statusPath,
      review_package_path: paths.reviewPackagePath,
      output_manifest_path: paths.outputManifestPath,
      manual_review_approval_path: paths.manualReviewApprovalPath
    },
    metadata: {
      source: "raiz_video_factory",
      created_at: new Date().toISOString()
    }
  };

  await writeFile(paths.publishPackagePath, `${JSON.stringify(publishPackage, null, 2)}\n`);
  await updateJobMetadata(
    jobId,
    {
      publish_package_created: true,
      publish_package_path: paths.publishPackagePath
    },
    options
  );
  await appendJobEvent(
    jobId,
    {
      type: "job.publish_package_created",
      publish_package_path: paths.publishPackagePath
    },
    options
  );

  return publishPackage;
}

async function readRequiredJson<T>(path: string, jobId: string, artifactName: string): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new JobPublishPackageArtifactError(jobId, artifactName);
    }

    throw error;
  }
}

function getHashtags(job: RaizJob): string[] {
  return (job.publish.tags ?? [])
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0)
    .map((tag) => (tag.startsWith("#") ? tag : `#${tag}`));
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
