import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";

import {
  appendJobEvent,
  getJobPaths,
  getJobStatus,
  type PersistenceOptions,
  updateJobMetadata
} from "./persistence.js";
import type { PublishPackage } from "./publishPackage.js";
import type { YouTubeUploadPlan } from "./youtubeUploadPlan.js";

export interface GoogleDriveExportPlan {
  job_id: string;
  platform: "google_drive";
  mode: "export_plan";
  source_video_path: string;
  filename: string;
  title: string;
  description: string | null;
  target: {
    type: "google_drive_folder";
    folder_id: "placeholder";
    folder_name: "placeholder";
  };
  publish_package_path: string;
  youtube_upload_plan_path: string;
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

export class JobGoogleDriveExportPlanStateError extends Error {
  constructor(jobId: string, status: string) {
    super(`Job ${jobId} must be rendered before Google Drive export plan creation. Current status is ${status}.`);
    this.name = "JobGoogleDriveExportPlanStateError";
  }
}

export class JobGoogleDriveExportPlanReadinessError extends Error {
  constructor(
    jobId: string,
    detail = "Job must have publish package and YouTube upload plan before Google Drive export plan creation."
  ) {
    super(`Job ${jobId}: ${detail}`);
    this.name = "JobGoogleDriveExportPlanReadinessError";
  }
}

export class JobGoogleDriveExportPlanArtifactError extends Error {
  constructor(jobId: string, artifactName: string) {
    super(`Job ${jobId} requires ${artifactName} before Google Drive export plan creation.`);
    this.name = "JobGoogleDriveExportPlanArtifactError";
  }
}

export async function createGoogleDriveExportPlan(
  jobId: string,
  options: PersistenceOptions = {}
): Promise<GoogleDriveExportPlan> {
  const paths = getJobPaths(jobId, options);
  const status = await getJobStatus(jobId, options);

  if (status.status !== "rendered") {
    throw new JobGoogleDriveExportPlanStateError(jobId, status.status);
  }

  if (status.metadata?.publish_package_created !== true || status.metadata.youtube_upload_plan_created !== true) {
    throw new JobGoogleDriveExportPlanReadinessError(jobId);
  }

  const [publishPackage, youtubeUploadPlan] = await Promise.all([
    readRequiredJson<PublishPackage>(paths.publishPackagePath, jobId, "publish-package.json"),
    readRequiredJson<YouTubeUploadPlan>(paths.youtubeUploadPlanPath, jobId, "youtube-upload.plan.json")
  ]);

  if (publishPackage.status !== "ready_for_publish") {
    throw new JobGoogleDriveExportPlanReadinessError(jobId, "publish-package.json must be ready_for_publish.");
  }

  if (youtubeUploadPlan.mode !== "upload_plan") {
    throw new JobGoogleDriveExportPlanReadinessError(jobId, "youtube-upload.plan.json must be an upload plan.");
  }

  if (typeof publishPackage.final_video_path !== "string" || publishPackage.final_video_path.trim().length === 0) {
    throw new JobGoogleDriveExportPlanReadinessError(jobId, "publish-package.json must include a final video path.");
  }

  const plan: GoogleDriveExportPlan = {
    job_id: jobId,
    platform: "google_drive",
    mode: "export_plan",
    source_video_path: publishPackage.final_video_path,
    filename: basename(publishPackage.final_video_path),
    title: publishPackage.title,
    description: publishPackage.description,
    target: {
      type: "google_drive_folder",
      folder_id: "placeholder",
      folder_name: "placeholder"
    },
    publish_package_path: paths.publishPackagePath,
    youtube_upload_plan_path: paths.youtubeUploadPlanPath,
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

  await writeFile(paths.googleDriveExportPlanPath, `${JSON.stringify(plan, null, 2)}\n`);
  await updateJobMetadata(
    jobId,
    {
      google_drive_export_plan_created: true,
      google_drive_export_plan_path: paths.googleDriveExportPlanPath
    },
    options
  );
  await appendJobEvent(
    jobId,
    {
      type: "job.google_drive_export_plan_created",
      google_drive_export_plan_path: paths.googleDriveExportPlanPath
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
      throw new JobGoogleDriveExportPlanArtifactError(jobId, artifactName);
    }

    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
