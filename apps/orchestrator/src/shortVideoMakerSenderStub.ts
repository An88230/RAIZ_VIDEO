import { readFile } from "node:fs/promises";

import {
  assertRealRenderAllowed,
  type ExecutionGuard,
  RealRenderExecutionDisabledError
} from "./executionGuard.js";
import { getJobPaths, getJobStatus, type PersistenceOptions } from "./persistence.js";
import type { ShortVideoMakerDryRunRequest } from "./shortVideoMakerDryRunRequest.js";

export { RealRenderExecutionDisabledError };

export interface ShortVideoMakerSenderStubResponse {
  status: "not_implemented";
  job_id: string;
  adapter: "short_video_maker";
  message: "Real short-video-maker sender is not implemented yet.";
  guard: ExecutionGuard;
  request_path: string;
}

export class JobShortVideoMakerSenderStateError extends Error {
  constructor(jobId: string, status: string) {
    super(`Job ${jobId} must be preparing before sending to short-video-maker. Current status is ${status}.`);
    this.name = "JobShortVideoMakerSenderStateError";
  }
}

export class JobShortVideoMakerSenderReadinessError extends Error {
  constructor(jobId: string, detail = "Job must be ready for dry-run before sending to short-video-maker.") {
    super(`Job ${jobId}: ${detail}`);
    this.name = "JobShortVideoMakerSenderReadinessError";
  }
}

export async function sendToShortVideoMakerStub(
  jobId: string,
  options: PersistenceOptions = {}
): Promise<ShortVideoMakerSenderStubResponse> {
  const paths = getJobPaths(jobId, options);
  const status = await getJobStatus(jobId, options);

  if (status.status !== "preparing") {
    throw new JobShortVideoMakerSenderStateError(jobId, status.status);
  }

  if (status.metadata?.ready_for_dry_run !== true || status.metadata.dry_run_request_created !== true) {
    throw new JobShortVideoMakerSenderReadinessError(
      jobId,
      "short-video-maker dry-run request must be created before sending."
    );
  }

  await readDryRunRequest(jobId, paths.shortVideoMakerDryRunRequestPath);
  const guard = assertRealRenderAllowed();

  return {
    status: "not_implemented",
    job_id: jobId,
    adapter: "short_video_maker",
    message: "Real short-video-maker sender is not implemented yet.",
    guard,
    request_path: paths.shortVideoMakerDryRunRequestPath
  };
}

async function readDryRunRequest(jobId: string, requestPath: string): Promise<ShortVideoMakerDryRunRequest> {
  try {
    return JSON.parse(await readFile(requestPath, "utf8")) as ShortVideoMakerDryRunRequest;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new JobShortVideoMakerSenderReadinessError(
        jobId,
        "short-video-maker dry-run request artifact is required before sending."
      );
    }

    throw error;
  }
}
