import { readFile, writeFile } from "node:fs/promises";

import { assertRealRenderAllowed, RealRenderExecutionDisabledError } from "./executionGuard.js";
import type { HttpClient, HttpResponse } from "./httpClient.js";
import {
  appendJobEvent,
  getJobPaths,
  getJobStatus,
  type JobStatusRecord,
  type PersistenceOptions,
  updateJobStatus
} from "./persistence.js";
import type { RealHttpSenderReadinessChecklist } from "./realHttpSenderReadiness.js";
import type { ShortVideoMakerDryRunRequest } from "./shortVideoMakerDryRunRequest.js";
import type { ShortVideoMakerHttpSendPlan } from "./shortVideoMakerHttpSendPlan.js";

export { RealRenderExecutionDisabledError };

export interface ShortVideoMakerSentRequestArtifact {
  job_id: string;
  adapter: "short_video_maker";
  mode: "http";
  method: "POST";
  url: string;
  headers: Record<string, string>;
  body_source_path: string;
  request_body: ShortVideoMakerDryRunRequest;
  created_at: string;
}

export interface ShortVideoMakerRealHttpResponseArtifact {
  job_id: string;
  adapter: "short_video_maker";
  mode: "http";
  status: "submitted";
  http_status: number;
  external_job_id: string | null;
  request_path: string;
  response_body: unknown;
  submitted_at: string;
  message: string;
}

export interface ShortVideoMakerRealHttpErrorArtifact {
  job_id: string;
  adapter: "short_video_maker";
  mode: "http";
  status: "failed";
  request_path: string;
  http_status: number | null;
  response_body: unknown;
  error: string;
  failed_at: string;
}

export class JobRealHttpSenderStateError extends Error {
  constructor(jobId: string, status: string) {
    super(`Job ${jobId} must be preparing before real HTTP send. Current status is ${status}.`);
    this.name = "JobRealHttpSenderStateError";
  }
}

export class JobRealHttpSenderReadinessError extends Error {
  constructor(jobId: string, detail = "Job must pass real HTTP sender readiness before real HTTP send.") {
    super(`Job ${jobId}: ${detail}`);
    this.name = "JobRealHttpSenderReadinessError";
  }
}

export class JobRealHttpSenderSubmitError extends Error {
  artifact_path: string;
  http_status: number | null;

  constructor(jobId: string, artifactPath: string, message: string, httpStatus: number | null = null) {
    super(`Job ${jobId}: ${message}`);
    this.name = "JobRealHttpSenderSubmitError";
    this.artifact_path = artifactPath;
    this.http_status = httpStatus;
  }
}

export async function sendShortVideoMakerWithRealHttp(
  jobId: string,
  httpClient: HttpClient,
  options: PersistenceOptions = {}
): Promise<ShortVideoMakerRealHttpResponseArtifact> {
  const paths = getJobPaths(jobId, options);
  const status = await getJobStatus(jobId, options);

  if (status.status !== "preparing") {
    throw new JobRealHttpSenderStateError(jobId, status.status);
  }

  if (
    status.metadata?.ready_for_real_http_sender !== true ||
    status.metadata.real_http_sender_readiness_status !== "passed"
  ) {
    throw new JobRealHttpSenderReadinessError(jobId);
  }

  const [, dryRunRequest, httpSendPlan, readinessChecklist] = await Promise.all([
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
    readRequiredJson<RealHttpSenderReadinessChecklist>(
      paths.realHttpSenderReadinessPath,
      jobId,
      "real-http-sender-readiness.json"
    )
  ]);

  if (readinessChecklist.status !== "passed" || readinessChecklist.ready_for_real_http_sender !== true) {
    throw new JobRealHttpSenderReadinessError(
      jobId,
      "real-http-sender-readiness.json must be passed before real HTTP send."
    );
  }

  if (
    httpSendPlan.execution !== "planned_only" ||
    httpSendPlan.will_send_network_request !== false ||
    httpSendPlan.method !== "POST" ||
    !httpSendPlan.url.trim()
  ) {
    throw new JobRealHttpSenderReadinessError(jobId, "HTTP send plan is not valid for guarded real send.");
  }

  assertRealRenderAllowed();

  const sentRequest: ShortVideoMakerSentRequestArtifact = {
    job_id: jobId,
    adapter: "short_video_maker",
    mode: "http",
    method: "POST",
    url: httpSendPlan.url,
    headers: httpSendPlan.headers,
    body_source_path: httpSendPlan.body_source_path,
    request_body: dryRunRequest,
    created_at: new Date().toISOString()
  };

  await writeFile(paths.shortVideoMakerSentRequestPath, `${JSON.stringify(sentRequest, null, 2)}\n`);

  const httpResponse = await postWithFailureHandling(jobId, status, httpClient, httpSendPlan, dryRunRequest, options);

  if (!httpResponse.ok) {
    await failAttemptedSend(
      jobId,
      status,
      `HTTP submit failed with status ${httpResponse.status}.`,
      httpResponse.status,
      httpResponse.body,
      options
    );
  }

  const submittedAt = new Date().toISOString();
  const responseArtifact: ShortVideoMakerRealHttpResponseArtifact = {
    job_id: jobId,
    adapter: "short_video_maker",
    mode: "http",
    status: "submitted",
    http_status: httpResponse.status,
    external_job_id: getExternalJobId(httpResponse.body),
    request_path: paths.shortVideoMakerSentRequestPath,
    response_body: httpResponse.body,
    submitted_at: submittedAt,
    message: "Real short-video-maker HTTP request submitted."
  };

  await writeFile(paths.shortVideoMakerResponsePath, `${JSON.stringify(responseArtifact, null, 2)}\n`);
  await updateJobStatus(jobId, "rendering", {
    ...options,
    adapter: "short_video_maker",
    metadata: {
      ...(status.metadata ?? {}),
      short_video_maker_sent_request_path: paths.shortVideoMakerSentRequestPath,
      short_video_maker_response_path: paths.shortVideoMakerResponsePath,
      real_http_send_submitted: true,
      real_http_submitted_at: submittedAt,
      external_job_id: responseArtifact.external_job_id
    }
  });
  await appendJobEvent(
    jobId,
    {
      type: "job.real_http_send_submitted",
      adapter: "short_video_maker",
      request_path: paths.shortVideoMakerSentRequestPath,
      response_path: paths.shortVideoMakerResponsePath,
      http_status: httpResponse.status,
      external_job_id: responseArtifact.external_job_id
    },
    options
  );

  return responseArtifact;
}

async function postWithFailureHandling(
  jobId: string,
  status: JobStatusRecord,
  httpClient: HttpClient,
  httpSendPlan: ShortVideoMakerHttpSendPlan,
  dryRunRequest: ShortVideoMakerDryRunRequest,
  options: PersistenceOptions
): Promise<HttpResponse> {
  try {
    return await httpClient.post(httpSendPlan.url, dryRunRequest, {
      headers: httpSendPlan.headers,
      timeoutMs: httpSendPlan.timeout_ms
    });
  } catch (error) {
    return await failAttemptedSend(jobId, status, getErrorMessage(error), null, null, options);
  }
}

async function failAttemptedSend(
  jobId: string,
  status: JobStatusRecord,
  message: string,
  httpStatus: number | null,
  responseBody: unknown,
  options: PersistenceOptions
): Promise<never> {
  const paths = getJobPaths(jobId, options);
  const failedAt = new Date().toISOString();
  const errorArtifact: ShortVideoMakerRealHttpErrorArtifact = {
    job_id: jobId,
    adapter: "short_video_maker",
    mode: "http",
    status: "failed",
    request_path: paths.shortVideoMakerSentRequestPath,
    http_status: httpStatus,
    response_body: responseBody,
    error: message,
    failed_at: failedAt
  };

  await writeFile(paths.shortVideoMakerErrorPath, `${JSON.stringify(errorArtifact, null, 2)}\n`);
  await updateJobStatus(jobId, "failed", {
    ...options,
    adapter: "short_video_maker",
    error: message,
    metadata: {
      ...(status.metadata ?? {}),
      short_video_maker_sent_request_path: paths.shortVideoMakerSentRequestPath,
      short_video_maker_error_path: paths.shortVideoMakerErrorPath,
      real_http_send_failed: true,
      real_http_failed_at: failedAt
    }
  });
  await appendJobEvent(
    jobId,
    {
      type: "job.real_http_send_failed",
      adapter: "short_video_maker",
      request_path: paths.shortVideoMakerSentRequestPath,
      error_path: paths.shortVideoMakerErrorPath,
      http_status: httpStatus,
      error: message
    },
    options
  );

  throw new JobRealHttpSenderSubmitError(jobId, paths.shortVideoMakerErrorPath, message, httpStatus);
}

async function readRequiredJson<T>(path: string, jobId: string, artifactName: string): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new JobRealHttpSenderReadinessError(jobId, `${artifactName} is required before real HTTP send.`);
    }

    throw error;
  }
}

function getExternalJobId(body: unknown): string | null {
  if (isRecord(body) && typeof body.external_job_id === "string") {
    return body.external_job_id;
  }

  if (isRecord(body) && typeof body.id === "string") {
    return body.id;
  }

  return null;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown real HTTP submit failure.";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
