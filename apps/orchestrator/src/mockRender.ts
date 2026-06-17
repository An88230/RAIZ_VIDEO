import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { PreflightReport } from "./preflight.js";
import type { RenderPlan } from "./renderPlan.js";
import {
  appendJobEvent,
  getJobPaths,
  getJobStatus,
  getStoredJob,
  getStoredRenderPlan,
  type JobStatusRecord,
  type PersistenceOptions,
  updateJobStatus
} from "./persistence.js";

export class JobMockRenderStateError extends Error {
  constructor(jobId: string, status: string) {
    super(`Job ${jobId} must be preparing before mock render. Current status is ${status}.`);
    this.name = "JobMockRenderStateError";
  }
}

export class JobMockRenderPreflightError extends Error {
  constructor(jobId: string) {
    super(`Job ${jobId} must pass preflight before mock render.`);
    this.name = "JobMockRenderPreflightError";
  }
}

export async function runMockRender(jobId: string, options: PersistenceOptions = {}): Promise<JobStatusRecord> {
  const paths = getJobPaths(jobId, options);
  const status = await getJobStatus(jobId, options);

  if (status.status !== "preparing") {
    throw new JobMockRenderStateError(jobId, status.status);
  }

  if (status.metadata?.preflight_status !== "passed") {
    throw new JobMockRenderPreflightError(jobId);
  }

  const [job, renderPlan, preflightReport] = await Promise.all([
    getStoredJob(jobId, options),
    getStoredRenderPlan(jobId, options),
    getStoredPreflightReport(jobId, options)
  ]);

  if (preflightReport.status !== "passed") {
    throw new JobMockRenderPreflightError(jobId);
  }

  const startedAt = new Date().toISOString();
  const startedMetadata = {
    ...(status.metadata ?? {}),
    mock_render: true,
    render_started_at: startedAt
  };

  await updateJobStatus(jobId, "rendering", {
    storageRoot: options.storageRoot,
    metadata: startedMetadata
  });
  await appendJobEvent(
    jobId,
    {
      type: "job.mock_render_started",
      output_dir: paths.outputDir
    },
    options
  );

  const completedAt = new Date().toISOString();
  const outputPath = resolve(paths.outputDir, `${jobId}.mock-render.txt`);
  await mkdir(paths.outputDir, { recursive: true });
  await writeFile(outputPath, buildMockRenderArtifact(job, renderPlan, completedAt));
  const completedMetadata = {
    ...startedMetadata,
    render_completed_at: completedAt
  };

  const finalStatus = await updateJobStatus(jobId, "rendered", {
    storageRoot: options.storageRoot,
    output_path: outputPath,
    metadata: completedMetadata
  });
  await appendJobEvent(
    jobId,
    {
      type: "job.mock_render_completed",
      output_path: outputPath
    },
    options
  );

  return finalStatus;
}

async function getStoredPreflightReport(
  jobId: string,
  options: PersistenceOptions = {}
): Promise<PreflightReport> {
  const rawReport = await readFile(getJobPaths(jobId, options).preflightReportPath, "utf8");
  return JSON.parse(rawReport) as PreflightReport;
}

function buildMockRenderArtifact(
  job: Awaited<ReturnType<typeof getStoredJob>>,
  renderPlan: RenderPlan,
  createdAt: string
): string {
  return [
    `job_id: ${job.job_id}`,
    `title: ${job.title}`,
    `language: ${renderPlan.language}`,
    `direction: ${renderPlan.direction}`,
    `aspect_ratio: ${renderPlan.aspect_ratio}`,
    `width: ${renderPlan.width}`,
    `height: ${renderPlan.height}`,
    `template_id: ${renderPlan.template_id}`,
    `adapter: ${renderPlan.adapter}`,
    `engine: ${renderPlan.engine}`,
    `created_at: ${createdAt}`,
    "note: This is a mock render artifact. No video was generated.",
    ""
  ].join("\n");
}
