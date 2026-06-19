import {
  mapToShortVideoMakerUpstreamRequest,
  type ShortVideoMakerPayload,
  type ShortVideoMakerUpstreamRequest
} from "@raiz/render-adapters";
import type { RaizJob } from "@raiz/job-schema";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { loadEnvConfig } from "./envConfig.js";
import {
  appendJobEvent,
  getJobPaths,
  getJobStatus,
  type PersistenceOptions,
  updateJobMetadata
} from "./persistence.js";

export interface ShortVideoMakerUpstreamRequestArtifact {
  job_id: string;
  adapter: "short_video_maker";
  mode: "upstream_contract";
  endpoint: {
    method: "POST";
    url: string;
    render_path: string;
  };
  request: ShortVideoMakerUpstreamRequest;
  limitations: string[];
  scene_count: number;
  search_terms_source: "job" | "default";
  safety: {
    will_send_network_request: false;
    will_generate_video: false;
    will_modify_vendor: false;
  };
  metadata: {
    source: "raiz_video_factory";
    created_at: string;
  };
}

export class JobUpstreamRequestStateError extends Error {
  constructor(jobId: string, status: string) {
    super(
      `Job ${jobId} must be preparing before upstream request creation. Current status is ${status}.`
    );
    this.name = "JobUpstreamRequestStateError";
  }
}

export class JobUpstreamRequestArtifactError extends Error {
  constructor(jobId: string, detail: string) {
    super(`Job ${jobId}: ${detail}`);
    this.name = "JobUpstreamRequestArtifactError";
  }
}

export async function createShortVideoMakerUpstreamRequest(
  jobId: string,
  options: PersistenceOptions = {}
): Promise<ShortVideoMakerUpstreamRequestArtifact> {
  const paths = getJobPaths(jobId, options);
  const status = await getJobStatus(jobId, options);

  if (status.status !== "preparing") {
    throw new JobUpstreamRequestStateError(jobId, status.status);
  }

  if (status.metadata?.preflight_status !== "passed") {
    throw new JobUpstreamRequestArtifactError(jobId, "preflight must pass before upstream request creation.");
  }

  const [job, payload] = await Promise.all([
    readRequiredJson<RaizJob>(paths.jobPath, jobId, "job.json"),
    readRequiredJson<ShortVideoMakerPayload>(
      paths.shortVideoMakerPayloadPath,
      jobId,
      "short-video-maker-payload.json"
    )
  ]);

  const mapped = mapToShortVideoMakerUpstreamRequest(payload, {
    captionPosition: job.captions.position,
    defaultSearchTerms: deriveSearchTerms(job)
  });

  const config = loadEnvConfig();
  const upstreamUrl = `${config.shortVideoMakerBaseUrl.replace(/\/+$/, "")}${config.shortVideoMakerRenderPath}`;
  const artifactPath = resolve(paths.jobDir, "short-video-maker-upstream-request.json");
  const artifact: ShortVideoMakerUpstreamRequestArtifact = {
    job_id: jobId,
    adapter: "short_video_maker",
    mode: "upstream_contract",
    endpoint: {
      method: "POST",
      url: upstreamUrl,
      render_path: config.shortVideoMakerRenderPath
    },
    request: mapped.request,
    limitations: mapped.limitations,
    scene_count: mapped.scene_count,
    search_terms_source: mapped.search_terms_source,
    safety: {
      will_send_network_request: false,
      will_generate_video: false,
      will_modify_vendor: false
    },
    metadata: {
      source: "raiz_video_factory",
      created_at: new Date().toISOString()
    }
  };

  await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
  await updateJobMetadata(
    jobId,
    {
      short_video_maker_upstream_request_path: artifactPath,
      upstream_request_created: true,
      upstream_request_limitation_count: mapped.limitations.length
    },
    options
  );
  await appendJobEvent(
    jobId,
    {
      type: "job.upstream_request_created",
      adapter: "short_video_maker",
      request_path: artifactPath,
      scene_count: mapped.scene_count,
      limitation_count: mapped.limitations.length
    },
    options
  );

  return artifact;
}

function deriveSearchTerms(job: RaizJob): string[] {
  // RAIZ jobs do not yet carry Pexels search terms. Until job authoring adds
  // them, scene footage uses placeholder defaults inside the mapper.
  const tags = job.publish?.tags;

  if (Array.isArray(tags) && tags.length > 0) {
    return tags;
  }

  return [];
}

async function readRequiredJson<T>(path: string, jobId: string, artifactName: string): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new JobUpstreamRequestArtifactError(jobId, `${artifactName} is required before upstream request creation.`);
    }

    throw error;
  }
}
