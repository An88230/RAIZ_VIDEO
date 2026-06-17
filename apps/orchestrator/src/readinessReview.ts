import type { AdapterHealthReport, ShortVideoMakerPayload } from "@raiz/render-adapters";
import { access, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  appendJobEvent,
  getJobPaths,
  getJobStatus,
  type PersistenceOptions,
  updateJobMetadata
} from "./persistence.js";
import type { PreflightReport } from "./preflight.js";

export type ReadinessReviewStatus = "passed" | "failed";
export type ReadinessReviewSeverity = "error" | "warning";

export interface ReadinessReviewCheck {
  name: string;
  passed: boolean;
  severity: ReadinessReviewSeverity;
  message: string;
}

export interface ReadinessReview {
  job_id: string;
  ready_for_dry_run: boolean;
  status: ReadinessReviewStatus;
  checks: ReadinessReviewCheck[];
  warnings: string[];
  errors: string[];
  created_at: string;
}

export class JobReadinessStateError extends Error {
  constructor(jobId: string, status: string) {
    super(`Job ${jobId} must be preparing before readiness review. Current status is ${status}.`);
    this.name = "JobReadinessStateError";
  }
}

export async function runReadinessReview(
  jobId: string,
  options: PersistenceOptions = {}
): Promise<ReadinessReview> {
  const paths = getJobPaths(jobId, options);
  const status = await getJobStatus(jobId, options);

  if (status.status !== "preparing") {
    throw new JobReadinessStateError(jobId, status.status);
  }

  const artifactPresence = {
    job: await pathExists(paths.jobPath),
    status: await pathExists(paths.statusPath),
    events: await pathExists(paths.eventsPath),
    renderPlan: await pathExists(paths.renderPlanPath),
    preflightReport: await pathExists(paths.preflightReportPath),
    adapterHealth: await pathExists(paths.shortVideoMakerAdapterHealthPath),
    shortVideoMakerPayload: await pathExists(paths.shortVideoMakerPayloadPath)
  };
  const [preflightReport, adapterHealthReport, shortVideoMakerPayload] = await Promise.all([
    readJsonIfExists<PreflightReport>(paths.preflightReportPath),
    readJsonIfExists<AdapterHealthReport>(paths.shortVideoMakerAdapterHealthPath),
    readJsonIfExists<ShortVideoMakerPayload>(paths.shortVideoMakerPayloadPath)
  ]);
  const outputLocalPath = shortVideoMakerPayload?.output?.local_path;
  const outputDirectoryExists = outputLocalPath ? await pathExists(dirname(outputLocalPath)) : false;
  const checks = buildChecks({
    artifactPresence,
    statusMetadataPreflightPassed: status.metadata?.preflight_status === "passed",
    preflightReport,
    adapterHealthReport,
    shortVideoMakerPayload,
    outputDirectoryExists
  });
  const errors = checks
    .filter((check) => check.severity === "error" && !check.passed)
    .map((check) => check.message);
  const warnings = checks
    .filter((check) => check.severity === "warning" && !check.passed)
    .map((check) => check.message);
  const review: ReadinessReview = {
    job_id: jobId,
    ready_for_dry_run: errors.length === 0,
    status: errors.length === 0 ? "passed" : "failed",
    checks,
    warnings,
    errors,
    created_at: new Date().toISOString()
  };

  await writeFile(paths.readinessReviewPath, `${JSON.stringify(review, null, 2)}\n`);
  await updateJobMetadata(
    jobId,
    {
      readiness_review_path: paths.readinessReviewPath,
      readiness_status: review.status,
      ready_for_dry_run: review.ready_for_dry_run
    },
    options
  );
  await appendJobEvent(
    jobId,
    {
      type: review.ready_for_dry_run ? "job.readiness_passed" : "job.readiness_failed",
      readiness_review_path: paths.readinessReviewPath,
      ready_for_dry_run: review.ready_for_dry_run,
      errors,
      warnings
    },
    options
  );

  return review;
}

interface BuildChecksInput {
  artifactPresence: {
    job: boolean;
    status: boolean;
    events: boolean;
    renderPlan: boolean;
    preflightReport: boolean;
    adapterHealth: boolean;
    shortVideoMakerPayload: boolean;
  };
  statusMetadataPreflightPassed: boolean;
  preflightReport: PreflightReport | null;
  adapterHealthReport: AdapterHealthReport | null;
  shortVideoMakerPayload: ShortVideoMakerPayload | null;
  outputDirectoryExists: boolean;
}

function buildChecks(input: BuildChecksInput): ReadinessReviewCheck[] {
  const payload = input.shortVideoMakerPayload;

  return [
    errorCheck("job_json_exists", input.artifactPresence.job, "job.json exists."),
    errorCheck("status_json_exists", input.artifactPresence.status, "status.json exists."),
    errorCheck("events_ndjson_exists", input.artifactPresence.events, "events.ndjson exists."),
    errorCheck("render_plan_exists", input.artifactPresence.renderPlan, "render-plan.json exists."),
    errorCheck("preflight_report_exists", input.artifactPresence.preflightReport, "preflight-report.json exists."),
    errorCheck(
      "adapter_health_report_exists",
      input.artifactPresence.adapterHealth,
      "adapter-health.short-video-maker.json exists."
    ),
    errorCheck(
      "short_video_maker_payload_exists",
      input.artifactPresence.shortVideoMakerPayload,
      "short-video-maker-payload.json exists."
    ),
    errorCheck("preflight_metadata_passed", input.statusMetadataPreflightPassed, "status metadata preflight_status is passed."),
    errorCheck("preflight_passed", input.preflightReport?.status === "passed", "preflight-report.json status is passed."),
    errorCheck(
      "adapter_health_acceptable",
      input.adapterHealthReport?.status === "healthy" || input.adapterHealthReport?.status === "degraded",
      "Adapter health status is healthy or degraded."
    ),
    errorCheck("payload_aspect_ratio", payload?.composition?.aspect_ratio === "9:16", "Payload aspect ratio is 9:16."),
    errorCheck("payload_width", payload?.composition?.width === 1080, "Payload width is 1080."),
    errorCheck("payload_height", payload?.composition?.height === 1920, "Payload height is 1920."),
    errorCheck("payload_language", payload?.composition?.language === "ar", "Payload language is Arabic."),
    errorCheck("payload_direction", payload?.composition?.direction === "rtl", "Payload direction is RTL."),
    errorCheck("payload_output_local_path", Boolean(payload?.output?.local_path?.trim()), "Payload output local path exists."),
    errorCheck("output_directory_exists", input.outputDirectoryExists, "Payload output directory exists.")
  ];
}

function errorCheck(name: string, passed: boolean, message: string): ReadinessReviewCheck {
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
