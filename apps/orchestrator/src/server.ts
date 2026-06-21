import Fastify, { type FastifyInstance } from "fastify";
import { validateRaizJob } from "@raiz/job-schema";
import { remotionDirectAdapter, shortVideoMakerAdapter } from "@raiz/render-adapters";
import { resolve } from "node:path";

import { loadApiAuthConfig, loadEnvConfig } from "./envConfig.js";
import { getExecutionGuard } from "./executionGuard.js";
import { createFetchHttpClient } from "./httpClient.js";
import { inspectJobArtifacts } from "./artifactInspector.js";
import {
  approveOutputForPublish,
  JobManualReviewPackageError,
  JobManualReviewStateError,
  rejectOutputForPublish
} from "./manualReviewGate.js";
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
import {
  createPublishPackage,
  JobPublishPackageApprovalError,
  JobPublishPackageArtifactError,
  JobPublishPackageStateError
} from "./publishPackage.js";
import {
  createGoogleDriveExportPlan,
  JobGoogleDriveExportPlanArtifactError,
  JobGoogleDriveExportPlanReadinessError,
  JobGoogleDriveExportPlanStateError
} from "./googleDriveExportPlan.js";
import {
  createN8nWorkflowPlan,
  JobN8nWorkflowPlanArtifactError,
  JobN8nWorkflowPlanReadinessError,
  JobN8nWorkflowPlanStateError
} from "./n8nWorkflowPlan.js";
import {
  createYouTubeUploadPlan,
  JobYouTubeUploadPlanArtifactError,
  JobYouTubeUploadPlanReadinessError,
  JobYouTubeUploadPlanStateError
} from "./youtubeUploadPlan.js";
import { JobMockRenderPreflightError, JobMockRenderStateError, runMockRender } from "./mockRender.js";
import {
  N8nRenderPayloadValidationError,
  N8nRenderPreflightError,
  renderN8nPayloadWithRemotionDirect
} from "./n8nRenderIntake.js";
import { JobPreflightStateError, runPreflight } from "./preflight.js";
import {
  JobRealHttpSenderReadinessStateError,
  runRealHttpSenderReadinessChecklist
} from "./realHttpSenderReadiness.js";
import {
  createOutputReviewPackage,
  JobOutputReviewPackageArtifactError,
  JobOutputReviewPackageStateError
} from "./outputReviewPackage.js";
import { JobReadinessStateError, runReadinessReview } from "./readinessReview.js";
import {
  ingestShortVideoMakerOutput,
  JobOutputIngestionStateError
} from "./shortVideoMakerOutputIngestion.js";
import {
  createShortVideoMakerDryRunRequest,
  JobDryRunReadinessError,
  JobDryRunStateError
} from "./shortVideoMakerDryRunRequest.js";
import {
  createShortVideoMakerHttpSendPlan,
  JobHttpSendPlanReadinessError,
  JobHttpSendPlanStateError
} from "./shortVideoMakerHttpSendPlan.js";
import {
  JobHttpMockSendReadinessError,
  JobHttpMockSendStateError,
  sendShortVideoMakerWithMockedHttp,
  type HttpClient
} from "./shortVideoMakerMockHttpSender.js";
import {
  JobRealHttpSenderReadinessError,
  JobRealHttpSenderStateError,
  JobRealHttpSenderSubmitError,
  RealRenderExecutionDisabledError,
  sendShortVideoMakerWithRealHttp
} from "./shortVideoMakerRealHttpSender.js";
import {
  createShortVideoMakerUpstreamRequest,
  JobUpstreamRequestArtifactError,
  JobUpstreamRequestStateError
} from "./shortVideoMakerUpstreamRequest.js";
import {
  createScriptRemotionRenderer,
  JobRemotionDirectRenderError,
  JobRemotionDirectRenderPreflightError,
  JobRemotionDirectRenderStateError,
  renderJobWithRemotionDirect,
  type RemotionRenderer
} from "./remotionDirectRender.js";
import { InvalidStatusTransitionError, isLocalJobStatus } from "./statusTransitions.js";

export interface CreateServerOptions {
  logger?: boolean;
  storageRoot?: string;
  shortVideoMakerVendorPath?: string;
  shortVideoMakerHttpClient?: HttpClient;
  remotionRenderer?: RemotionRenderer;
  apiToken?: string | null;
}

// remotion_direct is the Arabic-first v1 engine, so it leads the list and is the
// reported default engine. short_video_maker stays registered as the optional
// English-only path. /jobs/render routes by engine id, not array order.
const renderAdapters = [remotionDirectAdapter, shortVideoMakerAdapter];
const realHttpClient = createFetchHttpClient();
const defaultRemotionRenderer = createScriptRemotionRenderer();

const internalMockHttpClient: HttpClient = {
  async post(_url, _body) {
    return {
      status: 202,
      ok: true,
      body: {
        external_job_id: "mock-short-video-maker-submission"
      }
    };
  }
};

function getShortVideoMakerVendorPath(options: CreateServerOptions): string {
  return resolve(options.shortVideoMakerVendorPath ?? loadEnvConfig().shortVideoMakerVendorPath);
}

function getSafeConfigView(apiAuthEnabled: boolean) {
  const config = loadEnvConfig();

  return {
    ...config,
    apiAuthEnabled,
    safe_defaults: true,
    real_execution_blocked_by_default: true
  };
}

function getServerApiAuthConfig(options: CreateServerOptions) {
  if (options.apiToken !== undefined) {
    const apiToken = options.apiToken?.trim() || null;

    return {
      apiAuthEnabled: Boolean(apiToken),
      apiToken
    };
  }

  return loadApiAuthConfig();
}

interface PatchJobStatusBody {
  status?: unknown;
  adapter?: string;
  output_path?: string | null;
  error?: string | null;
  metadata?: Record<string, unknown>;
}

interface ManualReviewBody {
  reviewerNote?: unknown;
}

export function createServer(options: CreateServerOptions = {}): FastifyInstance {
  const server = Fastify({ logger: options.logger ?? false });
  const apiAuth = getServerApiAuthConfig(options);

  server.addHook("onRequest", async (request, reply) => {
    if (!apiAuth.apiAuthEnabled) {
      return;
    }

    if (request.method === "GET" && request.url.split("?")[0] === "/health") {
      return;
    }

    const requestToken = request.headers["x-raiz-api-token"];

    if (requestToken !== apiAuth.apiToken) {
      return reply.code(401).send({
        status: "unauthorized",
        error: "Missing or invalid RAIZ API token."
      });
    }
  });

  server.get("/adapters/short-video-maker/health", async () => {
    return shortVideoMakerAdapter.checkHealth?.({
      vendorPath: getShortVideoMakerVendorPath(options)
    });
  });

  server.get("/system/execution-guard", async () => {
    return getExecutionGuard();
  });

  server.get("/system/config", async () => {
    return getSafeConfigView(apiAuth.apiAuthEnabled);
  });

  server.get("/health", async () => {
    return {
      status: "ok",
      service: "raiz-orchestrator",
      real_render_enabled: getExecutionGuard().real_render_enabled,
      time: new Date().toISOString()
    };
  });

  server.get("/engines", async () => {
    return {
      default_engine: renderAdapters[0]?.id ?? null,
      engines: renderAdapters.map((adapter) => ({
        id: adapter.id,
        status: "available",
        supports_health_check: typeof adapter.checkHealth === "function"
      }))
    };
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

  server.post<{ Params: { id: string } }>("/jobs/:id/render/remotion-direct", async (request, reply) => {
    try {
      return await renderJobWithRemotionDirect(
        request.params.id,
        options.remotionRenderer ?? defaultRemotionRenderer,
        { storageRoot: options.storageRoot }
      );
    } catch (error) {
      if (error instanceof JobNotFoundError) {
        return reply.code(404).send({
          status: "not_found",
          job_id: request.params.id
        });
      }

      if (error instanceof RealRenderExecutionDisabledError) {
        return reply.code(403).send({
          status: "blocked",
          job_id: request.params.id,
          guard: error.guard
        });
      }

      if (
        error instanceof JobRemotionDirectRenderStateError ||
        error instanceof JobRemotionDirectRenderPreflightError
      ) {
        return reply.code(409).send({
          status: "conflict",
          job_id: request.params.id,
          error: error.message
        });
      }

      if (error instanceof JobRemotionDirectRenderError) {
        return reply.code(500).send({
          status: "render_failed",
          job_id: request.params.id,
          error: error.message
        });
      }

      throw error;
    }
  });

  server.post<{ Body: unknown }>("/integrations/n8n/render/remotion-direct", async (request, reply) => {
    try {
      return await renderN8nPayloadWithRemotionDirect(
        request.body,
        options.remotionRenderer ?? defaultRemotionRenderer,
        { storageRoot: options.storageRoot }
      );
    } catch (error) {
      if (error instanceof RealRenderExecutionDisabledError) {
        return reply.code(403).send({
          status: "blocked",
          guard: error.guard
        });
      }

      if (error instanceof N8nRenderPayloadValidationError) {
        return reply.code(400).send({
          status: "rejected",
          errors: error.issues
        });
      }

      if (error instanceof JobConflictError) {
        return reply.code(409).send({
          status: "conflict",
          error: error.message
        });
      }

      if (error instanceof N8nRenderPreflightError) {
        return reply.code(409).send({
          status: "conflict",
          error: error.message
        });
      }

      if (error instanceof JobRemotionDirectRenderError) {
        return reply.code(500).send({
          status: "render_failed",
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

  server.post<{ Params: { id: string } }>(
    "/jobs/:id/upstream-request/short-video-maker",
    async (request, reply) => {
      try {
        return await createShortVideoMakerUpstreamRequest(request.params.id, {
          storageRoot: options.storageRoot
        });
      } catch (error) {
        if (error instanceof JobNotFoundError) {
          return reply.code(404).send({
            status: "not_found",
            job_id: request.params.id
          });
        }

        if (error instanceof JobUpstreamRequestStateError || error instanceof JobUpstreamRequestArtifactError) {
          return reply.code(409).send({
            status: "conflict",
            job_id: request.params.id,
            error: error.message
          });
        }

        throw error;
      }
    }
  );

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

  server.post<{ Params: { id: string } }>("/jobs/:id/http-send-plan/short-video-maker", async (request, reply) => {
    try {
      return await createShortVideoMakerHttpSendPlan(request.params.id, {
        storageRoot: options.storageRoot
      });
    } catch (error) {
      if (error instanceof JobNotFoundError) {
        return reply.code(404).send({
          status: "not_found",
          job_id: request.params.id
        });
      }

      if (error instanceof JobHttpSendPlanStateError || error instanceof JobHttpSendPlanReadinessError) {
        return reply.code(409).send({
          status: "conflict",
          job_id: request.params.id,
          error: error.message
        });
      }

      throw error;
    }
  });

  server.post<{ Params: { id: string } }>("/jobs/:id/http-send-mock/short-video-maker", async (request, reply) => {
    try {
      return await sendShortVideoMakerWithMockedHttp(request.params.id, internalMockHttpClient, {
        storageRoot: options.storageRoot
      });
    } catch (error) {
      if (error instanceof JobNotFoundError) {
        return reply.code(404).send({
          status: "not_found",
          job_id: request.params.id
        });
      }

      if (error instanceof RealRenderExecutionDisabledError) {
        return reply.code(403).send({
          status: "blocked",
          job_id: request.params.id,
          guard: error.guard
        });
      }

      if (error instanceof JobHttpMockSendStateError || error instanceof JobHttpMockSendReadinessError) {
        return reply.code(409).send({
          status: "conflict",
          job_id: request.params.id,
          error: error.message
        });
      }

      throw error;
    }
  });

  server.post<{ Params: { id: string } }>("/jobs/:id/real-http-sender-readiness", async (request, reply) => {
    try {
      return await runRealHttpSenderReadinessChecklist(request.params.id, {
        storageRoot: options.storageRoot
      });
    } catch (error) {
      if (error instanceof JobNotFoundError) {
        return reply.code(404).send({
          status: "not_found",
          job_id: request.params.id
        });
      }

      if (error instanceof JobRealHttpSenderReadinessStateError) {
        return reply.code(409).send({
          status: "conflict",
          job_id: request.params.id,
          error: error.message
        });
      }

      throw error;
    }
  });

  server.post<{ Params: { id: string } }>("/jobs/:id/send-to-short-video-maker", async (request, reply) => {
    try {
      return await sendShortVideoMakerWithRealHttp(
        request.params.id,
        options.shortVideoMakerHttpClient ?? realHttpClient,
        {
          storageRoot: options.storageRoot
        }
      );
    } catch (error) {
      if (error instanceof JobNotFoundError) {
        return reply.code(404).send({
          status: "not_found",
          job_id: request.params.id
        });
      }

      if (error instanceof RealRenderExecutionDisabledError) {
        return reply.code(403).send({
          status: "blocked",
          job_id: request.params.id,
          guard: error.guard
        });
      }

      if (
        error instanceof JobRealHttpSenderStateError ||
        error instanceof JobRealHttpSenderReadinessError
      ) {
        return reply.code(409).send({
          status: "conflict",
          job_id: request.params.id,
          error: error.message
        });
      }

      if (error instanceof JobRealHttpSenderSubmitError) {
        return reply.code(502).send({
          status: "submit_failed",
          job_id: request.params.id,
          error: error.message,
          http_status: error.http_status,
          artifact_path: error.artifact_path
        });
      }

      throw error;
    }
  });

  server.post<{ Params: { id: string } }>("/jobs/:id/ingest-output/short-video-maker", async (request, reply) => {
    try {
      return await ingestShortVideoMakerOutput(request.params.id, {
        storageRoot: options.storageRoot
      });
    } catch (error) {
      if (error instanceof JobNotFoundError) {
        return reply.code(404).send({
          status: "not_found",
          job_id: request.params.id
        });
      }

      if (error instanceof JobOutputIngestionStateError) {
        return reply.code(409).send({
          status: "conflict",
          job_id: request.params.id,
          error: error.message
        });
      }

      throw error;
    }
  });

  server.post<{ Params: { id: string } }>("/jobs/:id/review-package", async (request, reply) => {
    try {
      return await createOutputReviewPackage(request.params.id, {
        storageRoot: options.storageRoot
      });
    } catch (error) {
      if (error instanceof JobNotFoundError) {
        return reply.code(404).send({
          status: "not_found",
          job_id: request.params.id
        });
      }

      if (
        error instanceof JobOutputReviewPackageStateError ||
        error instanceof JobOutputReviewPackageArtifactError
      ) {
        return reply.code(409).send({
          status: "conflict",
          job_id: request.params.id,
          error: error.message
        });
      }

      throw error;
    }
  });

  server.post<{ Params: { id: string }; Body: ManualReviewBody }>(
    "/jobs/:id/manual-review/approve",
    async (request, reply) => {
      try {
        return await approveOutputForPublish(request.params.id, getReviewerNote(request.body), {
          storageRoot: options.storageRoot
        });
      } catch (error) {
        if (error instanceof JobNotFoundError) {
          return reply.code(404).send({
            status: "not_found",
            job_id: request.params.id
          });
        }

        if (error instanceof JobManualReviewStateError || error instanceof JobManualReviewPackageError) {
          return reply.code(409).send({
            status: "conflict",
            job_id: request.params.id,
            error: error.message
          });
        }

        throw error;
      }
    }
  );

  server.post<{ Params: { id: string }; Body: ManualReviewBody }>(
    "/jobs/:id/manual-review/reject",
    async (request, reply) => {
      try {
        return await rejectOutputForPublish(request.params.id, getReviewerNote(request.body), {
          storageRoot: options.storageRoot
        });
      } catch (error) {
        if (error instanceof JobNotFoundError) {
          return reply.code(404).send({
            status: "not_found",
            job_id: request.params.id
          });
        }

        if (error instanceof JobManualReviewStateError || error instanceof JobManualReviewPackageError) {
          return reply.code(409).send({
            status: "conflict",
            job_id: request.params.id,
            error: error.message
          });
        }

        throw error;
      }
    }
  );

  server.post<{ Params: { id: string } }>("/jobs/:id/publish-package", async (request, reply) => {
    try {
      return await createPublishPackage(request.params.id, {
        storageRoot: options.storageRoot
      });
    } catch (error) {
      if (error instanceof JobNotFoundError) {
        return reply.code(404).send({
          status: "not_found",
          job_id: request.params.id
        });
      }

      if (
        error instanceof JobPublishPackageStateError ||
        error instanceof JobPublishPackageApprovalError ||
        error instanceof JobPublishPackageArtifactError
      ) {
        return reply.code(409).send({
          status: "conflict",
          job_id: request.params.id,
          error: error.message
        });
      }

      throw error;
    }
  });

  server.post<{ Params: { id: string } }>("/jobs/:id/youtube-upload-plan", async (request, reply) => {
    try {
      return await createYouTubeUploadPlan(request.params.id, {
        storageRoot: options.storageRoot
      });
    } catch (error) {
      if (error instanceof JobNotFoundError) {
        return reply.code(404).send({
          status: "not_found",
          job_id: request.params.id
        });
      }

      if (
        error instanceof JobYouTubeUploadPlanStateError ||
        error instanceof JobYouTubeUploadPlanReadinessError ||
        error instanceof JobYouTubeUploadPlanArtifactError
      ) {
        return reply.code(409).send({
          status: "conflict",
          job_id: request.params.id,
          error: error.message
        });
      }

      throw error;
    }
  });

  server.post<{ Params: { id: string } }>("/jobs/:id/google-drive-export-plan", async (request, reply) => {
    try {
      return await createGoogleDriveExportPlan(request.params.id, {
        storageRoot: options.storageRoot
      });
    } catch (error) {
      if (error instanceof JobNotFoundError) {
        return reply.code(404).send({
          status: "not_found",
          job_id: request.params.id
        });
      }

      if (
        error instanceof JobGoogleDriveExportPlanStateError ||
        error instanceof JobGoogleDriveExportPlanReadinessError ||
        error instanceof JobGoogleDriveExportPlanArtifactError
      ) {
        return reply.code(409).send({
          status: "conflict",
          job_id: request.params.id,
          error: error.message
        });
      }

      throw error;
    }
  });

  server.post<{ Params: { id: string } }>("/jobs/:id/n8n-workflow-plan", async (request, reply) => {
    try {
      return await createN8nWorkflowPlan(request.params.id, {
        storageRoot: options.storageRoot
      });
    } catch (error) {
      if (error instanceof JobNotFoundError) {
        return reply.code(404).send({
          status: "not_found",
          job_id: request.params.id
        });
      }

      if (
        error instanceof JobN8nWorkflowPlanStateError ||
        error instanceof JobN8nWorkflowPlanReadinessError ||
        error instanceof JobN8nWorkflowPlanArtifactError
      ) {
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

function getReviewerNote(body: ManualReviewBody | undefined): string | undefined {
  return typeof body?.reviewerNote === "string" ? body.reviewerNote : undefined;
}
