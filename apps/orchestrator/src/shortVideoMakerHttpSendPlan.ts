import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { loadEnvConfig } from "./envConfig.js";
import { getExecutionGuard } from "./executionGuard.js";
import {
  appendJobEvent,
  getJobPaths,
  getJobStatus,
  type PersistenceOptions,
  updateJobMetadata
} from "./persistence.js";
import type { ReadinessReview } from "./readinessReview.js";
import type { ShortVideoMakerDryRunRequest } from "./shortVideoMakerDryRunRequest.js";

export interface ShortVideoMakerHttpSendPlan {
  job_id: string;
  adapter: "short_video_maker";
  mode: "http";
  execution: "planned_only";
  will_send_network_request: false;
  method: "POST";
  url: string;
  timeout_ms: number;
  headers: {
    "content-type": "application/json";
  };
  body_source_path: string;
  expected_response_artifact: string;
  safety: {
    real_render_enabled: boolean;
    will_execute: false;
    will_start_process: false;
    will_generate_video: false;
    will_modify_vendor: false;
    will_make_network_request: false;
  };
  execution_guard_snapshot: {
    real_render_enabled: boolean;
    policy: "blocked_by_default";
  };
  metadata: {
    source: "raiz_video_factory";
    created_at: string;
    endpoint_unconfirmed: false;
    render_path: string;
  };
}

export class JobHttpSendPlanStateError extends Error {
  constructor(jobId: string, status: string) {
    super(`Job ${jobId} must be preparing before HTTP send plan creation. Current status is ${status}.`);
    this.name = "JobHttpSendPlanStateError";
  }
}

export class JobHttpSendPlanReadinessError extends Error {
  constructor(jobId: string, detail = "Job must pass readiness and have a dry-run request before HTTP send plan creation.") {
    super(`Job ${jobId}: ${detail}`);
    this.name = "JobHttpSendPlanReadinessError";
  }
}

export async function createShortVideoMakerHttpSendPlan(
  jobId: string,
  options: PersistenceOptions = {}
): Promise<ShortVideoMakerHttpSendPlan> {
  const paths = getJobPaths(jobId, options);
  const status = await getJobStatus(jobId, options);

  if (status.status !== "preparing") {
    throw new JobHttpSendPlanStateError(jobId, status.status);
  }

  if (
    status.metadata?.ready_for_dry_run !== true ||
    status.metadata.dry_run_request_created !== true ||
    status.metadata.readiness_status !== "passed"
  ) {
    throw new JobHttpSendPlanReadinessError(jobId);
  }

  const [, dryRunRequest, readinessReview] = await Promise.all([
    readRequiredJson<unknown>(paths.jobPath, jobId, "job.json"),
    readRequiredJson<ShortVideoMakerDryRunRequest>(
      paths.shortVideoMakerDryRunRequestPath,
      jobId,
      "short-video-maker-request.dry-run.json"
    ),
    readRequiredJson<ReadinessReview>(paths.readinessReviewPath, jobId, "readiness-review.json")
  ]);

  if (readinessReview.status !== "passed" || readinessReview.ready_for_dry_run !== true) {
    throw new JobHttpSendPlanReadinessError(jobId, "readiness-review.json must be passed and ready_for_dry_run true.");
  }

  const config = loadEnvConfig();
  const executionGuard = getExecutionGuard();
  const plan: ShortVideoMakerHttpSendPlan = {
    job_id: jobId,
    adapter: "short_video_maker",
    mode: config.shortVideoMakerMode,
    execution: "planned_only",
    will_send_network_request: false,
    method: "POST",
    url: `${config.shortVideoMakerBaseUrl.replace(/\/+$/, "")}${config.shortVideoMakerRenderPath}`,
    timeout_ms: config.shortVideoMakerTimeoutMs,
    headers: {
      "content-type": "application/json"
    },
    body_source_path: paths.shortVideoMakerDryRunRequestPath,
    expected_response_artifact: resolve(paths.jobDir, "short-video-maker-response.json"),
    safety: {
      real_render_enabled: config.realRenderEnabled,
      will_execute: false,
      will_start_process: false,
      will_generate_video: false,
      will_modify_vendor: false,
      will_make_network_request: false
    },
    execution_guard_snapshot: {
      real_render_enabled: executionGuard.real_render_enabled,
      policy: executionGuard.policy
    },
    metadata: {
      source: "raiz_video_factory",
      created_at: new Date().toISOString(),
      endpoint_unconfirmed: false,
      render_path: config.shortVideoMakerRenderPath
    }
  };

  if (dryRunRequest.adapter !== "short_video_maker") {
    throw new JobHttpSendPlanReadinessError(jobId, "dry-run request adapter must be short_video_maker.");
  }

  await writeFile(paths.shortVideoMakerHttpSendPlanPath, `${JSON.stringify(plan, null, 2)}\n`);
  await updateJobMetadata(
    jobId,
    {
      short_video_maker_http_send_plan_path: paths.shortVideoMakerHttpSendPlanPath,
      http_send_plan_created: true
    },
    options
  );
  await appendJobEvent(
    jobId,
    {
      type: "job.http_send_plan_created",
      adapter: "short_video_maker",
      plan_path: paths.shortVideoMakerHttpSendPlanPath
    },
    options
  );

  return plan;
}

async function readRequiredJson<T>(path: string, jobId: string, artifactName: string): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new JobHttpSendPlanReadinessError(jobId, `${artifactName} is required before HTTP send plan creation.`);
    }

    throw error;
  }
}
