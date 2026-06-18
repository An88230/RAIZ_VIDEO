import { readFile, writeFile } from "node:fs/promises";

import {
  appendJobEvent,
  getJobPaths,
  getJobStatus,
  type PersistenceOptions,
  updateJobMetadata
} from "./persistence.js";
import type { PublishPackage } from "./publishPackage.js";

export interface YouTubeUploadPlan {
  job_id: string;
  platform: "youtube";
  mode: "upload_plan";
  video_path: string;
  title: string;
  description: string | null;
  tags: string[];
  privacyStatus: "placeholder";
  made_for_kids: false;
  publish_package_path: string;
  safety: {
    will_upload: false;
    will_make_network_request: false;
    will_modify_video: false;
  };
  metadata: {
    source: "raiz_video_factory";
    created_at: string;
  };
}

export class JobYouTubeUploadPlanStateError extends Error {
  constructor(jobId: string, status: string) {
    super(`Job ${jobId} must be rendered before YouTube upload plan creation. Current status is ${status}.`);
    this.name = "JobYouTubeUploadPlanStateError";
  }
}

export class JobYouTubeUploadPlanReadinessError extends Error {
  constructor(jobId: string, detail = "Job must have a publish package and manual approval before YouTube upload plan creation.") {
    super(`Job ${jobId}: ${detail}`);
    this.name = "JobYouTubeUploadPlanReadinessError";
  }
}

export class JobYouTubeUploadPlanArtifactError extends Error {
  constructor(jobId: string, artifactName: string) {
    super(`Job ${jobId} requires ${artifactName} before YouTube upload plan creation.`);
    this.name = "JobYouTubeUploadPlanArtifactError";
  }
}

export async function createYouTubeUploadPlan(
  jobId: string,
  options: PersistenceOptions = {}
): Promise<YouTubeUploadPlan> {
  const paths = getJobPaths(jobId, options);
  const status = await getJobStatus(jobId, options);

  if (status.status !== "rendered") {
    throw new JobYouTubeUploadPlanStateError(jobId, status.status);
  }

  if (status.metadata?.publish_package_created !== true || status.metadata.manual_review_approved !== true) {
    throw new JobYouTubeUploadPlanReadinessError(jobId);
  }

  const publishPackage = await readRequiredJson<PublishPackage>(
    paths.publishPackagePath,
    jobId,
    "publish-package.json"
  );

  if (publishPackage.status !== "ready_for_publish") {
    throw new JobYouTubeUploadPlanReadinessError(jobId, "publish-package.json must be ready_for_publish.");
  }

  if (typeof publishPackage.final_video_path !== "string" || publishPackage.final_video_path.trim().length === 0) {
    throw new JobYouTubeUploadPlanReadinessError(jobId, "publish-package.json must include a final video path.");
  }

  const plan: YouTubeUploadPlan = {
    job_id: jobId,
    platform: "youtube",
    mode: "upload_plan",
    video_path: publishPackage.final_video_path,
    title: publishPackage.title,
    description: publishPackage.description,
    tags: publishPackage.hashtags.map((tag) => tag.replace(/^#/, "")),
    privacyStatus: "placeholder",
    made_for_kids: false,
    publish_package_path: paths.publishPackagePath,
    safety: {
      will_upload: false,
      will_make_network_request: false,
      will_modify_video: false
    },
    metadata: {
      source: "raiz_video_factory",
      created_at: new Date().toISOString()
    }
  };

  await writeFile(paths.youtubeUploadPlanPath, `${JSON.stringify(plan, null, 2)}\n`);
  await updateJobMetadata(
    jobId,
    {
      youtube_upload_plan_created: true,
      youtube_upload_plan_path: paths.youtubeUploadPlanPath
    },
    options
  );
  await appendJobEvent(
    jobId,
    {
      type: "job.youtube_upload_plan_created",
      youtube_upload_plan_path: paths.youtubeUploadPlanPath
    },
    options
  );

  return plan;
}

async function readRequiredJson<T>(path: string, jobId: string, artifactName: string): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new JobYouTubeUploadPlanArtifactError(jobId, artifactName);
    }

    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
