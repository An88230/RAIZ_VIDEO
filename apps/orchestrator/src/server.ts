import Fastify, { type FastifyInstance } from "fastify";
import { validateRaizJob } from "@raiz/job-schema";
import { shortVideoMakerAdapter } from "@raiz/render-adapters";
import { resolve } from "node:path";

import { inspectJobArtifacts } from "./artifactInspector.js";
import {
  createShortVideoMakerPayload,
  createJobRecord,
  getJobStatus,
  JobAdapterPayloadPreflightError,
  JobAdapterPayloadStateError,
  JobConflictError,
  JobNotFoundError,
  prepareJob,
  updateJobStatus,
  writeJobAdapterHealthReport
} from "./persistence.js";
import { JobMockRenderPreflightError, JobMockRenderStateError, runMockRender } from "./mockRender.js";
import { JobPreflightStateError, runPreflight } from "./preflight.js";
import { JobReadinessStateError, runReadinessReview } from "./readinessReview.js";
import {
  createShortVideoMakerDryRunRequest,
  JobDryRunReadinessError,
  JobDryRunStateError
} from "./shortVideoMakerDryRunRequest.js";
import { InvalidStatusTransitionError, isLocalJobStatus } from "./statusTransitions.js";

export interface CreateServerOptions {
  logger?: boolean;
  storageRoot?: string;
  shortVideoMakerVendorPath?: string;
}

const renderAdapters = [shortVideoMakerAdapter];

function getShortVideoMakerVendorPath(options: CreateServerOptions): string {
  return resolve(options.shortVideoMakerVendorPath ?? "vendor/short-video-maker");
}

interface PatchJobStatusBody {
  status?: unknown;
  adapter?: string;
  output_path?: string | null;
  error?: string | null;
  metadata?: Record<string, unknown>;
}

export function createServer(options: CreateServerOptions = {}): FastifyInstance {
  const server = Fastify({ logger: options.logger ?? false });

  server.get("/adapters/short-video-maker/health", async () => {
    return shortVideoMakerAdapter.checkHealth?.({
      vendorPath: getShortVideoMakerVendorPath(options)
    });
  });

  server.post("/jobs/validate", async (request, reply) => {
    const validation = validateRaizJob(request.body);

    if (!validation.valid) {
      return reply.code(400).send({
        valid: false,
        errors: validation.errors
      });
    }

    return {
      valid: true,
      job_id: validation.job.job_id
    };
  });

  server.post("/jobs/render", async (request, reply) => {
    const validation = validateRaizJob(request.body);

    if (!validation.valid) {
      return reply.code(400).send({
        status: "rejected",
        errors: validation.errors
      });
    }

    const adapter = renderAdapters.find((candidate) => candidate.id === validation.job.template.engine);

    if (!adapter || !(await adapter.canRender(validation.job))) {
      return reply.code(400).send({
        status: "rejected",
        error: `No phase 1 adapter is available for engine ${validation.job.template.engine}.`
      });
    }

    const prepared = await adapter.prepare(validation.job);
    await adapter.render(prepared);

    try {
      const status = await createJobRecord(validation.job, {
        storageRoot: options.storageRoot,
        adapter: adapter.id
      });

      return reply.code(202).send(status);
    } catch (error) {
      if (error instanceof JobConflictError) {
        return reply.code(409).send({
          status: "conflict",
          job_id: validation.job.job_id,
          error: error.message
        });
      }

      throw error;
    }
  });

  server.get<{ Params: { id: string } }>("/jobs/:id/status", async (request, reply) => {
    try {
      return await getJobStatus(request.params.id, {
        storageRoot: options.storageRoot
      });
    } catch (error) {
      if (error instanceof JobNotFoundError) {
        return reply.code(404).send({
          status: "not_found",
          job_id: request.params.id
        });
      }

      throw error;
    }
  });

  server.get<{ Params: { id: string } }>("/jobs/:id/artifacts", async (request, reply) => {
    try {
      return await inspectJobArtifacts(request.params.id, {
        storageRoot: options.storageRoot
      });
    } catch (error) {
      if (error instanceof JobNotFoundError) {
        return reply.code(404).send({
          status: "not_found",
          job_id: request.params.id
        });
      }

      throw error;
    }
  });

  server.post<{ Params: { id: string } }>("/jobs/:id/prepare", async (request, reply) => {
    try {
      return await prepareJob(request.params.id, {
        storageRoot: options.storageRoot
      });
    } catch (error) {
      if (error instanceof JobNotFoundError) {
        return reply.code(404).send({
          status: "not_found",
          job_id: request.params.id
        });
      }

      if (error instanceof InvalidStatusTransitionError) {
        return reply.code(409).send({
          status: "conflict",
          job_id: request.params.id,
          error: error.message
        });
      }

      if (error instanceof JobConflictError) {
        return reply.code(409).send({
          status: "conflict",
          job_id: request.params.id,
          error: error.message
        });
      }

      throw error;
    }
  });

  server.post<{ Params: { id: string } }>("/jobs/:id/preflight", async (request, reply) => {
    try {
      return await runPreflight(request.params.id, {
        storageRoot: options.storageRoot
      });
    } catch (error) {
      if (error instanceof JobNotFoundError) {
        return reply.code(404).send({
          status: "not_found",
          job_id: request.params.id
        });
      }

      if (error instanceof JobPreflightStateError) {
        return reply.code(409).send({
          status: "conflict",
          job_id: request.params.id,
          error: error.message
        });
      }

      throw error;
    }
  });

  server.post<{ Params: { id: string } }>("/jobs/:id/mock-render", async (request, reply) => {
    try {
      return await runMockRender(request.params.id, {
        storageRoot: options.storageRoot
      });
    } catch (error) {
      if (error instanceof JobNotFoundError) {
        return reply.code(404).send({
          status: "not_found",
          job_id: request.params.id
        });
      }

      if (error instanceof JobMockRenderStateError || error instanceof JobMockRenderPreflightError) {
        return reply.code(409).send({
          status: "conflict",
          job_id: request.params.id,
          error: error.message
        });
      }

      throw error;
    }
  });

  server.post<{ Params: { id: string } }>("/jobs/:id/adapter-health", async (request, reply) => {
    try {
      const report = await shortVideoMakerAdapter.checkHealth?.({
        vendorPath: getShortVideoMakerVendorPath(options)
      });

      if (!report) {
        throw new Error("short-video-maker adapter does not expose health checks.");
      }

      await writeJobAdapterHealthReport(request.params.id, report, {
        storageRoot: options.storageRoot
      });

      return report;
    } catch (error) {
      if (error instanceof JobNotFoundError) {
        return reply.code(404).send({
          status: "not_found",
          job_id: request.params.id
        });
      }

      throw error;
    }
  });

  server.post<{ Params: { id: string } }>("/jobs/:id/adapter-payload/short-video-maker", async (request, reply) => {
    try {
      return await createShortVideoMakerPayload(request.params.id, {
        storageRoot: options.storageRoot
      });
    } catch (error) {
      if (error instanceof JobNotFoundError) {
        return reply.code(404).send({
          status: "not_found",
          job_id: request.params.id
        });
      }

      if (error instanceof JobAdapterPayloadStateError || error instanceof JobAdapterPayloadPreflightError) {
        return reply.code(409).send({
          status: "conflict",
          job_id: request.params.id,
          error: error.message
        });
      }

      throw error;
    }
  });

  server.post<{ Params: { id: string } }>("/jobs/:id/readiness-review", async (request, reply) => {
    try {
      return await runReadinessReview(request.params.id, {
        storageRoot: options.storageRoot
      });
    } catch (error) {
      if (error instanceof JobNotFoundError) {
        return reply.code(404).send({
          status: "not_found",
          job_id: request.params.id
        });
      }

      if (error instanceof JobReadinessStateError) {
        return reply.code(409).send({
          status: "conflict",
          job_id: request.params.id,
          error: error.message
        });
      }

      throw error;
    }
  });

  server.post<{ Params: { id: string } }>("/jobs/:id/adapter-dry-run/short-video-maker", async (request, reply) => {
    try {
      return await createShortVideoMakerDryRunRequest(request.params.id, {
        storageRoot: options.storageRoot
      });
    } catch (error) {
      if (error instanceof JobNotFoundError) {
        return reply.code(404).send({
          status: "not_found",
          job_id: request.params.id
        });
      }

      if (error instanceof JobDryRunStateError || error instanceof JobDryRunReadinessError) {
        return reply.code(409).send({
          status: "conflict",
          job_id: request.params.id,
          error: error.message
        });
      }

      throw error;
    }
  });

  server.patch<{ Params: { id: string }; Body: PatchJobStatusBody }>("/jobs/:id/status", async (request, reply) => {
    if (!isLocalJobStatus(request.body.status)) {
      return reply.code(400).send({
        status: "rejected",
        error: "Request body must include a valid job status."
      });
    }

    try {
      return await updateJobStatus(request.params.id, request.body.status, {
        storageRoot: options.storageRoot,
        adapter: request.body.adapter,
        output_path: request.body.output_path,
        error: request.body.error,
        metadata: request.body.metadata
      });
    } catch (error) {
      if (error instanceof JobNotFoundError) {
        return reply.code(404).send({
          status: "not_found",
          job_id: request.params.id
        });
      }

      if (error instanceof InvalidStatusTransitionError) {
        return reply.code(409).send({
          status: "conflict",
          job_id: request.params.id,
          error: error.message
        });
      }

      throw error;
    }
  });

  return server;
}
