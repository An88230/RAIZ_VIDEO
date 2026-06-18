import { access, readFile, writeFile } from "node:fs/promises";

import { loadEnvConfig } from "./envConfig.js";
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
import type { ShortVideoMakerMockHttpResponseArtifact } from "./shortVideoMakerMockHttpSender.js";

export type RealHttpSenderReadinessStatus = "passed" | "failed";
export type RealHttpSenderReadinessSeverity = "error" | "warning";

export interface RealHttpSenderReadinessCheck {
  name: string;
  passed: boolean;
  severity: RealHttpSenderReadinessSeverity;
  message: string;
}

export interface RealHttpSenderReadinessChecklist {
  job_id: string;
  ready_for_real_http_sender: boolean;
  status: RealHttpSenderReadinessStatus;
  checks: RealHttpSenderReadinessCheck[];
  warnings: string[];
  errors: string[];
  created_at: string;
}

export class JobRealHttpSenderReadinessStateError extends Error {
  constructor(jobId: string, status: string) {
    super(`Job ${jobId} must be preparing before real HTTP sender readiness checklist. Current status is ${status}.`);
    this.name = "JobRealHttpSenderReadinessStateError";
  }
}

export async function runRealHttpSenderReadinessChecklist(
  jobId: string,
  options: PersistenceOptions = {}
): Promise<RealHttpSenderReadinessChecklist> {
  const paths = getJobPaths(jobId, options);
  const status = await getJobStatus(jobId, options);

  if (status.status !== "preparing") {
    throw new JobRealHttpSenderReadinessStateError(jobId, status.status);
  }

  const artifactPresence = {
    job: await pathExists(paths.jobPath),
    status: await pathExists(paths.statusPath),
    readinessReview: await pathExists(paths.readinessReviewPath),
    dryRunRequest: await pathExists(paths.shortVideoMakerDryRunRequestPath),
    httpSendPlan: await pathExists(paths.shortVideoMakerHttpSendPlanPath),
    mockResponse: await pathExists(paths.shortVideoMakerMockResponsePath)
  };
  const [readinessReview, dryRunRequest, httpSendPlan, mockResponse] = await Promise.all([
    readJsonIfExists<ReadinessReview>(paths.readinessReviewPath),
    readJsonIfExists<ShortVideoMakerDryRunRequest>(paths.shortVideoMakerDryRunRequestPath),
    readJsonIfExists<ShortVideoMakerHttpSendPlan>(paths.shortVideoMakerHttpSendPlanPath),
    readJsonIfExists<ShortVideoMakerMockHttpResponseArtifact>(paths.shortVideoMakerMockResponsePath)
  ]);
  const config = loadEnvConfig();
  const bodySourcePathExists = httpSendPlan?.body_source_path ? await pathExists(httpSendPlan.body_source_path) : false;
  const checks = buildChecks({
    artifactPresence,
    metadata: status.metadata ?? {},
    config,
    readinessReview,
    dryRunRequest,
    httpSendPlan,
    bodySourcePathExists,
    mockResponse
  });
  const errors = checks
    .filter((check) => check.severity === "error" && !check.passed)
    .map((check) => check.message);
  const warnings = checks
    .filter((check) => check.severity === "warning" && !check.passed)
    .map((check) => check.message);
  const checklist: RealHttpSenderReadinessChecklist = {
    job_id: jobId,
    ready_for_real_http_sender: errors.length === 0,
    status: errors.length === 0 ? "passed" : "failed",
    checks,
    warnings,
    errors,
    created_at: new Date().toISOString()
  };

  await writeFile(paths.realHttpSenderReadinessPath, `${JSON.stringify(checklist, null, 2)}\n`);
  await updateJobMetadata(
    jobId,
    {
      real_http_sender_readiness_path: paths.realHttpSenderReadinessPath,
      real_http_sender_readiness_status: checklist.status,
      ready_for_real_http_sender: checklist.ready_for_real_http_sender
    },
    options
  );
  await appendJobEvent(
    jobId,
    {
      type: checklist.ready_for_real_http_sender
        ? "job.real_http_sender_readiness_passed"
        : "job.real_http_sender_readiness_failed",
      real_http_sender_readiness_path: paths.realHttpSenderReadinessPath,
      ready_for_real_http_sender: checklist.ready_for_real_http_sender,
      errors,
      warnings
    },
    options
  );

  return checklist;
}

interface BuildChecksInput {
  artifactPresence: {
    job: boolean;
    status: boolean;
    readinessReview: boolean;
    dryRunRequest: boolean;
    httpSendPlan: boolean;
    mockResponse: boolean;
  };
  metadata: Record<string, unknown>;
  config: {
    shortVideoMakerMode: string;
    shortVideoMakerBaseUrl: string;
    shortVideoMakerTimeoutMs: number;
  };
  readinessReview: ReadinessReview | null;
  dryRunRequest: ShortVideoMakerDryRunRequest | null;
  httpSendPlan: ShortVideoMakerHttpSendPlan | null;
  bodySourcePathExists: boolean;
  mockResponse: ShortVideoMakerMockHttpResponseArtifact | null;
}

function buildChecks(input: BuildChecksInput): RealHttpSenderReadinessCheck[] {
  const plan = input.httpSendPlan;

  return [
    errorCheck("job_json_exists", input.artifactPresence.job, "job.json exists."),
    errorCheck("status_json_exists", input.artifactPresence.status, "status.json exists."),
    errorCheck("readiness_review_exists", input.artifactPresence.readinessReview, "readiness-review.json exists."),
    errorCheck(
      "dry_run_request_exists",
      input.artifactPresence.dryRunRequest,
      "short-video-maker-request.dry-run.json exists."
    ),
    errorCheck(
      "http_send_plan_exists",
      input.artifactPresence.httpSendPlan,
      "short-video-maker-http-send.plan.json exists."
    ),
    errorCheck(
      "mock_response_exists",
      input.artifactPresence.mockResponse,
      "short-video-maker-response.mock.json exists."
    ),
    errorCheck("metadata_ready_for_dry_run", input.metadata.ready_for_dry_run === true, "ready_for_dry_run is true."),
    errorCheck(
      "metadata_dry_run_request_created",
      input.metadata.dry_run_request_created === true,
      "dry_run_request_created is true."
    ),
    errorCheck(
      "metadata_http_send_plan_created",
      input.metadata.http_send_plan_created === true,
      "http_send_plan_created is true."
    ),
    errorCheck(
      "metadata_http_mock_send_completed",
      input.metadata.http_mock_send_completed === true,
      "http_mock_send_completed is true."
    ),
    errorCheck("metadata_readiness_passed", input.metadata.readiness_status === "passed", "readiness_status is passed."),
    errorCheck("readiness_review_passed", input.readinessReview?.status === "passed", "readiness review passed."),
    errorCheck(
      "readiness_review_ready",
      input.readinessReview?.ready_for_dry_run === true,
      "readiness review ready_for_dry_run is true."
    ),
    errorCheck("dry_run_request_adapter", input.dryRunRequest?.adapter === "short_video_maker", "dry-run adapter is short_video_maker."),
    errorCheck("config_mode_http", input.config.shortVideoMakerMode === "http", "short-video-maker mode is http."),
    errorCheck(
      "config_base_url_exists",
      Boolean(input.config.shortVideoMakerBaseUrl.trim()),
      "short-video-maker base URL exists."
    ),
    errorCheck(
      "config_timeout_valid",
      Number.isInteger(input.config.shortVideoMakerTimeoutMs) && input.config.shortVideoMakerTimeoutMs > 0,
      "short-video-maker timeout is a positive integer."
    ),
    errorCheck("http_plan_execution", plan?.execution === "planned_only", "HTTP plan execution is planned_only."),
    errorCheck(
      "http_plan_network_disabled",
      plan?.will_send_network_request === false,
      "HTTP plan will_send_network_request is false."
    ),
    errorCheck("http_plan_method_post", plan?.method === "POST", "HTTP plan method is POST."),
    errorCheck("http_plan_url_exists", Boolean(plan?.url?.trim()), "HTTP plan URL exists."),
    errorCheck("http_plan_body_source_path_exists", input.bodySourcePathExists, "HTTP plan body_source_path exists."),
    errorCheck("mock_response_mode", input.mockResponse?.mode === "http_mock", "Mock response mode is http_mock."),
    errorCheck("mock_response_metadata", input.mockResponse?.metadata?.mocked === true, "Mock response metadata.mocked is true.")
  ];
}

function errorCheck(name: string, passed: boolean, message: string): RealHttpSenderReadinessCheck {
  return { name, passed, severity: "error", message };
}

async function readJsonIfExists<T>(path: string): Promise<T | null> {
  if (!(await pathExists(path))) {
    return null;
  }

  return JSON.parse(await readFile(path, "utf8")) as T;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
