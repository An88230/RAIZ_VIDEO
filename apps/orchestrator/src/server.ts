import Fastify, { type FastifyInstance } from "fastify";
import { validateRaizJob } from "@raiz/job-schema";
import { shortVideoMakerAdapter } from "@raiz/render-adapters";

import { JobStore } from "./jobStore.js";

export interface CreateServerOptions {
  logger?: boolean;
}

const renderAdapters = [shortVideoMakerAdapter];

export function createServer(options: CreateServerOptions = {}): FastifyInstance {
  const server = Fastify({ logger: options.logger ?? false });
  const jobStore = new JobStore();

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
    const renderResult = await adapter.render(prepared);
    const storedJob = jobStore.queue(validation.job, renderResult.logs);

    return reply.code(202).send(storedJob);
  });

  server.get<{ Params: { id: string } }>("/jobs/:id/status", async (request, reply) => {
    const storedJob = jobStore.get(request.params.id);

    if (!storedJob) {
      return reply.code(404).send({
        status: "not_found",
        job_id: request.params.id
      });
    }

    return storedJob;
  });

  return server;
}
