import type { RaizJob } from "@raiz/job-schema";
import {
  mapToShortVideoMakerPayload,
  type AdapterHealthReport,
  type ShortVideoMakerPayload,
  type ShortVideoMakerPreflightReportInput
} from "@raiz/render-adapters";
import { constants } from "node:fs";
import { access, appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { loadEnvConfig } from "./envConfig.js";
import { prepareRenderPlan, type RenderPlan } from "./renderPlan.js";
import { assertValidStatusTransition, type LocalJobStatus } from "./statusTransitions.js";

export interface JobStatusRecord {
  job_id: string;
  status: LocalJobStatus;
  adapter: string;
  created_at: string;
  updated_at: string;
  output_path: string | null;
  error: string | null;
  metadata?: Record<string, unknown>;
}

export interface JobEvent {
  type: string;
  timestamp?: string;
  job_id?: string;
  [key: string]: unknown;
}

export interface PersistenceOptions {
  storageRoot?: string;
  allowOverwrite?: boolean;
  adapter?: string;
}

export interface UpdateJobStatusOptions extends PersistenceOptions {
  output_path?: string | null;
  error?: string | null;
  metadata?: Record<string, unknown>;
}

export interface JobPaths {
  jobDir: string;
  jobPath: string;
  statusPath: string;
  eventsPath: string;
  renderPlanPath: string;
  outputDir: string;
  preflightReportPath: string;
  shortVideoMakerAdapterHealthPath: string;
  shortVideoMakerPayloadPath: string;
  readinessReviewPath: string;
  shortVideoMakerDryRunRequestPath: string;
  shortVideoMakerHttpSendPlanPath: string;
  shortVideoMakerMockResponsePath: string;
}

export class JobConflictError extends Error {
  constructor(jobId: string) {
    super(`Job ${jobId} already exists.`);
    this.name = "JobConflictError";
  }
}

export class JobNotFoundError extends Error {
  constructor(jobId: string) {
    super(`Job ${jobId} does not exist.`);
    this.name = "JobNotFoundError";
  }
}

export class JobAdapterPayloadStateError extends Error {
  constructor(jobId: string, status: string) {
    super(`Job ${jobId} must be preparing before adapter payload creation. Current status is ${status}.`);
    this.name = "JobAdapterPayloadStateError";
  }
}

export class JobAdapterPayloadPreflightError extends Error {
  constructor(jobId: string) {
    super(`Job ${jobId} must pass preflight before adapter payload creation.`);
    this.name = "JobAdapterPayloadPreflightError";
  }
}

const safeJobIdPattern = /^[a-zA-Z0-9_-]+$/;

export async function createJobRecord(job: RaizJob, options: PersistenceOptions = {}): Promise<JobStatusRecord> {
  const jobDir = getJobDir(job.job_id, options);

  if (!options.allowOverwrite && (await pathExists(jobDir))) {
    throw new JobConflictError(job.job_id);
  }

  await mkdir(jobDir, { recursive: true });

  const timestamp = new Date().toISOString();
  const status: JobStatusRecord = {
    job_id: job.job_id,
    status: "queued",
    adapter: options.adapter ?? job.template.engine,
    created_at: timestamp,
    updated_at: timestamp,
    output_path: null,
    error: null
  };

  await writeFile(resolve(jobDir, "job.json"), `${JSON.stringify(job, null, 2)}\n`, { flag: "wx" });
  await writeFile(resolve(jobDir, "status.json"), `${JSON.stringify(status, null, 2)}\n`, { flag: "wx" });
  await appendJobEvent(
    job.job_id,
    {
      type: "job.queued",
      timestamp,
      job_id: job.job_id
    },
    options
  );

  return status;
}

export async function getJobStatus(jobId: string, options: PersistenceOptions = {}): Promise<JobStatusRecord> {
  const statusPath = getJobPaths(jobId, options).statusPath;

  try {
    const rawStatus = await readFile(statusPath, "utf8");
    return JSON.parse(rawStatus) as JobStatusRecord;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new JobNotFoundError(jobId);
    }

    throw error;
  }
}

export async function updateJobMetadata(
  jobId: string,
  metadata: Record<string, unknown>,
  options: PersistenceOptions = {}
): Promise<JobStatusRecord> {
  const currentStatus = await getJobStatus(jobId, options);
  const nextStatusRecord: JobStatusRecord = {
    ...currentStatus,
    updated_at: new Date().toISOString(),
    metadata: {
      ...(currentStatus.metadata ?? {}),
      ...metadata
    }
  };

  await writeFile(getJobPaths(jobId, options).statusPath, `${JSON.stringify(nextStatusRecord, null, 2)}\n`);
  return nextStatusRecord;
}

export async function writeJobAdapterHealthReport(
  jobId: string,
  report: AdapterHealthReport,
  options: PersistenceOptions = {}
): Promise<void> {
  await getJobStatus(jobId, options);
  const paths = getJobPaths(jobId, options);

  await writeFile(paths.shortVideoMakerAdapterHealthPath, `${JSON.stringify(report, null, 2)}\n`);
  await appendJobEvent(
    jobId,
    {
      type: "job.adapter_health_checked",
      adapter: "short_video_maker",
      report_path: paths.shortVideoMakerAdapterHealthPath,
      health_status: report.status
    },
    options
  );
}

export async function createShortVideoMakerPayload(
  jobId: string,
  options: PersistenceOptions = {}
): Promise<ShortVideoMakerPayload> {
  const status = await getJobStatus(jobId, options);

  if (status.status !== "preparing") {
    throw new JobAdapterPayloadStateError(jobId, status.status);
  }

  if (status.metadata?.preflight_status !== "passed") {
    throw new JobAdapterPayloadPreflightError(jobId);
  }

  const [job, renderPlan, preflightReport] = await Promise.all([
    getStoredJob(jobId, options),
    getStoredRenderPlan(jobId, options),
    getStoredPreflightReport(jobId, options)
  ]);

  if (preflightReport.status !== "passed") {
    throw new JobAdapterPayloadPreflightError(jobId);
  }

  const paths = getJobPaths(jobId, options);
  const payload = mapToShortVideoMakerPayload({
    job,
    renderPlan,
    preflightReport
  });

  await writeFile(paths.shortVideoMakerPayloadPath, `${JSON.stringify(payload, null, 2)}\n`);
  await updateJobMetadata(
    jobId,
    {
      short_video_maker_payload_path: paths.shortVideoMakerPayloadPath
    },
    options
  );
  await appendJobEvent(
    jobId,
    {
      type: "job.adapter_payload_created",
      adapter: "short_video_maker",
      payload_path: paths.shortVideoMakerPayloadPath
    },
    options
  );

  return payload;
}

export async function prepareJob(jobId: string, options: PersistenceOptions = {}): Promise<RenderPlan> {
  const currentStatus = await getJobStatus(jobId, options);
  assertValidStatusTransition(currentStatus.status, "preparing");

  const job = await getStoredJob(jobId, options);
  const paths = getJobPaths(jobId, options);
  const renderPlan = prepareRenderPlan(job, {
    outputLocalPath: resolve(paths.outputDir, job.output.filename)
  });

  await mkdir(paths.outputDir, { recursive: true });
  await writeFile(resolve(paths.outputDir, ".gitkeep"), "");
  await writeFile(paths.renderPlanPath, `${JSON.stringify(renderPlan, null, 2)}\n`, { flag: "wx" });

  const metadata = {
    ...(currentStatus.metadata ?? {}),
    render_plan_path: paths.renderPlanPath,
    output_dir: paths.outputDir
  };

  await updateJobStatus(jobId, "preparing", {
    storageRoot: options.storageRoot,
    adapter: options.adapter,
    metadata
  });
  await appendJobEvent(
    jobId,
    {
      type: "job.render_plan_created",
      render_plan_path: paths.renderPlanPath,
      output_dir: paths.outputDir
    },
    options
  );

  return renderPlan;
}

export async function updateJobStatus(
  jobId: string,
  nextStatus: LocalJobStatus,
  options: UpdateJobStatusOptions = {}
): Promise<JobStatusRecord> {
  const currentStatus = await getJobStatus(jobId, options);
  assertValidStatusTransition(currentStatus.status, nextStatus);

  const timestamp = new Date().toISOString();
  const nextStatusRecord: JobStatusRecord = {
    ...currentStatus,
    status: nextStatus,
    adapter: options.adapter ?? currentStatus.adapter,
    updated_at: timestamp
  };

  if (options.output_path !== undefined) {
    nextStatusRecord.output_path = options.output_path;
  }

  if (options.error !== undefined) {
    nextStatusRecord.error = options.error;
  }

  if (options.metadata !== undefined) {
    nextStatusRecord.metadata = options.metadata;
  }

  await writeFile(resolve(getJobDir(jobId, options), "status.json"), `${JSON.stringify(nextStatusRecord, null, 2)}\n`);
  await appendJobEvent(
    jobId,
    {
      type: "job.status_changed",
      job_id: jobId,
      from: currentStatus.status,
      to: nextStatus,
      timestamp,
      ...(options.metadata !== undefined ? { metadata: options.metadata } : {})
    },
    options
  );

  return nextStatusRecord;
}

export async function getStoredJob(jobId: string, options: PersistenceOptions = {}): Promise<RaizJob> {
  const jobPath = getJobPaths(jobId, options).jobPath;

  try {
    const rawJob = await readFile(jobPath, "utf8");
    return JSON.parse(rawJob) as RaizJob;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new JobNotFoundError(jobId);
    }

    throw error;
  }
}

export async function getStoredRenderPlan(jobId: string, options: PersistenceOptions = {}): Promise<RenderPlan> {
  const renderPlanPath = getJobPaths(jobId, options).renderPlanPath;

  try {
    const rawPlan = await readFile(renderPlanPath, "utf8");
    return JSON.parse(rawPlan) as RenderPlan;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new JobNotFoundError(jobId);
    }

    throw error;
  }
}

async function getStoredPreflightReport(
  jobId: string,
  options: PersistenceOptions = {}
): Promise<ShortVideoMakerPreflightReportInput> {
  const preflightReportPath = getJobPaths(jobId, options).preflightReportPath;

  try {
    const rawReport = await readFile(preflightReportPath, "utf8");
    return JSON.parse(rawReport) as ShortVideoMakerPreflightReportInput;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new JobNotFoundError(jobId);
    }

    throw error;
  }
}

export async function appendJobEvent(
  jobId: string,
  event: JobEvent,
  options: PersistenceOptions = {}
): Promise<void> {
  const jobDir = getJobDir(jobId, options);
  const timestampedEvent = {
    ...event,
    timestamp: event.timestamp ?? new Date().toISOString(),
    job_id: event.job_id ?? jobId
  };

  await appendFile(resolve(jobDir, "events.ndjson"), `${JSON.stringify(timestampedEvent)}\n`);
}

export function getJobPaths(jobId: string, options: PersistenceOptions = {}): JobPaths {
  const jobDir = getJobDir(jobId, options);

  return {
    jobDir,
    jobPath: resolve(jobDir, "job.json"),
    statusPath: resolve(jobDir, "status.json"),
    eventsPath: resolve(jobDir, "events.ndjson"),
    renderPlanPath: resolve(jobDir, "render-plan.json"),
    outputDir: resolve(jobDir, "output"),
    preflightReportPath: resolve(jobDir, "preflight-report.json"),
    shortVideoMakerAdapterHealthPath: resolve(jobDir, "adapter-health.short-video-maker.json"),
    shortVideoMakerPayloadPath: resolve(jobDir, "short-video-maker-payload.json"),
    readinessReviewPath: resolve(jobDir, "readiness-review.json"),
    shortVideoMakerDryRunRequestPath: resolve(jobDir, "short-video-maker-request.dry-run.json"),
    shortVideoMakerHttpSendPlanPath: resolve(jobDir, "short-video-maker-http-send.plan.json"),
    shortVideoMakerMockResponsePath: resolve(jobDir, "short-video-maker-response.mock.json")
  };
}

function getJobDir(jobId: string, options: PersistenceOptions): string {
  if (!safeJobIdPattern.test(jobId)) {
    throw new JobNotFoundError(jobId);
  }

  return resolve(getJobsRoot(options), jobId);
}

function getJobsRoot(options: PersistenceOptions): string {
  if (options.storageRoot) {
    return resolve(options.storageRoot, "jobs");
  }

  return resolve(loadEnvConfig().storageDir);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
