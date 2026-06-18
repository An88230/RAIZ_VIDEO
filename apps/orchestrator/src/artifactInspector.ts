import { access, readdir, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";

import { getJobPaths, JobNotFoundError, type PersistenceOptions } from "./persistence.js";

export type JobArtifactType =
  | "job_payload"
  | "job_status"
  | "event_log"
  | "render_plan"
  | "preflight_report"
  | "adapter_health"
  | "adapter_payload"
  | "adapter_dry_run_request"
  | "adapter_http_send_plan"
  | "adapter_http_mock_response"
  | "output_dir"
  | "output_file";

export interface JobArtifactEntry {
  name: string;
  type: JobArtifactType;
  path: string;
  exists: boolean;
  size_bytes: number | null;
  updated_at: string | null;
}

export interface JobArtifactsInventory {
  job_id: string;
  job_dir: string;
  artifacts: JobArtifactEntry[];
  summary: {
    total_artifacts: number;
    has_job: boolean;
    has_status: boolean;
    has_render_plan: boolean;
    has_preflight_report: boolean;
    has_adapter_health: boolean;
    has_short_video_maker_payload: boolean;
    has_short_video_maker_dry_run_request: boolean;
    has_short_video_maker_http_send_plan: boolean;
    has_short_video_maker_mock_response: boolean;
    has_output: boolean;
  };
  created_at: string;
}

export async function inspectJobArtifacts(
  jobId: string,
  options: PersistenceOptions = {}
): Promise<JobArtifactsInventory> {
  const paths = getJobPaths(jobId, options);

  if (!(await pathExists(paths.jobDir))) {
    throw new JobNotFoundError(jobId);
  }

  const knownArtifacts = await Promise.all([
    inspectArtifact("job.json", "job_payload", paths.jobPath),
    inspectArtifact("status.json", "job_status", paths.statusPath),
    inspectArtifact("events.ndjson", "event_log", paths.eventsPath),
    inspectArtifact("render-plan.json", "render_plan", paths.renderPlanPath),
    inspectArtifact("preflight-report.json", "preflight_report", paths.preflightReportPath),
    inspectArtifact("adapter-health.short-video-maker.json", "adapter_health", paths.shortVideoMakerAdapterHealthPath),
    inspectArtifact("short-video-maker-payload.json", "adapter_payload", paths.shortVideoMakerPayloadPath),
    inspectArtifact(
      "short-video-maker-request.dry-run.json",
      "adapter_dry_run_request",
      paths.shortVideoMakerDryRunRequestPath
    ),
    inspectArtifact(
      "short-video-maker-http-send.plan.json",
      "adapter_http_send_plan",
      paths.shortVideoMakerHttpSendPlanPath
    ),
    inspectArtifact(
      "short-video-maker-response.mock.json",
      "adapter_http_mock_response",
      paths.shortVideoMakerMockResponsePath
    ),
    inspectArtifact("output", "output_dir", paths.outputDir)
  ]);
  const outputArtifacts = await inspectOutputFiles(paths.outputDir);
  const artifacts = [...knownArtifacts, ...outputArtifacts];

  return {
    job_id: jobId,
    job_dir: paths.jobDir,
    artifacts,
    summary: {
      total_artifacts: artifacts.filter((artifact) => artifact.exists).length,
      has_job: artifactExists(artifacts, "job.json"),
      has_status: artifactExists(artifacts, "status.json"),
      has_render_plan: artifactExists(artifacts, "render-plan.json"),
      has_preflight_report: artifactExists(artifacts, "preflight-report.json"),
      has_adapter_health: artifactExists(artifacts, "adapter-health.short-video-maker.json"),
      has_short_video_maker_payload: artifactExists(artifacts, "short-video-maker-payload.json"),
      has_short_video_maker_dry_run_request: artifactExists(artifacts, "short-video-maker-request.dry-run.json"),
      has_short_video_maker_http_send_plan: artifactExists(artifacts, "short-video-maker-http-send.plan.json"),
      has_short_video_maker_mock_response: artifactExists(artifacts, "short-video-maker-response.mock.json"),
      has_output: artifactExists(artifacts, "output")
    },
    created_at: new Date().toISOString()
  };
}

async function inspectOutputFiles(outputDir: string): Promise<JobArtifactEntry[]> {
  if (!(await pathExists(outputDir))) {
    return [];
  }

  const entries = await readdir(outputDir, { withFileTypes: true });
  const fileEntries = entries.filter((entry) => entry.isFile());

  return Promise.all(
    fileEntries.map((entry) => inspectArtifact(`output/${entry.name}`, "output_file", resolve(outputDir, entry.name)))
  );
}

async function inspectArtifact(name: string, type: JobArtifactType, path: string): Promise<JobArtifactEntry> {
  try {
    const artifactStats = await stat(path);

    return {
      name,
      type,
      path,
      exists: true,
      size_bytes: artifactStats.size,
      updated_at: artifactStats.mtime.toISOString()
    };
  } catch {
    return {
      name,
      type,
      path,
      exists: false,
      size_bytes: null,
      updated_at: null
    };
  }
}

function artifactExists(artifacts: JobArtifactEntry[], name: string): boolean {
  return artifacts.some((artifact) => basename(artifact.name) === name && artifact.exists);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
