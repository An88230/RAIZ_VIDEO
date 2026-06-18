import { readFile, writeFile } from "node:fs/promises";

import { assertRealRenderAllowed, RealRenderExecutionDisabledError } from "./executionGuard.js";
import type { HttpClient, HttpResponse } from "./httpClient.js";
import {
  appendJobEvent,
  getJobPaths,
  getJobStatus,
  type PersistenceOptions,
  updateJobMetadata
} from "./persistence.js";
import type { ReadinessReview } from "./readinessReview.js";
import type { ShortVideoMakerDryRunRequest } from "./shortVideoMakerDryRunRequest.js";
import type { ShortVideoMakerHttpSendPlan } from "./shortVideoMakerHttpSendPlan.js";

export { RealRenderExecutionDisabledError };
export type { HttpClient, HttpResponse };

export interface ShortVideoMakerMockHttpResponseArtifact {
  job_id: string;
  adapter: "short_video_maker";
  mode: "http_mock";
  request_plan_path: string;
  status: "submitted_mock";
  http_status: number;
  external_job_id: string;
  response_body: unknown;
  metadata: {
    source: "raiz_video_factory";
    mocked: true;
    created_at: string;
  };
}

export class JobHttpMockSendStateError extends Error {
  constructor(jobId: string, status: string) {
    super(`Job ${jobId} must be preparing before mocked HTTP send. Current status is ${status}.`);
    this.name = "JobHttpMockSendStateError";
  }
}

export class JobHttpMockSendReadinessError extends Error {
  constructor(jobId: string, detail = "Job must be ready and have an HTTP send plan before mocked HTTP send.") {
    super(`Job ${jobId}: ${detail}`);
    this.name = "JobHttpMockSendReadinessError";
  }
}

export async function sendShortVideoMakerWithMockedHttp(
  jobId: string,
  httpClient: HttpClient,
  options: PersistenceOptions = {}
): Promise<ShortVideoMakerMockHttpResponseArtifact> {
  const paths = getJobPaths(jobId, options);
  const status = await getJobStatus(jobId, options);

  if (status.status !== "preparing") {
    throw new JobHttpMockSendStateError(jobId, status.status);
  }

  if (
    status.metadata?.ready_for_dry_run !== true ||
    status.metadata.dry_run_request_created !== true ||
    status.metadata.http_send_plan_created !== true ||
    status.metadata.readiness_status !== "passed"
  ) {
    throw new JobHttpMockSendReadinessError(jobId);
  }

  const [, dryRunRequest, httpSendPlan, readinessReview] = await Promise.all([
    readRequiredJson<unknown>(paths.jobPath, jobId, "job.json"),
    readRequiredJson<ShortVideoMakerDryRunRequest>(
      paths.shortVideoMakerDryRunRequestPath,
      jobId,
      "short-video-maker-request.dry-run.json"
    ),
    readRequiredJson<ShortVideoMakerHttpSendPlan>(
      paths.shortVideoMakerHttpSendPlanPath,
      jobId,
      "short-video-maker-http-send.plan.json"
    ),
    readRequiredJson<ReadinessReview>(paths.readinessReviewPath, jobId, "readiness-review.json")
  ]);

  if (readinessReview.status !== "passed" || readinessReview.ready_for_dry_run !== true) {
    throw new JobHttpMockSendReadinessError(jobId, "readiness-review.json must be passed and ready_for_dry_run true.");
  }

  if (httpSendPlan.execution !== "planned_only" || httpSendPlan.will_send_network_request !== false) {
    throw new JobHttpMockSendReadinessError(jobId, "HTTP send plan must be planned_only with network disabled.");
  }

  const guard = assertRealRenderAllowed();
  const httpResponse = await httpClient.post(httpSendPlan.url, dryRunRequest, {
    headers: httpSendPlan.headers,
    timeoutMs: httpSendPlan.timeout_ms
  });

  if (!httpResponse.ok) {
    throw new JobHttpMockSendReadinessError(jobId, `mocked HTTP client returned status ${httpResponse.status}.`);
  }

  const artifact: ShortVideoMakerMockHttpResponseArtifact = {
    job_id: jobId,
    adapter: "short_video_maker",
    mode: "http_mock",
    request_plan_path: paths.shortVideoMakerHttpSendPlanPath,
    status: "submitted_mock",
    http_status: httpResponse.status,
    external_job_id: getMockExternalJobId(jobId, httpResponse.body),
    response_body: httpResponse.body,
    metadata: {
      source: "raiz_video_factory",
      mocked: true,
      created_at: new Date().toISOString()
    }
  };

  await writeFile(paths.shortVideoMakerMockResponsePath, `${JSON.stringify(artifact, null, 2)}\n`);
  await updateJobMetadata(
    jobId,
    {
      short_video_maker_mock_response_path: paths.shortVideoMakerMockResponsePath,
      http_mock_send_completed: true
    },
    options
  );
  await appendJobEvent(
    jobId,
    {
      type: "job.http_mock_send_completed",
      adapter: "short_video_maker",
      response_path: paths.shortVideoMakerMockResponsePath,
      http_status: httpResponse.status,
      guard_real_render_enabled: guard.real_render_enabled
    },
    options
  );

  return artifact;
}

async function readRequiredJson<T>(path: string, jobId: string, artifactName: string): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new JobHttpMockSendReadinessError(jobId, `${artifactName} is required before mocked HTTP send.`);
    }

    throw error;
  }
}

function getMockExternalJobId(jobId: string, body: unknown): string {
  if (isRecord(body) && typeof body.external_job_id === "string" && body.external_job_id.startsWith("mock-")) {
    return body.external_job_id;
  }

  return `mock-${jobId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
