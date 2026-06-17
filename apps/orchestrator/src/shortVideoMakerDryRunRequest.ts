import type { AdapterHealthReport, ShortVideoMakerPayload } from "@raiz/render-adapters";
import { readFile, writeFile } from "node:fs/promises";

import {
  appendJobEvent,
  getJobPaths,
  getJobStatus,
  type PersistenceOptions,
  updateJobMetadata
} from "./persistence.js";
import type { PreflightReport } from "./preflight.js";
import type { ReadinessReview } from "./readinessReview.js";
import type { RenderPlan } from "./renderPlan.js";

export interface ShortVideoMakerDryRunRequest {
  job_id: string;
  adapter: "short_video_maker";
  mode: "dry_run";
  target: {
    type: "local_upstream_adapter";
    vendor_path: "vendor/short-video-maker";
    execution: "disabled";
  };
  request: {
    composition: ShortVideoMakerPayload["composition"];
    script: ShortVideoMakerPayload["script"];
    voice: ShortVideoMakerPayload["voice"];
    captions: ShortVideoMakerPayload["captions"];
    assets: ShortVideoMakerPayload["assets"];
    output: ShortVideoMakerPayload["output"];
  };
  safety: {
    will_execute: false;
    will_start_process: false;
    will_generate_video: false;
    will_modify_vendor: false;
  };
  metadata: {
    source: "raiz_video_factory";
    created_at: string;
  };
}

export class JobDryRunStateError extends Error {
  constructor(jobId: string, status: string) {
    super(`Job ${jobId} must be preparing before short-video-maker dry-run request creation. Current status is ${status}.`);
    this.name = "JobDryRunStateError";
  }
}

export class JobDryRunReadinessError extends Error {
  constructor(jobId: string, detail = "Job must pass readiness review before short-video-maker dry-run request creation.") {
    super(`Job ${jobId}: ${detail}`);
    this.name = "JobDryRunReadinessError";
  }
}

export async function createShortVideoMakerDryRunRequest(
  jobId: string,
  options: PersistenceOptions = {}
): Promise<ShortVideoMakerDryRunRequest> {
  const paths = getJobPaths(jobId, options);
  const status = await getJobStatus(jobId, options);

  if (status.status !== "preparing") {
    throw new JobDryRunStateError(jobId, status.status);
  }

  if (
    status.metadata?.preflight_status !== "passed" ||
    status.metadata.readiness_status !== "passed" ||
    status.metadata.ready_for_dry_run !== true
  ) {
    throw new JobDryRunReadinessError(jobId);
  }

  const [, , , preflightReport, adapterHealthReport, payload, readinessReview] = await Promise.all([
    readRequiredJson<unknown>(paths.jobPath, jobId, "job.json"),
    readRequiredJson<RenderPlan>(paths.renderPlanPath, jobId, "render-plan.json"),
    readRequiredText(paths.eventsPath, jobId, "events.ndjson"),
    readRequiredJson<PreflightReport>(paths.preflightReportPath, jobId, "preflight-report.json"),
    readRequiredJson<AdapterHealthReport>(paths.shortVideoMakerAdapterHealthPath, jobId, "adapter-health.short-video-maker.json"),
    readRequiredJson<ShortVideoMakerPayload>(paths.shortVideoMakerPayloadPath, jobId, "short-video-maker-payload.json"),
    readRequiredJson<ReadinessReview>(paths.readinessReviewPath, jobId, "readiness-review.json")
  ]);

  if (preflightReport.status !== "passed") {
    throw new JobDryRunReadinessError(jobId, "preflight-report.json must have status passed.");
  }

  if (adapterHealthReport.status !== "healthy" && adapterHealthReport.status !== "degraded") {
    throw new JobDryRunReadinessError(jobId, "adapter health must be healthy or degraded.");
  }

  if (readinessReview.status !== "passed" || readinessReview.ready_for_dry_run !== true) {
    throw new JobDryRunReadinessError(jobId, "readiness-review.json must be passed and ready_for_dry_run true.");
  }

  const dryRunRequest: ShortVideoMakerDryRunRequest = {
    job_id: jobId,
    adapter: "short_video_maker",
    mode: "dry_run",
    target: {
      type: "local_upstream_adapter",
      vendor_path: "vendor/short-video-maker",
      execution: "disabled"
    },
    request: {
      composition: payload.composition,
      script: payload.script,
      voice: payload.voice,
      captions: payload.captions,
      assets: payload.assets,
      output: payload.output
    },
    safety: {
      will_execute: false,
      will_start_process: false,
      will_generate_video: false,
      will_modify_vendor: false
    },
    metadata: {
      source: "raiz_video_factory",
      created_at: new Date().toISOString()
    }
  };

  await writeFile(paths.shortVideoMakerDryRunRequestPath, `${JSON.stringify(dryRunRequest, null, 2)}\n`);
  await updateJobMetadata(
    jobId,
    {
      short_video_maker_dry_run_request_path: paths.shortVideoMakerDryRunRequestPath,
      dry_run_request_created: true
    },
    options
  );
  await appendJobEvent(
    jobId,
    {
      type: "job.adapter_dry_run_request_created",
      adapter: "short_video_maker",
      request_path: paths.shortVideoMakerDryRunRequestPath
    },
    options
  );

  return dryRunRequest;
}

async function readRequiredJson<T>(path: string, jobId: string, artifactName: string): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    throwDryRunArtifactError(jobId, artifactName, error);
  }
}

async function readRequiredText(path: string, jobId: string, artifactName: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    throwDryRunArtifactError(jobId, artifactName, error);
  }
}

function throwDryRunArtifactError(jobId: string, artifactName: string, error: unknown): never {
  if (error instanceof Error && "code" in error && error.code === "ENOENT") {
    throw new JobDryRunReadinessError(jobId, `${artifactName} is required before dry-run request creation.`);
  }

  throw error;
}
