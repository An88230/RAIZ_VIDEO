import { readFile, writeFile } from "node:fs/promises";

import type { GoogleDriveExportPlan } from "./googleDriveExportPlan.js";
import {
  appendJobEvent,
  getJobPaths,
  getJobStatus,
  type PersistenceOptions,
  updateJobMetadata
} from "./persistence.js";
import type { PublishPackage } from "./publishPackage.js";
import type { YouTubeUploadPlan } from "./youtubeUploadPlan.js";

export interface N8nWorkflowPlan {
  job_id: string;
  platform: "n8n";
  mode: "workflow_plan";
  trigger: {
    type: "manual";
    execution: "disabled";
  };
  inputs: {
    publish_package_path: string;
    youtube_upload_plan_path: string;
    google_drive_export_plan_path: string;
  };
  workflow_steps: Array<{
    name: string;
    action: string;
    enabled: false;
  }>;
  references: {
    final_video_path: string | null;
    youtube_title: string;
    google_drive_filename: string;
  };
  safety: {
    will_execute_workflow: false;
    will_make_network_request: false;
    will_upload: false;
    will_modify_video: false;
  };
  metadata: {
    source: "raiz_video_factory";
    created_at: string;
  };
}

export class JobN8nWorkflowPlanStateError extends Error {
  constructor(jobId: string, status: string) {
    super(`Job ${jobId} must be rendered before n8n workflow plan creation. Current status is ${status}.`);
    this.name = "JobN8nWorkflowPlanStateError";
  }
}

export class JobN8nWorkflowPlanReadinessError extends Error {
  constructor(
    jobId: string,
    detail = "Job must have publish, YouTube upload, and Google Drive export plans before n8n workflow plan creation."
  ) {
    super(`Job ${jobId}: ${detail}`);
    this.name = "JobN8nWorkflowPlanReadinessError";
  }
}

export class JobN8nWorkflowPlanArtifactError extends Error {
  constructor(jobId: string, artifactName: string) {
    super(`Job ${jobId} requires ${artifactName} before n8n workflow plan creation.`);
    this.name = "JobN8nWorkflowPlanArtifactError";
  }
}

export async function createN8nWorkflowPlan(
  jobId: string,
  options: PersistenceOptions = {}
): Promise<N8nWorkflowPlan> {
  const paths = getJobPaths(jobId, options);
  const status = await getJobStatus(jobId, options);

  if (status.status !== "rendered") {
    throw new JobN8nWorkflowPlanStateError(jobId, status.status);
  }

  if (
    status.metadata?.publish_package_created !== true ||
    status.metadata.youtube_upload_plan_created !== true ||
    status.metadata.google_drive_export_plan_created !== true
  ) {
    throw new JobN8nWorkflowPlanReadinessError(jobId);
  }

  const [publishPackage, youtubeUploadPlan, googleDriveExportPlan] = await Promise.all([
    readRequiredJson<PublishPackage>(paths.publishPackagePath, jobId, "publish-package.json"),
    readRequiredJson<YouTubeUploadPlan>(paths.youtubeUploadPlanPath, jobId, "youtube-upload.plan.json"),
    readRequiredJson<GoogleDriveExportPlan>(paths.googleDriveExportPlanPath, jobId, "google-drive-export.plan.json")
  ]);

  if (publishPackage.status !== "ready_for_publish") {
    throw new JobN8nWorkflowPlanReadinessError(jobId, "publish-package.json must be ready_for_publish.");
  }

  if (youtubeUploadPlan.mode !== "upload_plan") {
    throw new JobN8nWorkflowPlanReadinessError(jobId, "youtube-upload.plan.json must be an upload plan.");
  }

  if (googleDriveExportPlan.mode !== "export_plan") {
    throw new JobN8nWorkflowPlanReadinessError(jobId, "google-drive-export.plan.json must be an export plan.");
  }

  const plan: N8nWorkflowPlan = {
    job_id: jobId,
    platform: "n8n",
    mode: "workflow_plan",
    trigger: {
      type: "manual",
      execution: "disabled"
    },
    inputs: {
      publish_package_path: paths.publishPackagePath,
      youtube_upload_plan_path: paths.youtubeUploadPlanPath,
      google_drive_export_plan_path: paths.googleDriveExportPlanPath
    },
    workflow_steps: [
      {
        name: "youtube_upload",
        action: "Use youtube-upload.plan.json in a future workflow.",
        enabled: false
      },
      {
        name: "google_drive_export",
        action: "Use google-drive-export.plan.json in a future workflow.",
        enabled: false
      }
    ],
    references: {
      final_video_path: publishPackage.final_video_path,
      youtube_title: youtubeUploadPlan.title,
      google_drive_filename: googleDriveExportPlan.filename
    },
    safety: {
      will_execute_workflow: false,
      will_make_network_request: false,
      will_upload: false,
      will_modify_video: false
    },
    metadata: {
      source: "raiz_video_factory",
      created_at: new Date().toISOString()
    }
  };

  await writeFile(paths.n8nWorkflowPlanPath, `${JSON.stringify(plan, null, 2)}\n`);
  await updateJobMetadata(
    jobId,
    {
      n8n_workflow_plan_created: true,
      n8n_workflow_plan_path: paths.n8nWorkflowPlanPath
    },
    options
  );
  await appendJobEvent(
    jobId,
    {
      type: "job.n8n_workflow_plan_created",
      n8n_workflow_plan_path: paths.n8nWorkflowPlanPath
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
      throw new JobN8nWorkflowPlanArtifactError(jobId, artifactName);
    }

    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
