import type { RaizJob } from "@raiz/job-schema";
import { constants } from "node:fs";
import { access, appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export type LocalJobStatus = "queued" | "processing" | "rendered" | "failed";

export interface JobStatusRecord {
  job_id: string;
  status: LocalJobStatus;
  adapter: string;
  created_at: string;
  updated_at: string;
  output_path: string | null;
  error: string | null;
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
  const statusPath = resolve(getJobDir(jobId, options), "status.json");

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

function getJobDir(jobId: string, options: PersistenceOptions): string {
  if (!safeJobIdPattern.test(jobId)) {
    throw new JobNotFoundError(jobId);
  }

  return resolve(getJobsRoot(options), jobId);
}

function getJobsRoot(options: PersistenceOptions): string {
  return resolve(options.storageRoot ?? process.env.RAIZ_STORAGE_DIR ?? "storage", "jobs");
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
