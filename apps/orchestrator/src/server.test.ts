import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { EnvConfigError, loadEnvConfig, resolveOrchestratorListenConfig } from "./envConfig.js";
import {
  assertRealRenderAllowed,
  getExecutionGuard,
  RealRenderExecutionDisabledError
} from "./executionGuard.js";
import { createServer } from "./server.js";
import { sendShortVideoMakerWithMockedHttp, type HttpClient } from "./shortVideoMakerMockHttpSender.js";
import { type RemotionRenderer } from "./remotionDirectRender.js";

const managedEnvKeys = [
  "HOST",
  "PORT",
  "RAIZ_ALLOW_NETWORK_BIND",
  "RAIZ_API_TOKEN",
  "RAIZ_ENABLE_REAL_RENDER",
  "RAIZ_SHORT_VIDEO_MAKER_MODE",
  "RAIZ_SHORT_VIDEO_MAKER_BASE_URL",
  "RAIZ_SHORT_VIDEO_MAKER_RENDER_PATH",
  "RAIZ_SHORT_VIDEO_MAKER_TIMEOUT_MS",
  "RAIZ_SHORT_VIDEO_MAKER_VENDOR_PATH",
  "RAIZ_REMOTION_RENDER_TIMEOUT_MS",
  "RAIZ_STORAGE_DIR"
];
const originalEnv = snapshotEnv(managedEnvKeys);
clearManagedEnv();

const currentDir = dirname(fileURLToPath(import.meta.url));
const samplePath = resolve(currentDir, "../../../samples/valid-arabic-9x16-job.json");
const shortVideoMakerVendorPath = resolve(currentDir, "../../../vendor/short-video-maker");
const sampleJob = JSON.parse(readFileSync(samplePath, "utf8")) as Record<string, unknown>;
const storageRoot = mkdtempSync(resolve(tmpdir(), "raiz-orchestrator-test-"));
let realHttpClientCalls = 0;
let realHttpClientMode: "success" | "failure" = "success";
const realHttpClient: HttpClient = {
  async post(url, body, options) {
    realHttpClientCalls += 1;

    if (
      url !== "http://localhost:3123/api/short-video" ||
      !body ||
      options?.timeoutMs !== 120000 ||
      options.headers?.["content-type"] !== "application/json"
    ) {
      throw new Error("Expected real HTTP sender to use deterministic HTTP send plan details.");
    }

    if (realHttpClientMode === "failure") {
      return {
        status: 503,
        ok: false,
        body: {
          error: "mock upstream unavailable"
        }
      };
    }

    return {
      status: 202,
      ok: true,
      body: {
        external_job_id: "mock-real-http-submit",
        output_path: resolve(
          storageRoot,
          "jobs",
          String((body as { job_id?: string }).job_id),
          "output",
          `${String((body as { job_id?: string }).job_id)}.mp4`
        )
      }
    };
  }
};
const fakeRemotionRenderer: RemotionRenderer = {
  async render(input) {
    const outputPath = resolve(input.outputDir, input.outputFilename);
    writeFileSync(outputPath, "fake-remotion-mp4-bytes");
    return {
      ok: true,
      outputPath,
      durationSeconds: 5,
      rawVideoPath: resolve(input.outputDir, "raw.mp4"),
      captionsSrtPath: resolve(input.outputDir, "captions.srt"),
      captionsAssPath: resolve(input.outputDir, "captions.ass"),
      message: "fake remotion render"
    };
  }
};
const n8nRenderPayload = {
  video_id: "RVF-2026-N8N-001",
  template: "new_era_dark_editorial",
  format: "9:16",
  width: 1080,
  height: 1920,
  fps: 30,
  duration: 45,
  language: "ar",
  rtl: true,
  topic: "الانطفاء اللامع",
  angle: "إنت مش تعبان... إنت شغال وجزء منك مطفّي.",
  voiceover: "في لحظة ما، لا ينطفئ الإنسان بالكامل. فقط يفقد اللمعة التي كانت تشرح حضوره.",
  captions: ["الانطفاء اللامع", "أن تبقى واضحًا من الخارج، ومتعبًا من الداخل."],
  scenes: [
    {
      scene_id: "S01",
      caption: "مكتب مظلم وشاشة هاتف",
      broll_search_terms: ["dark desk phone light", "night office close up"]
    },
    {
      scene_id: "S02",
      caption: "شخص يكتب في مفكرة",
      broll_search_terms: ["writing notebook at night", "dark desk phone light"]
    }
  ],
  brand: {
    footer: "© 2025 Nabil88 | nabil88.art"
  }
};
const server = createServer({
  storageRoot,
  shortVideoMakerVendorPath,
  shortVideoMakerHttpClient: realHttpClient,
  remotionRenderer: fakeRemotionRenderer
});

const defaultEnvConfig = loadEnvConfig();
const defaultListenConfig = resolveOrchestratorListenConfig();

if (
  defaultEnvConfig.realRenderEnabled !== false ||
  defaultEnvConfig.shortVideoMakerMode !== "http" ||
  defaultEnvConfig.shortVideoMakerBaseUrl !== "http://localhost:3123" ||
  defaultEnvConfig.shortVideoMakerRenderPath !== "/api/short-video" ||
  defaultEnvConfig.shortVideoMakerTimeoutMs !== 120000 ||
  defaultEnvConfig.shortVideoMakerVendorPath !== "vendor/short-video-maker" ||
  defaultEnvConfig.storageDir !== "storage/jobs"
) {
  throw new Error("Expected env config defaults to be safe.");
}

if (
  defaultListenConfig.host !== "127.0.0.1" ||
  defaultListenConfig.port !== 4000 ||
  defaultListenConfig.allowNetworkBind !== false ||
  defaultListenConfig.apiAuthEnabled !== false
) {
  throw new Error("Expected orchestrator listen config defaults to bind localhost without API auth.");
}

let networkBindRejected = false;

try {
  resolveOrchestratorListenConfig({
    ...process.env,
    HOST: "0.0.0.0"
  });
} catch (error) {
  if (error instanceof EnvConfigError) {
    networkBindRejected = true;
  } else {
    throw error;
  }
}

if (!networkBindRejected) {
  throw new Error("Expected non-loopback bind without RAIZ_ALLOW_NETWORK_BIND=true to throw EnvConfigError.");
}

let missingNetworkTokenRejected = false;

try {
  resolveOrchestratorListenConfig({
    ...process.env,
    HOST: "0.0.0.0",
    RAIZ_ALLOW_NETWORK_BIND: "true"
  });
} catch (error) {
  if (error instanceof EnvConfigError) {
    missingNetworkTokenRejected = true;
  } else {
    throw error;
  }
}

if (!missingNetworkTokenRejected) {
  throw new Error("Expected network bind with allow but without RAIZ_API_TOKEN to throw EnvConfigError.");
}

const allowedNetworkBind = resolveOrchestratorListenConfig({
  ...process.env,
  HOST: "0.0.0.0",
  RAIZ_ALLOW_NETWORK_BIND: "true",
  RAIZ_API_TOKEN: "test-token"
});

if (
  allowedNetworkBind.host !== "0.0.0.0" ||
  allowedNetworkBind.allowNetworkBind !== true ||
  allowedNetworkBind.apiAuthEnabled !== true
) {
  throw new Error("Expected explicit network bind with API token to be allowed.");
}

const defaultExecutionGuard = getExecutionGuard();

if (
  defaultExecutionGuard.real_render_enabled !== false ||
  defaultExecutionGuard.source !== "RAIZ_ENABLE_REAL_RENDER" ||
  defaultExecutionGuard.raw_value !== null ||
  defaultExecutionGuard.policy !== "blocked_by_default"
) {
  throw new Error("Expected default execution guard to block real rendering.");
}

let disabledGuardRejected = false;

try {
  assertRealRenderAllowed();
} catch (error) {
  if (error instanceof RealRenderExecutionDisabledError) {
    disabledGuardRejected = true;
  } else {
    throw error;
  }
}

if (!disabledGuardRejected) {
  throw new Error("Expected assertRealRenderAllowed to reject by default.");
}

process.env.RAIZ_ENABLE_REAL_RENDER = "false";
const explicitlyDisabledGuard = getExecutionGuard();

if (explicitlyDisabledGuard.real_render_enabled !== false || explicitlyDisabledGuard.raw_value !== "false") {
  throw new Error("Expected RAIZ_ENABLE_REAL_RENDER=false to keep real rendering blocked.");
}

delete process.env.RAIZ_ENABLE_REAL_RENDER;
process.env.RAIZ_ENABLE_REAL_RENDER = "true";
const enabledExecutionGuard = getExecutionGuard();

if (enabledExecutionGuard.real_render_enabled !== true || enabledExecutionGuard.raw_value !== "true") {
  throw new Error("Expected RAIZ_ENABLE_REAL_RENDER=true to allow guard state.");
}

assertRealRenderAllowed();
delete process.env.RAIZ_ENABLE_REAL_RENDER;

let invalidModeRejected = false;

try {
  loadEnvConfig({
    ...process.env,
    RAIZ_SHORT_VIDEO_MAKER_MODE: "docker"
  });
} catch (error) {
  if (error instanceof EnvConfigError) {
    invalidModeRejected = true;
  } else {
    throw error;
  }
}

if (!invalidModeRejected) {
  throw new Error("Expected invalid short-video-maker mode to throw EnvConfigError.");
}

let invalidTimeoutRejected = false;

try {
  loadEnvConfig({
    ...process.env,
    RAIZ_SHORT_VIDEO_MAKER_TIMEOUT_MS: "0"
  });
} catch (error) {
  if (error instanceof EnvConfigError) {
    invalidTimeoutRejected = true;
  } else {
    throw error;
  }
}

if (!invalidTimeoutRejected) {
  throw new Error("Expected invalid short-video-maker timeout to throw EnvConfigError.");
}

let invalidRenderPathThrew = false;

try {
  loadEnvConfig({
    ...process.env,
    RAIZ_SHORT_VIDEO_MAKER_RENDER_PATH: "api/short-video"
  });
} catch (error) {
  if (error instanceof EnvConfigError) {
    invalidRenderPathThrew = true;
  }
}

if (!invalidRenderPathThrew) {
  throw new Error("Expected invalid short-video-maker render path to throw EnvConfigError.");
}

interface ArtifactInventoryBody {
  artifacts?: Array<{ name?: string; type?: string; exists?: boolean }>;
  summary?: {
    total_artifacts?: number;
    has_job?: boolean;
    has_status?: boolean;
    has_n8n_render_payload?: boolean;
    has_render_plan?: boolean;
    has_remotion_render_manifest?: boolean;
    has_preflight_report?: boolean;
    has_adapter_health?: boolean;
    has_short_video_maker_payload?: boolean;
    has_short_video_maker_dry_run_request?: boolean;
    has_short_video_maker_http_send_plan?: boolean;
    has_short_video_maker_mock_response?: boolean;
    has_real_http_sender_readiness?: boolean;
    has_short_video_maker_sent_request?: boolean;
    has_short_video_maker_response?: boolean;
    has_short_video_maker_error?: boolean;
    has_output_manifest?: boolean;
    has_review_package?: boolean;
    has_review_folder?: boolean;
    has_manual_review_approval?: boolean;
    has_manual_review_rejection?: boolean;
    has_publish_package?: boolean;
    has_youtube_upload_plan?: boolean;
    has_google_drive_export_plan?: boolean;
    has_n8n_workflow_plan?: boolean;
    has_output?: boolean;
  };
}

interface ReadinessReviewBody {
  ready_for_dry_run?: boolean;
  status?: string;
  checks?: Array<{ name?: string; passed?: boolean; severity?: string }>;
  errors?: string[];
}

interface ShortVideoMakerDryRunRequestBody {
  adapter?: string;
  mode?: string;
  request?: {
    composition?: {
      aspect_ratio?: string;
      width?: number;
      height?: number;
      language?: string;
      direction?: string;
    };
  };
  safety?: {
    will_execute?: boolean;
    will_start_process?: boolean;
    will_generate_video?: boolean;
    will_modify_vendor?: boolean;
  };
}

interface ShortVideoMakerHttpSendPlanBody {
  execution?: string;
  method?: string;
  url?: string;
  timeout_ms?: number;
  headers?: { "content-type"?: string };
  body_source_path?: string;
  safety?: { will_make_network_request?: boolean };
}

interface ShortVideoMakerMockHttpResponseBody {
  adapter?: string;
  mode?: string;
  status?: string;
  http_status?: number;
  external_job_id?: string;
  request_plan_path?: string;
  metadata?: { mocked?: boolean };
}

interface RealHttpSenderReadinessBody {
  ready_for_real_http_sender?: boolean;
  status?: string;
  checks?: Array<{ name?: string; passed?: boolean; severity?: string }>;
  errors?: string[];
}

interface ShortVideoMakerRealHttpResponseBody {
  adapter?: string;
  mode?: string;
  status?: string;
  http_status?: number;
  external_job_id?: string | null;
  request_path?: string;
  response_body?: unknown;
}

interface ShortVideoMakerOutputManifestBody {
  adapter?: string;
  status?: string;
  output_path?: string | null;
  final_video_path?: string | null;
  checks?: Array<{ name?: string; passed?: boolean; severity?: string }>;
  errors?: string[];
}

interface OutputReviewPackageBody {
  status?: string;
  final_video_path?: string | null;
  job_summary?: {
    title?: string;
    language?: string;
    direction?: string;
    aspect_ratio?: string;
    template_id?: string;
  };
  render_metadata?: {
    output_manifest_path?: string;
    review_folder_path?: string;
  };
  timestamps?: {
    job_created_at?: string;
    job_updated_at?: string;
    output_manifest_created_at?: string | null;
    review_package_created_at?: string;
  };
  warnings?: string[];
  errors?: string[];
}

interface ManualReviewDecisionBody {
  status?: string;
  reviewer_note?: string | null;
  review_package_path?: string;
  approved_at?: string;
  rejected_at?: string;
}

interface PublishPackageBody {
  status?: string;
  final_video_path?: string | null;
  title?: string;
  description?: string | null;
  hashtags?: string[];
  platform_targets?: Array<{ platform?: string; enabled?: boolean; status?: string }>;
  approval?: {
    approved?: boolean;
    reviewer_note?: string | null;
    approval_path?: string;
    approved_at?: string;
  };
  metadata?: {
    source?: string;
    created_at?: string;
  };
}

interface YouTubeUploadPlanBody {
  platform?: string;
  mode?: string;
  video_path?: string;
  title?: string;
  description?: string | null;
  tags?: string[];
  privacyStatus?: string;
  made_for_kids?: boolean;
  publish_package_path?: string;
  safety?: {
    will_upload?: boolean;
    will_make_network_request?: boolean;
    will_modify_video?: boolean;
  };
  metadata?: {
    source?: string;
    created_at?: string;
  };
}

interface GoogleDriveExportPlanBody {
  platform?: string;
  mode?: string;
  source_video_path?: string;
  filename?: string;
  title?: string;
  description?: string | null;
  target?: {
    type?: string;
    folder_id?: string;
    folder_name?: string;
  };
  publish_package_path?: string;
  youtube_upload_plan_path?: string;
  safety?: {
    will_upload?: boolean;
    will_make_network_request?: boolean;
    will_modify_video?: boolean;
  };
  metadata?: {
    source?: string;
    created_at?: string;
  };
}

interface N8nWorkflowPlanBody {
  platform?: string;
  mode?: string;
  trigger?: {
    type?: string;
    execution?: string;
  };
  inputs?: {
    publish_package_path?: string;
    youtube_upload_plan_path?: string;
    google_drive_export_plan_path?: string;
  };
  workflow_steps?: Array<{ name?: string; enabled?: boolean }>;
  references?: {
    final_video_path?: string | null;
    youtube_title?: string;
    google_drive_filename?: string;
  };
  safety?: {
    will_execute_workflow?: boolean;
    will_make_network_request?: boolean;
    will_upload?: boolean;
    will_modify_video?: boolean;
  };
  metadata?: {
    source?: string;
    created_at?: string;
  };
}

const validateResponse = await server.inject({
  method: "POST",
  url: "/jobs/validate",
  payload: sampleJob
});

if (validateResponse.statusCode !== 200) {
  throw new Error(`Expected valid job to pass validation, got ${validateResponse.statusCode}.`);
}

const invalidResponse = await server.inject({
  method: "POST",
  url: "/jobs/validate",
  payload: { ...sampleJob, resolution: { width: 1920, height: 1080 } }
});

if (invalidResponse.statusCode !== 400) {
  throw new Error(`Expected invalid job to fail validation, got ${invalidResponse.statusCode}.`);
}

const adapterHealthResponse = await server.inject({
  method: "GET",
  url: "/adapters/short-video-maker/health"
});

if (adapterHealthResponse.statusCode !== 200) {
  throw new Error(`Expected short-video-maker health endpoint to return 200, got ${adapterHealthResponse.statusCode}.`);
}

const adapterHealth = JSON.parse(adapterHealthResponse.body) as {
  adapter?: string;
  status?: string;
  checks?: unknown[];
  metadata?: { package_name?: string | null; detected_files?: string[] };
};

if (
  adapterHealth.adapter !== "short_video_maker" ||
  !["healthy", "degraded", "missing"].includes(adapterHealth.status ?? "") ||
  !Array.isArray(adapterHealth.checks) ||
  !Array.isArray(adapterHealth.metadata?.detected_files)
) {
  throw new Error("Expected short-video-maker health endpoint to return a structured health report.");
}

const executionGuardResponse = await server.inject({
  method: "GET",
  url: "/system/execution-guard"
});

if (executionGuardResponse.statusCode !== 200) {
  throw new Error(`Expected execution guard endpoint to return 200, got ${executionGuardResponse.statusCode}.`);
}

const executionGuardBody = JSON.parse(executionGuardResponse.body) as {
  real_render_enabled?: boolean;
  source?: string;
  policy?: string;
  message?: string;
};

if (
  executionGuardBody.real_render_enabled !== false ||
  executionGuardBody.source !== "RAIZ_ENABLE_REAL_RENDER" ||
  executionGuardBody.policy !== "blocked_by_default" ||
  !executionGuardBody.message?.includes("disabled")
) {
  throw new Error("Expected execution guard endpoint to report blocked-by-default state.");
}

const configResponse = await server.inject({
  method: "GET",
  url: "/system/config"
});

if (configResponse.statusCode !== 200) {
  throw new Error(`Expected system config endpoint to return 200, got ${configResponse.statusCode}.`);
}

const configBody = JSON.parse(configResponse.body) as {
  realRenderEnabled?: boolean;
  shortVideoMakerMode?: string;
  shortVideoMakerBaseUrl?: string;
  shortVideoMakerRenderPath?: string;
  shortVideoMakerTimeoutMs?: number;
  shortVideoMakerVendorPath?: string;
  storageDir?: string;
  apiAuthEnabled?: boolean;
  apiToken?: string;
  safe_defaults?: boolean;
  real_execution_blocked_by_default?: boolean;
};

if (
  configBody.realRenderEnabled !== false ||
  configBody.shortVideoMakerMode !== "http" ||
  configBody.shortVideoMakerBaseUrl !== "http://localhost:3123" ||
  configBody.shortVideoMakerRenderPath !== "/api/short-video" ||
  configBody.shortVideoMakerTimeoutMs !== 120000 ||
  configBody.shortVideoMakerVendorPath !== "vendor/short-video-maker" ||
  configBody.storageDir !== "storage/jobs" ||
  configBody.apiAuthEnabled !== false ||
  "apiToken" in configBody ||
  configBody.safe_defaults !== true ||
  configBody.real_execution_blocked_by_default !== true
) {
  throw new Error("Expected system config endpoint to return safe config view.");
}

const authStorageRoot = mkdtempSync(resolve(tmpdir(), "raiz-orchestrator-auth-test-"));
const authServer = createServer({ storageRoot: authStorageRoot, apiToken: "secret-token" });

try {
  const publicHealth = await authServer.inject({ method: "GET", url: "/health" });

  if (publicHealth.statusCode !== 200) {
    throw new Error(`Expected /health to remain public with API auth enabled, got ${publicHealth.statusCode}.`);
  }

  const missingToken = await authServer.inject({ method: "GET", url: "/system/config" });

  if (missingToken.statusCode !== 401) {
    throw new Error(`Expected missing API token to return 401, got ${missingToken.statusCode}.`);
  }

  const wrongToken = await authServer.inject({
    method: "GET",
    url: "/system/config",
    headers: { "x-raiz-api-token": "wrong-token" }
  });

  if (wrongToken.statusCode !== 401) {
    throw new Error(`Expected wrong API token to return 401, got ${wrongToken.statusCode}.`);
  }

  const correctToken = await authServer.inject({
    method: "GET",
    url: "/system/config",
    headers: { "x-raiz-api-token": "secret-token" }
  });

  if (correctToken.statusCode !== 200) {
    throw new Error(`Expected correct API token to return 200, got ${correctToken.statusCode}.`);
  }

  const correctTokenBody = JSON.parse(correctToken.body) as { apiAuthEnabled?: boolean; apiToken?: string };

  if (correctTokenBody.apiAuthEnabled !== true || "apiToken" in correctTokenBody) {
    throw new Error("Expected authenticated config view to expose apiAuthEnabled without token value.");
  }
} finally {
  rmSync(authStorageRoot, { recursive: true, force: true });
}

const renderResponse = await server.inject({
  method: "POST",
  url: "/jobs/render",
  payload: sampleJob
});

if (renderResponse.statusCode !== 202) {
  throw new Error(`Expected mock render to queue job, got ${renderResponse.statusCode}.`);
}

const jobDir = resolve(storageRoot, "jobs", String(sampleJob.job_id));

if (!existsSync(resolve(jobDir, "job.json"))) {
  throw new Error("Expected render request to create job.json.");
}

if (!existsSync(resolve(jobDir, "status.json"))) {
  throw new Error("Expected render request to create status.json.");
}

if (!existsSync(resolve(jobDir, "events.ndjson"))) {
  throw new Error("Expected render request to create events.ndjson.");
}

const savedJob = JSON.parse(readFileSync(resolve(jobDir, "job.json"), "utf8")) as Record<string, unknown>;

if (savedJob.job_id !== sampleJob.job_id) {
  throw new Error("Expected job.json to preserve original job_id.");
}

const savedStatus = JSON.parse(readFileSync(resolve(jobDir, "status.json"), "utf8")) as {
  adapter?: string;
  output_path?: string | null;
  error?: string | null;
};

if (savedStatus.adapter !== "short_video_maker" || savedStatus.output_path !== null || savedStatus.error !== null) {
  throw new Error("Expected status.json to contain queued short_video_maker status.");
}

const events = readFileSync(resolve(jobDir, "events.ndjson"), "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line) as { type?: string; job_id?: string });

if (events.length !== 1 || events[0]?.type !== "job.queued" || events[0]?.job_id !== sampleJob.job_id) {
  throw new Error("Expected one job.queued event.");
}

const statusBeforeArtifacts = readFileSync(resolve(jobDir, "status.json"), "utf8");
const eventsBeforeArtifacts = readFileSync(resolve(jobDir, "events.ndjson"), "utf8");
const renderArtifactsResponse = await server.inject({
  method: "GET",
  url: `/jobs/${sampleJob.job_id}/artifacts`
});

if (renderArtifactsResponse.statusCode !== 200) {
  throw new Error(`Expected artifacts endpoint to work after render, got ${renderArtifactsResponse.statusCode}.`);
}

const renderArtifacts = JSON.parse(renderArtifactsResponse.body) as ArtifactInventoryBody;

if (
  renderArtifacts.summary?.has_job !== true ||
  renderArtifacts.summary.has_status !== true ||
  !renderArtifacts.artifacts?.some((artifact) => artifact.name === "job.json" && artifact.type === "job_payload" && artifact.exists) ||
  !renderArtifacts.artifacts.some((artifact) => artifact.name === "status.json" && artifact.type === "job_status" && artifact.exists) ||
  !renderArtifacts.artifacts.some((artifact) => artifact.name === "events.ndjson" && artifact.type === "event_log" && artifact.exists)
) {
  throw new Error("Expected artifacts endpoint to detect job.json, status.json, and events.ndjson.");
}

if (
  readFileSync(resolve(jobDir, "status.json"), "utf8") !== statusBeforeArtifacts ||
  readFileSync(resolve(jobDir, "events.ndjson"), "utf8") !== eventsBeforeArtifacts
) {
  throw new Error("Expected artifacts endpoint to be read-only for status.json and events.ndjson.");
}

const remotionDirectQueuedJob = {
  ...sampleJob,
  job_id: "remotion-direct-adapter-queued-001",
  template: {
    ...(sampleJob.template as Record<string, unknown>),
    engine: "remotion_direct"
  },
  output: {
    ...(sampleJob.output as Record<string, unknown>),
    filename: "remotion-direct-adapter-queued-001.mp4"
  }
};

const remotionDirectQueuedResponse = await server.inject({
  method: "POST",
  url: "/jobs/render",
  payload: remotionDirectQueuedJob
});

if (remotionDirectQueuedResponse.statusCode !== 202) {
  throw new Error(`Expected /jobs/render to queue remotion_direct job, got ${remotionDirectQueuedResponse.statusCode}.`);
}

const remotionDirectQueuedBody = JSON.parse(remotionDirectQueuedResponse.body) as {
  status?: string;
  adapter?: string;
  output_path?: string | null;
};

if (
  remotionDirectQueuedBody.status !== "queued" ||
  remotionDirectQueuedBody.adapter !== "remotion_direct" ||
  remotionDirectQueuedBody.output_path !== null
) {
  throw new Error("Expected remotion_direct /jobs/render request to remain queued without output.");
}

const remotionDirectQueuedDir = resolve(storageRoot, "jobs", "remotion-direct-adapter-queued-001");
const remotionDirectQueuedStatus = JSON.parse(
  readFileSync(resolve(remotionDirectQueuedDir, "status.json"), "utf8")
) as {
  status?: string;
  adapter?: string;
};

if (remotionDirectQueuedStatus.status !== "queued" || remotionDirectQueuedStatus.adapter !== "remotion_direct") {
  throw new Error("Expected remotion_direct queued status to be persisted with remotion_direct adapter.");
}

if (existsSync(resolve(remotionDirectQueuedDir, "render-manifest.remotion-direct.json"))) {
  throw new Error("Expected /jobs/render not to execute remotion_direct rendering.");
}

const duplicateResponse = await server.inject({
  method: "POST",
  url: "/jobs/render",
  payload: sampleJob
});

if (duplicateResponse.statusCode !== 409) {
  throw new Error(`Expected duplicate job_id to return 409, got ${duplicateResponse.statusCode}.`);
}

const statusResponse = await server.inject({
  method: "GET",
  url: `/jobs/${sampleJob.job_id}/status`
});

if (statusResponse.statusCode !== 200) {
  throw new Error(`Expected queued job status, got ${statusResponse.statusCode}.`);
}

const statusBody = JSON.parse(statusResponse.body) as { status?: string };

if (statusBody.status !== "queued") {
  throw new Error(`Expected job status queued, got ${statusBody.status}.`);
}

const preparingResponse = await server.inject({
  method: "PATCH",
  url: `/jobs/${sampleJob.job_id}/status`,
  payload: {
    status: "preparing",
    metadata: { step: "assets" }
  }
});

if (preparingResponse.statusCode !== 200) {
  throw new Error(`Expected queued -> preparing to work, got ${preparingResponse.statusCode}.`);
}

const renderingResponse = await server.inject({
  method: "PATCH",
  url: `/jobs/${sampleJob.job_id}/status`,
  payload: {
    status: "rendering",
    metadata: { adapter: "short_video_maker" }
  }
});

if (renderingResponse.statusCode !== 200) {
  throw new Error(`Expected preparing -> rendering to work, got ${renderingResponse.statusCode}.`);
}

const renderingBody = JSON.parse(renderingResponse.body) as {
  metadata?: { step?: string; adapter?: string };
};

if (renderingBody.metadata?.step !== "assets" || renderingBody.metadata.adapter !== "short_video_maker") {
  throw new Error("Expected PATCH status metadata to merge new keys without dropping existing metadata.");
}

const renderedResponse = await server.inject({
  method: "PATCH",
  url: `/jobs/${sampleJob.job_id}/status`,
  payload: {
    status: "rendered",
    output_path: "/storage/exports/smoke-arabic-001.mp4"
  }
});

if (renderedResponse.statusCode !== 200) {
  throw new Error(`Expected rendering -> rendered to work, got ${renderedResponse.statusCode}.`);
}

const renderedBody = JSON.parse(renderedResponse.body) as { status?: string; output_path?: string | null };

if (renderedBody.status !== "rendered" || renderedBody.output_path !== "/storage/exports/smoke-arabic-001.mp4") {
  throw new Error("Expected rendered status to include output_path.");
}

const lifecycleEvents = readFileSync(resolve(jobDir, "events.ndjson"), "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line) as { type?: string; from?: string; to?: string; metadata?: unknown });

const statusChangedEvents = lifecycleEvents.filter((event) => event.type === "job.status_changed");

if (
  statusChangedEvents.length !== 3 ||
  statusChangedEvents[0]?.from !== "queued" ||
  statusChangedEvents[0]?.to !== "preparing" ||
  statusChangedEvents[1]?.from !== "preparing" ||
  statusChangedEvents[1]?.to !== "rendering" ||
  statusChangedEvents[2]?.from !== "rendering" ||
  statusChangedEvents[2]?.to !== "rendered"
) {
  throw new Error("Expected events.ndjson to record status transition events.");
}

const failedJob = {
  ...sampleJob,
  job_id: "smoke-arabic-failed-001",
  output: {
    ...(sampleJob.output as Record<string, unknown>),
    filename: "smoke-arabic-failed-001.mp4"
  }
};

const failedJobRenderResponse = await server.inject({
  method: "POST",
  url: "/jobs/render",
  payload: failedJob
});

if (failedJobRenderResponse.statusCode !== 202) {
  throw new Error(`Expected failed-path job to queue, got ${failedJobRenderResponse.statusCode}.`);
}

await server.inject({
  method: "PATCH",
  url: "/jobs/smoke-arabic-failed-001/status",
  payload: { status: "preparing" }
});

await server.inject({
  method: "PATCH",
  url: "/jobs/smoke-arabic-failed-001/status",
  payload: { status: "rendering" }
});

const failedResponse = await server.inject({
  method: "PATCH",
  url: "/jobs/smoke-arabic-failed-001/status",
  payload: {
    status: "failed",
    error: "mock render failure"
  }
});

if (failedResponse.statusCode !== 200) {
  throw new Error(`Expected rendering -> failed to work, got ${failedResponse.statusCode}.`);
}

const failedBody = JSON.parse(failedResponse.body) as { status?: string; error?: string | null };

if (failedBody.status !== "failed" || failedBody.error !== "mock render failure") {
  throw new Error("Expected failed status to include error.");
}

const invalidTransitionJob = {
  ...sampleJob,
  job_id: "smoke-arabic-invalid-transition-001",
  output: {
    ...(sampleJob.output as Record<string, unknown>),
    filename: "smoke-arabic-invalid-transition-001.mp4"
  }
};

const invalidTransitionRenderResponse = await server.inject({
  method: "POST",
  url: "/jobs/render",
  payload: invalidTransitionJob
});

if (invalidTransitionRenderResponse.statusCode !== 202) {
  throw new Error(`Expected invalid-transition job to queue, got ${invalidTransitionRenderResponse.statusCode}.`);
}

const invalidTransitionResponse = await server.inject({
  method: "PATCH",
  url: "/jobs/smoke-arabic-invalid-transition-001/status",
  payload: {
    status: "rendered"
  }
});

if (invalidTransitionResponse.statusCode !== 409) {
  throw new Error(`Expected queued -> rendered to be rejected, got ${invalidTransitionResponse.statusCode}.`);
}

const prepareJobPayload = {
  ...sampleJob,
  job_id: "smoke-arabic-prepare-001",
  output: {
    ...(sampleJob.output as Record<string, unknown>),
    filename: "smoke-arabic-prepare-001.mp4"
  }
};

const prepareRenderResponse = await server.inject({
  method: "POST",
  url: "/jobs/render",
  payload: prepareJobPayload
});

if (prepareRenderResponse.statusCode !== 202) {
  throw new Error(`Expected prepare-path job to queue, got ${prepareRenderResponse.statusCode}.`);
}

const prepareResponse = await server.inject({
  method: "POST",
  url: "/jobs/smoke-arabic-prepare-001/prepare"
});

if (prepareResponse.statusCode !== 200) {
  throw new Error(`Expected prepare endpoint to create render plan, got ${prepareResponse.statusCode}.`);
}

const prepareJobDir = resolve(storageRoot, "jobs", "smoke-arabic-prepare-001");

if (!existsSync(resolve(prepareJobDir, "render-plan.json"))) {
  throw new Error("Expected prepare endpoint to create render-plan.json.");
}

if (!existsSync(resolve(prepareJobDir, "output", ".gitkeep"))) {
  throw new Error("Expected prepare endpoint to create output/.gitkeep.");
}

const preparedArtifactsResponse = await server.inject({
  method: "GET",
  url: "/jobs/smoke-arabic-prepare-001/artifacts"
});

if (preparedArtifactsResponse.statusCode !== 200) {
  throw new Error(`Expected artifacts endpoint to work after prepare, got ${preparedArtifactsResponse.statusCode}.`);
}

const preparedArtifacts = JSON.parse(preparedArtifactsResponse.body) as ArtifactInventoryBody;

if (
  preparedArtifacts.summary?.has_render_plan !== true ||
  preparedArtifacts.summary.has_output !== true ||
  !preparedArtifacts.artifacts?.some((artifact) => artifact.name === "render-plan.json" && artifact.type === "render_plan" && artifact.exists)
) {
  throw new Error("Expected artifacts endpoint to detect render-plan.json after prepare.");
}

const renderPlan = JSON.parse(readFileSync(resolve(prepareJobDir, "render-plan.json"), "utf8")) as {
  width?: number;
  height?: number;
  output?: { local_path?: string };
};

if (
  renderPlan.width !== 1080 ||
  renderPlan.height !== 1920 ||
  renderPlan.output?.local_path !== resolve(prepareJobDir, "output", "smoke-arabic-prepare-001.mp4")
) {
  throw new Error("Expected render-plan.json to contain deterministic 1080x1920 output plan.");
}

const preparedStatusResponse = await server.inject({
  method: "GET",
  url: "/jobs/smoke-arabic-prepare-001/status"
});
const preparedStatus = JSON.parse(preparedStatusResponse.body) as {
  status?: string;
  metadata?: { render_plan_path?: string; output_dir?: string };
};

if (
  preparedStatus.status !== "preparing" ||
  preparedStatus.metadata?.render_plan_path !== resolve(prepareJobDir, "render-plan.json") ||
  preparedStatus.metadata?.output_dir !== resolve(prepareJobDir, "output")
) {
  throw new Error("Expected prepare endpoint to move job to preparing with render plan metadata.");
}

const prepareEvents = readFileSync(resolve(prepareJobDir, "events.ndjson"), "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line) as { type?: string; from?: string; to?: string });

if (
  !prepareEvents.some((event) => event.type === "job.status_changed" && event.from === "queued" && event.to === "preparing") ||
  !prepareEvents.some((event) => event.type === "job.render_plan_created")
) {
  throw new Error("Expected prepare endpoint to append preparing and render plan events.");
}

const duplicatePrepareResponse = await server.inject({
  method: "POST",
  url: "/jobs/smoke-arabic-prepare-001/prepare"
});

if (duplicatePrepareResponse.statusCode !== 409) {
  throw new Error(`Expected preparing the same job twice to return 409, got ${duplicatePrepareResponse.statusCode}.`);
}

const preflightResponse = await server.inject({
  method: "POST",
  url: "/jobs/smoke-arabic-prepare-001/preflight"
});

if (preflightResponse.statusCode !== 200) {
  throw new Error(`Expected preflight to pass for prepared Arabic job, got ${preflightResponse.statusCode}.`);
}

const preflightReport = JSON.parse(preflightResponse.body) as {
  status?: string;
  checks?: Array<{ name?: string; passed?: boolean }>;
};

if (
  preflightReport.status !== "passed" ||
  !preflightReport.checks?.some((check) => check.name === "arabic_direction" && check.passed)
) {
  throw new Error("Expected preflight report to pass Arabic RTL checks.");
}

if (!existsSync(resolve(prepareJobDir, "preflight-report.json"))) {
  throw new Error("Expected preflight to create preflight-report.json.");
}

const preflightArtifactsResponse = await server.inject({
  method: "GET",
  url: "/jobs/smoke-arabic-prepare-001/artifacts"
});

if (preflightArtifactsResponse.statusCode !== 200) {
  throw new Error(`Expected artifacts endpoint to work after preflight, got ${preflightArtifactsResponse.statusCode}.`);
}

const preflightArtifacts = JSON.parse(preflightArtifactsResponse.body) as ArtifactInventoryBody;

if (
  preflightArtifacts.summary?.has_preflight_report !== true ||
  !preflightArtifacts.artifacts?.some(
    (artifact) => artifact.name === "preflight-report.json" && artifact.type === "preflight_report" && artifact.exists
  )
) {
  throw new Error("Expected artifacts endpoint to detect preflight-report.json after preflight.");
}

const preflightEvents = readFileSync(resolve(prepareJobDir, "events.ndjson"), "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line) as { type?: string });

if (!preflightEvents.some((event) => event.type === "job.preflight_passed")) {
  throw new Error("Expected preflight to append job.preflight_passed event.");
}

const preflightStatusResponse = await server.inject({
  method: "GET",
  url: "/jobs/smoke-arabic-prepare-001/status"
});
const preflightStatus = JSON.parse(preflightStatusResponse.body) as {
  status?: string;
  metadata?: { preflight_report_path?: string; preflight_status?: string };
};

if (
  preflightStatus.status !== "preparing" ||
  preflightStatus.metadata?.preflight_status !== "passed" ||
  preflightStatus.metadata?.preflight_report_path !== resolve(prepareJobDir, "preflight-report.json")
) {
  throw new Error("Expected preflight to keep status preparing and update status metadata.");
}

const prepareJobAdapterHealthResponse = await server.inject({
  method: "POST",
  url: "/jobs/smoke-arabic-prepare-001/adapter-health"
});

if (prepareJobAdapterHealthResponse.statusCode !== 200) {
  throw new Error(`Expected adapter health report before readiness, got ${prepareJobAdapterHealthResponse.statusCode}.`);
}

if (!existsSync(resolve(prepareJobDir, "adapter-health.short-video-maker.json"))) {
  throw new Error("Expected adapter health report to exist before readiness.");
}

const adapterPayloadResponse = await server.inject({
  method: "POST",
  url: "/jobs/smoke-arabic-prepare-001/adapter-payload/short-video-maker"
});

if (adapterPayloadResponse.statusCode !== 200) {
  throw new Error(`Expected adapter payload creation after preflight, got ${adapterPayloadResponse.statusCode}.`);
}

const shortVideoMakerPayloadPath = resolve(prepareJobDir, "short-video-maker-payload.json");

if (!existsSync(shortVideoMakerPayloadPath)) {
  throw new Error("Expected adapter payload endpoint to create short-video-maker-payload.json.");
}

const adapterPayloadArtifactsResponse = await server.inject({
  method: "GET",
  url: "/jobs/smoke-arabic-prepare-001/artifacts"
});

if (adapterPayloadArtifactsResponse.statusCode !== 200) {
  throw new Error(`Expected artifacts endpoint to work after adapter payload, got ${adapterPayloadArtifactsResponse.statusCode}.`);
}

const adapterPayloadArtifacts = JSON.parse(adapterPayloadArtifactsResponse.body) as ArtifactInventoryBody;

if (
  adapterPayloadArtifacts.summary?.has_short_video_maker_payload !== true ||
  !adapterPayloadArtifacts.artifacts?.some(
    (artifact) =>
      artifact.name === "short-video-maker-payload.json" && artifact.type === "adapter_payload" && artifact.exists
  )
) {
  throw new Error("Expected artifacts endpoint to detect short-video-maker-payload.json after adapter payload creation.");
}

const shortVideoMakerPayload = JSON.parse(readFileSync(shortVideoMakerPayloadPath, "utf8")) as {
  adapter?: string;
  composition?: {
    aspect_ratio?: string;
    width?: number;
    height?: number;
    language?: string;
    direction?: string;
  };
  script?: { title?: string; text?: string };
  voice?: { provider?: string | null; voice_name?: string | null };
  captions?: { enabled?: boolean; format?: string; burn_in?: boolean };
  output?: { filename?: string; local_path?: string };
};

if (
  shortVideoMakerPayload.adapter !== "short_video_maker" ||
  shortVideoMakerPayload.composition?.aspect_ratio !== "9:16" ||
  shortVideoMakerPayload.composition.width !== 1080 ||
  shortVideoMakerPayload.composition.height !== 1920 ||
  shortVideoMakerPayload.composition.language !== "ar" ||
  shortVideoMakerPayload.composition.direction !== "rtl" ||
  shortVideoMakerPayload.script?.title !== sampleJob.title ||
  shortVideoMakerPayload.script?.text !== sampleJob.script ||
  shortVideoMakerPayload.voice?.provider !== "edge" ||
  shortVideoMakerPayload.voice?.voice_name !== "ar-SA-HamedNeural" ||
  shortVideoMakerPayload.captions?.enabled !== true ||
  shortVideoMakerPayload.captions?.format !== "ass" ||
  shortVideoMakerPayload.captions?.burn_in !== true ||
  shortVideoMakerPayload.output?.filename !== "smoke-arabic-prepare-001.mp4" ||
  shortVideoMakerPayload.output?.local_path !== resolve(prepareJobDir, "output", "smoke-arabic-prepare-001.mp4")
) {
  throw new Error("Expected short-video-maker payload to contain RAIZ render plan fields.");
}

const adapterPayloadStatusResponse = await server.inject({
  method: "GET",
  url: "/jobs/smoke-arabic-prepare-001/status"
});
const adapterPayloadStatus = JSON.parse(adapterPayloadStatusResponse.body) as {
  status?: string;
  metadata?: { short_video_maker_payload_path?: string };
};

if (
  adapterPayloadStatus.status !== "preparing" ||
  adapterPayloadStatus.metadata?.short_video_maker_payload_path !== shortVideoMakerPayloadPath
) {
  throw new Error("Expected adapter payload creation to leave status preparing and update metadata.");
}

const adapterPayloadEvents = readFileSync(resolve(prepareJobDir, "events.ndjson"), "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line) as { type?: string; adapter?: string });

if (
  !adapterPayloadEvents.some(
    (event) => event.type === "job.adapter_payload_created" && event.adapter === "short_video_maker"
  )
) {
  throw new Error("Expected adapter payload creation to append job.adapter_payload_created event.");
}

const readinessResponse = await server.inject({
  method: "POST",
  url: "/jobs/smoke-arabic-prepare-001/readiness-review"
});

if (readinessResponse.statusCode !== 200) {
  throw new Error(`Expected readiness review to pass after all required artifacts, got ${readinessResponse.statusCode}.`);
}

const readinessReview = JSON.parse(readinessResponse.body) as ReadinessReviewBody;

if (
  readinessReview.status !== "passed" ||
  readinessReview.ready_for_dry_run !== true ||
  !readinessReview.checks?.some((check) => check.name === "payload_direction" && check.passed)
) {
  throw new Error("Expected readiness review to pass and mark job ready for dry run.");
}

const readinessReviewPath = resolve(prepareJobDir, "readiness-review.json");

if (!existsSync(readinessReviewPath)) {
  throw new Error("Expected readiness review to create readiness-review.json.");
}

const readinessStatusResponse = await server.inject({
  method: "GET",
  url: "/jobs/smoke-arabic-prepare-001/status"
});
const readinessStatus = JSON.parse(readinessStatusResponse.body) as {
  status?: string;
  metadata?: {
    readiness_review_path?: string;
    readiness_status?: string;
    ready_for_dry_run?: boolean;
  };
};

if (
  readinessStatus.status !== "preparing" ||
  readinessStatus.metadata?.readiness_review_path !== readinessReviewPath ||
  readinessStatus.metadata.readiness_status !== "passed" ||
  readinessStatus.metadata.ready_for_dry_run !== true
) {
  throw new Error("Expected readiness review to keep status preparing and update readiness metadata.");
}

const readinessEvents = readFileSync(resolve(prepareJobDir, "events.ndjson"), "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line) as { type?: string });

if (!readinessEvents.some((event) => event.type === "job.readiness_passed")) {
  throw new Error("Expected readiness review to append job.readiness_passed event.");
}

const sendBeforeDryRunResponse = await server.inject({
  method: "POST",
  url: "/jobs/smoke-arabic-prepare-001/send-to-short-video-maker"
});

if (sendBeforeDryRunResponse.statusCode !== 409) {
  throw new Error(`Expected sender before dry-run request to return 409, got ${sendBeforeDryRunResponse.statusCode}.`);
}

const dryRunRequestResponse = await server.inject({
  method: "POST",
  url: "/jobs/smoke-arabic-prepare-001/adapter-dry-run/short-video-maker"
});

if (dryRunRequestResponse.statusCode !== 200) {
  throw new Error(`Expected dry-run request creation after readiness, got ${dryRunRequestResponse.statusCode}.`);
}

const dryRunRequest = JSON.parse(dryRunRequestResponse.body) as ShortVideoMakerDryRunRequestBody;

if (
  dryRunRequest.adapter !== "short_video_maker" ||
  dryRunRequest.mode !== "dry_run" ||
  dryRunRequest.safety?.will_execute !== false ||
  dryRunRequest.safety.will_start_process !== false ||
  dryRunRequest.safety.will_generate_video !== false ||
  dryRunRequest.safety.will_modify_vendor !== false ||
  dryRunRequest.request?.composition?.aspect_ratio !== "9:16" ||
  dryRunRequest.request.composition.width !== 1080 ||
  dryRunRequest.request.composition.height !== 1920 ||
  dryRunRequest.request.composition.language !== "ar" ||
  dryRunRequest.request.composition.direction !== "rtl"
) {
  throw new Error("Expected dry-run request to preserve payload composition and disable all execution safety flags.");
}

const dryRunRequestPath = resolve(prepareJobDir, "short-video-maker-request.dry-run.json");

if (!existsSync(dryRunRequestPath)) {
  throw new Error("Expected dry-run request endpoint to create short-video-maker-request.dry-run.json.");
}

const dryRunStatusResponse = await server.inject({
  method: "GET",
  url: "/jobs/smoke-arabic-prepare-001/status"
});
const dryRunStatus = JSON.parse(dryRunStatusResponse.body) as {
  status?: string;
  metadata?: {
    short_video_maker_dry_run_request_path?: string;
    dry_run_request_created?: boolean;
  };
};

if (
  dryRunStatus.status !== "preparing" ||
  dryRunStatus.metadata?.short_video_maker_dry_run_request_path !== dryRunRequestPath ||
  dryRunStatus.metadata.dry_run_request_created !== true
) {
  throw new Error("Expected dry-run request creation to keep status preparing and update dry-run metadata.");
}

const dryRunEvents = readFileSync(resolve(prepareJobDir, "events.ndjson"), "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line) as { type?: string; adapter?: string });

if (
  !dryRunEvents.some(
    (event) => event.type === "job.adapter_dry_run_request_created" && event.adapter === "short_video_maker"
  )
) {
  throw new Error("Expected dry-run request creation to append job.adapter_dry_run_request_created event.");
}

const dryRunArtifactsResponse = await server.inject({
  method: "GET",
  url: "/jobs/smoke-arabic-prepare-001/artifacts"
});

if (dryRunArtifactsResponse.statusCode !== 200) {
  throw new Error(`Expected artifacts endpoint to work after dry-run request, got ${dryRunArtifactsResponse.statusCode}.`);
}

const dryRunArtifacts = JSON.parse(dryRunArtifactsResponse.body) as ArtifactInventoryBody;

if (
  dryRunArtifacts.summary?.has_short_video_maker_dry_run_request !== true ||
  !dryRunArtifacts.artifacts?.some(
    (artifact) =>
      artifact.name === "short-video-maker-request.dry-run.json" &&
      artifact.type === "adapter_dry_run_request" &&
      artifact.exists
  )
) {
  throw new Error("Expected artifacts endpoint to detect short-video-maker dry-run request.");
}

const httpSendPlanResponse = await server.inject({
  method: "POST",
  url: "/jobs/smoke-arabic-prepare-001/http-send-plan/short-video-maker"
});

if (httpSendPlanResponse.statusCode !== 200) {
  throw new Error(`Expected HTTP send plan creation after dry-run request, got ${httpSendPlanResponse.statusCode}.`);
}

const httpSendPlan = JSON.parse(httpSendPlanResponse.body) as ShortVideoMakerHttpSendPlanBody;
const httpSendPlanPath = resolve(prepareJobDir, "short-video-maker-http-send.plan.json");

if (
  httpSendPlan.execution !== "planned_only" ||
  httpSendPlan.method !== "POST" ||
  httpSendPlan.url !== "http://localhost:3123/api/short-video" ||
  httpSendPlan.timeout_ms !== 120000 ||
  httpSendPlan.headers?.["content-type"] !== "application/json" ||
  httpSendPlan.body_source_path !== dryRunRequestPath ||
  httpSendPlan.safety?.will_make_network_request !== false
) {
  throw new Error("Expected HTTP send plan to contain deterministic planned-only request details.");
}

if (!existsSync(httpSendPlanPath)) {
  throw new Error("Expected HTTP send plan endpoint to create short-video-maker-http-send.plan.json.");
}

const httpSendPlanStatusResponse = await server.inject({
  method: "GET",
  url: "/jobs/smoke-arabic-prepare-001/status"
});
const httpSendPlanStatus = JSON.parse(httpSendPlanStatusResponse.body) as {
  status?: string;
  metadata?: {
    short_video_maker_http_send_plan_path?: string;
    http_send_plan_created?: boolean;
  };
};

if (
  httpSendPlanStatus.status !== "preparing" ||
  httpSendPlanStatus.metadata?.short_video_maker_http_send_plan_path !== httpSendPlanPath ||
  httpSendPlanStatus.metadata.http_send_plan_created !== true
) {
  throw new Error("Expected HTTP send plan creation to keep status preparing and update plan metadata.");
}

const httpSendPlanEvents = readFileSync(resolve(prepareJobDir, "events.ndjson"), "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line) as { type?: string; adapter?: string });

if (
  !httpSendPlanEvents.some((event) => event.type === "job.http_send_plan_created" && event.adapter === "short_video_maker")
) {
  throw new Error("Expected HTTP send plan creation to append job.http_send_plan_created event.");
}

const httpSendPlanArtifactsResponse = await server.inject({
  method: "GET",
  url: "/jobs/smoke-arabic-prepare-001/artifacts"
});

if (httpSendPlanArtifactsResponse.statusCode !== 200) {
  throw new Error(`Expected artifacts endpoint to work after HTTP send plan, got ${httpSendPlanArtifactsResponse.statusCode}.`);
}

const httpSendPlanArtifacts = JSON.parse(httpSendPlanArtifactsResponse.body) as ArtifactInventoryBody;

if (
  httpSendPlanArtifacts.summary?.has_short_video_maker_http_send_plan !== true ||
  !httpSendPlanArtifacts.artifacts?.some(
    (artifact) =>
      artifact.name === "short-video-maker-http-send.plan.json" &&
      artifact.type === "adapter_http_send_plan" &&
      artifact.exists
  )
) {
  throw new Error("Expected artifacts endpoint to detect short-video-maker HTTP send plan.");
}

const statusBeforeBlockedMockHttpSend = readFileSync(resolve(prepareJobDir, "status.json"), "utf8");
const eventsBeforeBlockedMockHttpSend = readFileSync(resolve(prepareJobDir, "events.ndjson"), "utf8");
const blockedMockHttpSendResponse = await server.inject({
  method: "POST",
  url: "/jobs/smoke-arabic-prepare-001/http-send-mock/short-video-maker"
});

if (blockedMockHttpSendResponse.statusCode !== 403) {
  throw new Error(`Expected mocked HTTP sender to return 403 by default, got ${blockedMockHttpSendResponse.statusCode}.`);
}

if (
  readFileSync(resolve(prepareJobDir, "status.json"), "utf8") !== statusBeforeBlockedMockHttpSend ||
  readFileSync(resolve(prepareJobDir, "events.ndjson"), "utf8") !== eventsBeforeBlockedMockHttpSend
) {
  throw new Error("Expected blocked mocked HTTP sender to leave status.json and events.ndjson unchanged.");
}

const originalFetch = globalThis.fetch;
let globalFetchCalled = false;
globalThis.fetch = (async () => {
  globalFetchCalled = true;
  throw new Error("Global fetch must not be used by mocked HTTP sender.");
}) as typeof fetch;

process.env.RAIZ_ENABLE_REAL_RENDER = "true";
const enabledMockHttpSendResponse = await server.inject({
  method: "POST",
  url: "/jobs/smoke-arabic-prepare-001/http-send-mock/short-video-maker"
});

if (enabledMockHttpSendResponse.statusCode !== 200) {
  globalThis.fetch = originalFetch;
  delete process.env.RAIZ_ENABLE_REAL_RENDER;
  throw new Error(`Expected enabled mocked HTTP sender to return 200, got ${enabledMockHttpSendResponse.statusCode}.`);
}

const enabledMockHttpSend = JSON.parse(enabledMockHttpSendResponse.body) as ShortVideoMakerMockHttpResponseBody;
const mockHttpResponsePath = resolve(prepareJobDir, "short-video-maker-response.mock.json");

if (
  enabledMockHttpSend.adapter !== "short_video_maker" ||
  enabledMockHttpSend.mode !== "http_mock" ||
  enabledMockHttpSend.status !== "submitted_mock" ||
  enabledMockHttpSend.http_status !== 202 ||
  !enabledMockHttpSend.external_job_id?.startsWith("mock-") ||
  enabledMockHttpSend.request_plan_path !== httpSendPlanPath ||
  enabledMockHttpSend.metadata?.mocked !== true
) {
  globalThis.fetch = originalFetch;
  delete process.env.RAIZ_ENABLE_REAL_RENDER;
  throw new Error("Expected enabled mocked HTTP sender to return mock submission contract.");
}

if (!existsSync(mockHttpResponsePath)) {
  globalThis.fetch = originalFetch;
  delete process.env.RAIZ_ENABLE_REAL_RENDER;
  throw new Error("Expected mocked HTTP sender to create short-video-maker-response.mock.json.");
}

const mockHttpStatusResponse = await server.inject({
  method: "GET",
  url: "/jobs/smoke-arabic-prepare-001/status"
});
const mockHttpStatus = JSON.parse(mockHttpStatusResponse.body) as {
  status?: string;
  metadata?: {
    short_video_maker_mock_response_path?: string;
    http_mock_send_completed?: boolean;
  };
};

if (
  mockHttpStatus.status !== "preparing" ||
  mockHttpStatus.metadata?.short_video_maker_mock_response_path !== mockHttpResponsePath ||
  mockHttpStatus.metadata.http_mock_send_completed !== true
) {
  globalThis.fetch = originalFetch;
  delete process.env.RAIZ_ENABLE_REAL_RENDER;
  throw new Error("Expected mocked HTTP sender to keep status preparing and update mock response metadata.");
}

const mockHttpEvents = readFileSync(resolve(prepareJobDir, "events.ndjson"), "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line) as { type?: string; adapter?: string });

if (
  !mockHttpEvents.some(
    (event) => event.type === "job.http_mock_send_completed" && event.adapter === "short_video_maker"
  )
) {
  globalThis.fetch = originalFetch;
  delete process.env.RAIZ_ENABLE_REAL_RENDER;
  throw new Error("Expected mocked HTTP sender to append job.http_mock_send_completed event.");
}

const mockHttpArtifactsResponse = await server.inject({
  method: "GET",
  url: "/jobs/smoke-arabic-prepare-001/artifacts"
});

if (mockHttpArtifactsResponse.statusCode !== 200) {
  globalThis.fetch = originalFetch;
  delete process.env.RAIZ_ENABLE_REAL_RENDER;
  throw new Error(`Expected artifacts endpoint to work after mocked HTTP send, got ${mockHttpArtifactsResponse.statusCode}.`);
}

const mockHttpArtifacts = JSON.parse(mockHttpArtifactsResponse.body) as ArtifactInventoryBody;

if (
  mockHttpArtifacts.summary?.has_short_video_maker_mock_response !== true ||
  !mockHttpArtifacts.artifacts?.some(
    (artifact) =>
      artifact.name === "short-video-maker-response.mock.json" &&
      artifact.type === "adapter_http_mock_response" &&
      artifact.exists
  )
) {
  globalThis.fetch = originalFetch;
  delete process.env.RAIZ_ENABLE_REAL_RENDER;
  throw new Error("Expected artifacts endpoint to detect short-video-maker mocked HTTP response.");
}

let injectedMockClientCalls = 0;
const injectedMockClient: HttpClient = {
  async post(url, body, options) {
    injectedMockClientCalls += 1;

    if (
      url !== "http://localhost:3123/api/short-video" ||
      !body ||
      options?.timeoutMs !== 120000 ||
      options.headers?.["content-type"] !== "application/json"
    ) {
      throw new Error("Expected injected mock client to receive deterministic HTTP send plan details.");
    }

    return {
      status: 202,
      ok: true,
      body: {
        external_job_id: "mock-injected-http-send"
      }
    };
  }
};

const injectedMockResponse = await sendShortVideoMakerWithMockedHttp(
  "smoke-arabic-prepare-001",
  injectedMockClient,
  { storageRoot }
);
delete process.env.RAIZ_ENABLE_REAL_RENDER;
globalThis.fetch = originalFetch;

if (injectedMockClientCalls !== 1 || injectedMockResponse.external_job_id !== "mock-injected-http-send") {
  throw new Error("Expected injected mock HTTP client to be called exactly once when guard is enabled.");
}

if (globalFetchCalled) {
  throw new Error("Expected mocked HTTP sender to avoid global fetch and real network calls.");
}

const realHttpSenderReadinessResponse = await server.inject({
  method: "POST",
  url: "/jobs/smoke-arabic-prepare-001/real-http-sender-readiness"
});

if (realHttpSenderReadinessResponse.statusCode !== 200) {
  throw new Error(
    `Expected real HTTP sender readiness to pass after mocked HTTP send, got ${realHttpSenderReadinessResponse.statusCode}.`
  );
}

const realHttpSenderReadiness = JSON.parse(realHttpSenderReadinessResponse.body) as RealHttpSenderReadinessBody;
const realHttpSenderReadinessPath = resolve(prepareJobDir, "real-http-sender-readiness.json");

if (
  realHttpSenderReadiness.status !== "passed" ||
  realHttpSenderReadiness.ready_for_real_http_sender !== true ||
  !realHttpSenderReadiness.checks?.some((check) => check.name === "mock_response_metadata" && check.passed)
) {
  throw new Error("Expected real HTTP sender readiness checklist to pass after mocked HTTP sender contract.");
}

if (!existsSync(realHttpSenderReadinessPath)) {
  throw new Error("Expected real HTTP sender readiness endpoint to create real-http-sender-readiness.json.");
}

const realHttpSenderReadinessStatusResponse = await server.inject({
  method: "GET",
  url: "/jobs/smoke-arabic-prepare-001/status"
});
const realHttpSenderReadinessStatus = JSON.parse(realHttpSenderReadinessStatusResponse.body) as {
  status?: string;
  metadata?: {
    real_http_sender_readiness_path?: string;
    real_http_sender_readiness_status?: string;
    ready_for_real_http_sender?: boolean;
  };
};

if (
  realHttpSenderReadinessStatus.status !== "preparing" ||
  realHttpSenderReadinessStatus.metadata?.real_http_sender_readiness_path !== realHttpSenderReadinessPath ||
  realHttpSenderReadinessStatus.metadata.real_http_sender_readiness_status !== "passed" ||
  realHttpSenderReadinessStatus.metadata.ready_for_real_http_sender !== true
) {
  throw new Error("Expected real HTTP sender readiness to keep status preparing and update readiness metadata.");
}

const realHttpSenderReadinessEvents = readFileSync(resolve(prepareJobDir, "events.ndjson"), "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line) as { type?: string });

if (!realHttpSenderReadinessEvents.some((event) => event.type === "job.real_http_sender_readiness_passed")) {
  throw new Error("Expected real HTTP sender readiness to append job.real_http_sender_readiness_passed event.");
}

const realHttpSenderReadinessArtifactsResponse = await server.inject({
  method: "GET",
  url: "/jobs/smoke-arabic-prepare-001/artifacts"
});

if (realHttpSenderReadinessArtifactsResponse.statusCode !== 200) {
  throw new Error(
    `Expected artifacts endpoint to work after real HTTP readiness, got ${realHttpSenderReadinessArtifactsResponse.statusCode}.`
  );
}

const realHttpSenderReadinessArtifacts = JSON.parse(realHttpSenderReadinessArtifactsResponse.body) as ArtifactInventoryBody;

if (
  realHttpSenderReadinessArtifacts.summary?.has_real_http_sender_readiness !== true ||
  !realHttpSenderReadinessArtifacts.artifacts?.some(
    (artifact) =>
      artifact.name === "real-http-sender-readiness.json" &&
      artifact.type === "real_http_sender_readiness" &&
      artifact.exists
  )
) {
  throw new Error("Expected artifacts endpoint to detect real-http-sender-readiness.json.");
}

const statusBeforeBlockedSend = readFileSync(resolve(prepareJobDir, "status.json"), "utf8");
const eventsBeforeBlockedSend = readFileSync(resolve(prepareJobDir, "events.ndjson"), "utf8");
const blockedSendResponse = await server.inject({
  method: "POST",
  url: "/jobs/smoke-arabic-prepare-001/send-to-short-video-maker"
});

if (blockedSendResponse.statusCode !== 403) {
  throw new Error(`Expected blocked sender to return 403 by default, got ${blockedSendResponse.statusCode}.`);
}

const blockedSendBody = JSON.parse(blockedSendResponse.body) as {
  status?: string;
  guard?: { real_render_enabled?: boolean; policy?: string };
};

if (
  blockedSendBody.status !== "blocked" ||
  blockedSendBody.guard?.real_render_enabled !== false ||
  blockedSendBody.guard.policy !== "blocked_by_default"
) {
  throw new Error("Expected blocked sender response to include execution guard details.");
}

if (
  readFileSync(resolve(prepareJobDir, "status.json"), "utf8") !== statusBeforeBlockedSend ||
  readFileSync(resolve(prepareJobDir, "events.ndjson"), "utf8") !== eventsBeforeBlockedSend
) {
  throw new Error("Expected blocked sender to leave status.json and events.ndjson unchanged.");
}

const realSendJobId = "smoke-arabic-real-send-001";
const realSendJobDir = await createJobThroughRealHttpSenderReadiness(realSendJobId);
const realHttpCallsBeforeSend = realHttpClientCalls;
process.env.RAIZ_ENABLE_REAL_RENDER = "true";
const enabledSendResponse = await server.inject({
  method: "POST",
  url: `/jobs/${realSendJobId}/send-to-short-video-maker`
});
delete process.env.RAIZ_ENABLE_REAL_RENDER;

if (enabledSendResponse.statusCode !== 200) {
  throw new Error(`Expected enabled real HTTP sender to return 200, got ${enabledSendResponse.statusCode}.`);
}

if (realHttpClientCalls !== realHttpCallsBeforeSend + 1) {
  throw new Error("Expected real HTTP sender to call injected HTTP client exactly once.");
}

const enabledSendBody = JSON.parse(enabledSendResponse.body) as ShortVideoMakerRealHttpResponseBody;
const realSentRequestPath = resolve(realSendJobDir, "short-video-maker-request.sent.json");
const realResponsePath = resolve(realSendJobDir, "short-video-maker-response.json");

if (
  enabledSendBody.adapter !== "short_video_maker" ||
  enabledSendBody.mode !== "http" ||
  enabledSendBody.status !== "submitted" ||
  enabledSendBody.http_status !== 202 ||
  enabledSendBody.external_job_id !== "mock-real-http-submit" ||
  enabledSendBody.request_path !== realSentRequestPath
) {
  throw new Error("Expected enabled real HTTP sender to return submitted response contract.");
}

if (!existsSync(realSentRequestPath) || !existsSync(realResponsePath)) {
  throw new Error("Expected real HTTP sender to create sent request and response artifacts.");
}

const realSendStatusResponse = await server.inject({
  method: "GET",
  url: `/jobs/${realSendJobId}/status`
});
const realSendStatus = JSON.parse(realSendStatusResponse.body) as {
  status?: string;
  metadata?: {
    short_video_maker_sent_request_path?: string;
    short_video_maker_response_path?: string;
    real_http_send_submitted?: boolean;
    external_job_id?: string;
  };
};

if (
  realSendStatus.status !== "rendering" ||
  realSendStatus.metadata?.short_video_maker_sent_request_path !== realSentRequestPath ||
  realSendStatus.metadata.short_video_maker_response_path !== realResponsePath ||
  realSendStatus.metadata.real_http_send_submitted !== true ||
  realSendStatus.metadata.external_job_id !== "mock-real-http-submit"
) {
  throw new Error("Expected successful real HTTP sender to transition preparing -> rendering with response metadata.");
}

const realSendEvents = readFileSync(resolve(realSendJobDir, "events.ndjson"), "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line) as { type?: string; from?: string; to?: string; adapter?: string });

if (
  !realSendEvents.some((event) => event.type === "job.status_changed" && event.from === "preparing" && event.to === "rendering") ||
  !realSendEvents.some((event) => event.type === "job.real_http_send_submitted" && event.adapter === "short_video_maker")
) {
  throw new Error("Expected successful real HTTP sender to append rendering transition and submitted event.");
}

const realSendArtifactsResponse = await server.inject({
  method: "GET",
  url: `/jobs/${realSendJobId}/artifacts`
});
const realSendArtifacts = JSON.parse(realSendArtifactsResponse.body) as ArtifactInventoryBody;

if (
  realSendArtifacts.summary?.has_short_video_maker_sent_request !== true ||
  realSendArtifacts.summary.has_short_video_maker_response !== true ||
  !realSendArtifacts.artifacts?.some(
    (artifact) =>
      artifact.name === "short-video-maker-request.sent.json" &&
      artifact.type === "adapter_sent_request" &&
      artifact.exists
  ) ||
  !realSendArtifacts.artifacts.some(
    (artifact) =>
      artifact.name === "short-video-maker-response.json" && artifact.type === "adapter_response" && artifact.exists
  )
) {
  throw new Error("Expected artifacts endpoint to detect real HTTP sent request and response artifacts.");
}

const finalVideoPath = resolve(realSendJobDir, "output", `${realSendJobId}.mp4`);
writeFileSync(finalVideoPath, "mock upstream video output");

const outputIngestionResponse = await server.inject({
  method: "POST",
  url: `/jobs/${realSendJobId}/ingest-output/short-video-maker`
});

if (outputIngestionResponse.statusCode !== 200) {
  throw new Error(`Expected output ingestion to return 200, got ${outputIngestionResponse.statusCode}.`);
}

const outputManifest = JSON.parse(outputIngestionResponse.body) as ShortVideoMakerOutputManifestBody;
const outputManifestPath = resolve(realSendJobDir, "output-manifest.json");

if (
  outputManifest.adapter !== "short_video_maker" ||
  outputManifest.status !== "ingested" ||
  outputManifest.output_path !== finalVideoPath ||
  outputManifest.final_video_path !== finalVideoPath ||
  !outputManifest.checks?.some((check) => check.name === "response_output_file_exists" && check.passed)
) {
  throw new Error("Expected output ingestion to return ingested manifest with final video path.");
}

if (!existsSync(outputManifestPath)) {
  throw new Error("Expected output ingestion to create output-manifest.json.");
}

const outputIngestionStatusResponse = await server.inject({
  method: "GET",
  url: `/jobs/${realSendJobId}/status`
});
const outputIngestionStatus = JSON.parse(outputIngestionStatusResponse.body) as {
  status?: string;
  output_path?: string | null;
  metadata?: {
    output_manifest_path?: string;
    final_video_path?: string | null;
  };
};

if (
  outputIngestionStatus.status !== "rendered" ||
  outputIngestionStatus.output_path !== finalVideoPath ||
  outputIngestionStatus.metadata?.output_manifest_path !== outputManifestPath ||
  outputIngestionStatus.metadata.final_video_path !== finalVideoPath
) {
  throw new Error("Expected output ingestion to transition rendering -> rendered with final video metadata.");
}

const outputIngestionEvents = readFileSync(resolve(realSendJobDir, "events.ndjson"), "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line) as { type?: string; from?: string; to?: string; adapter?: string });

if (
  !outputIngestionEvents.some((event) => event.type === "job.status_changed" && event.from === "rendering" && event.to === "rendered") ||
  !outputIngestionEvents.some((event) => event.type === "job.output_ingested" && event.adapter === "short_video_maker")
) {
  throw new Error("Expected output ingestion to append rendered transition and job.output_ingested event.");
}

const outputManifestArtifactsResponse = await server.inject({
  method: "GET",
  url: `/jobs/${realSendJobId}/artifacts`
});
const outputManifestArtifacts = JSON.parse(outputManifestArtifactsResponse.body) as ArtifactInventoryBody;

if (
  outputManifestArtifacts.summary?.has_output_manifest !== true ||
  !outputManifestArtifacts.artifacts?.some(
    (artifact) => artifact.name === "output-manifest.json" && artifact.type === "output_manifest" && artifact.exists
  )
) {
  throw new Error("Expected artifacts endpoint to detect output-manifest.json.");
}

const reviewPackageResponse = await server.inject({
  method: "POST",
  url: `/jobs/${realSendJobId}/review-package`
});

if (reviewPackageResponse.statusCode !== 200) {
  throw new Error(`Expected review package creation to return 200, got ${reviewPackageResponse.statusCode}.`);
}

const reviewPackage = JSON.parse(reviewPackageResponse.body) as OutputReviewPackageBody;
const reviewPackagePath = resolve(realSendJobDir, "review-package.json");
const reviewFolderPath = resolve(realSendJobDir, "review");

if (
  reviewPackage.status !== "ready_for_review" ||
  reviewPackage.final_video_path !== finalVideoPath ||
  reviewPackage.job_summary?.title !== sampleJob.title ||
  reviewPackage.job_summary?.language !== "ar" ||
  reviewPackage.job_summary?.direction !== "rtl" ||
  reviewPackage.job_summary?.aspect_ratio !== "9:16" ||
  reviewPackage.job_summary?.template_id !== "raiz_dark_hook_01" ||
  reviewPackage.render_metadata?.output_manifest_path !== outputManifestPath ||
  reviewPackage.render_metadata?.review_folder_path !== reviewFolderPath ||
  !reviewPackage.timestamps?.job_created_at ||
  !reviewPackage.timestamps.job_updated_at ||
  !reviewPackage.timestamps.output_manifest_created_at ||
  !reviewPackage.timestamps.review_package_created_at ||
  !Array.isArray(reviewPackage.warnings) ||
  !Array.isArray(reviewPackage.errors)
) {
  throw new Error("Expected review package to include final video path, job summary, metadata, timestamps, and issues.");
}

if (!existsSync(reviewPackagePath) || !existsSync(reviewFolderPath)) {
  throw new Error("Expected review package creation to create review-package.json and review/ folder.");
}

const reviewPackageStatusResponse = await server.inject({
  method: "GET",
  url: `/jobs/${realSendJobId}/status`
});
const reviewPackageStatus = JSON.parse(reviewPackageStatusResponse.body) as {
  status?: string;
  metadata?: {
    review_package_path?: string;
    review_folder_path?: string;
    review_package_created?: boolean;
  };
};

if (
  reviewPackageStatus.status !== "rendered" ||
  reviewPackageStatus.metadata?.review_package_path !== reviewPackagePath ||
  reviewPackageStatus.metadata.review_folder_path !== reviewFolderPath ||
  reviewPackageStatus.metadata.review_package_created !== true
) {
  throw new Error("Expected review package creation to keep status rendered and update review metadata.");
}

const reviewPackageEvents = readFileSync(resolve(realSendJobDir, "events.ndjson"), "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line) as { type?: string });

if (!reviewPackageEvents.some((event) => event.type === "job.review_package_created")) {
  throw new Error("Expected review package creation to append job.review_package_created event.");
}

const reviewPackageArtifactsResponse = await server.inject({
  method: "GET",
  url: `/jobs/${realSendJobId}/artifacts`
});
const reviewPackageArtifacts = JSON.parse(reviewPackageArtifactsResponse.body) as ArtifactInventoryBody;

if (
  reviewPackageArtifacts.summary?.has_review_package !== true ||
  reviewPackageArtifacts.summary.has_review_folder !== true ||
  !reviewPackageArtifacts.artifacts?.some(
    (artifact) => artifact.name === "review-package.json" && artifact.type === "review_package" && artifact.exists
  ) ||
  !reviewPackageArtifacts.artifacts.some(
    (artifact) => artifact.name === "review" && artifact.type === "review_dir" && artifact.exists
  )
) {
  throw new Error("Expected artifacts endpoint to detect review-package.json and review/ folder.");
}

const manualApprovalResponse = await server.inject({
  method: "POST",
  url: `/jobs/${realSendJobId}/manual-review/approve`,
  payload: {
    reviewerNote: "Approved for local publish gate."
  }
});

if (manualApprovalResponse.statusCode !== 200) {
  throw new Error(`Expected manual approval to return 200, got ${manualApprovalResponse.statusCode}.`);
}

const manualApproval = JSON.parse(manualApprovalResponse.body) as ManualReviewDecisionBody;
const manualApprovalPath = resolve(realSendJobDir, "manual-review-approval.json");

if (
  manualApproval.status !== "approved" ||
  manualApproval.reviewer_note !== "Approved for local publish gate." ||
  manualApproval.review_package_path !== reviewPackagePath ||
  !manualApproval.approved_at ||
  !existsSync(manualApprovalPath)
) {
  throw new Error("Expected manual approval to write approval artifact with reviewer note.");
}

const manualApprovalStatusResponse = await server.inject({
  method: "GET",
  url: `/jobs/${realSendJobId}/status`
});
const manualApprovalStatus = JSON.parse(manualApprovalStatusResponse.body) as {
  status?: string;
  metadata?: {
    manual_review_approved?: boolean;
    manual_review_approval_path?: string;
  };
};

if (
  manualApprovalStatus.status !== "rendered" ||
  manualApprovalStatus.metadata?.manual_review_approved !== true ||
  manualApprovalStatus.metadata.manual_review_approval_path !== manualApprovalPath
) {
  throw new Error("Expected manual approval to keep status rendered and update approval metadata.");
}

const manualApprovalEvents = readFileSync(resolve(realSendJobDir, "events.ndjson"), "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line) as { type?: string });

if (!manualApprovalEvents.some((event) => event.type === "job.manual_review_approved")) {
  throw new Error("Expected manual approval to append job.manual_review_approved event.");
}

const manualApprovalArtifactsResponse = await server.inject({
  method: "GET",
  url: `/jobs/${realSendJobId}/artifacts`
});
const manualApprovalArtifacts = JSON.parse(manualApprovalArtifactsResponse.body) as ArtifactInventoryBody;

if (
  manualApprovalArtifacts.summary?.has_manual_review_approval !== true ||
  !manualApprovalArtifacts.artifacts?.some(
    (artifact) =>
      artifact.name === "manual-review-approval.json" &&
      artifact.type === "manual_review_approval" &&
      artifact.exists
  )
) {
  throw new Error("Expected artifacts endpoint to detect manual-review-approval.json.");
}

const publishPackageResponse = await server.inject({
  method: "POST",
  url: `/jobs/${realSendJobId}/publish-package`
});

if (publishPackageResponse.statusCode !== 200) {
  throw new Error(`Expected publish package creation to return 200, got ${publishPackageResponse.statusCode}.`);
}

const publishPackage = JSON.parse(publishPackageResponse.body) as PublishPackageBody;
const publishPackagePath = resolve(realSendJobDir, "publish-package.json");

if (
  publishPackage.status !== "ready_for_publish" ||
  publishPackage.final_video_path !== finalVideoPath ||
  publishPackage.title !== sampleJob.title ||
  publishPackage.description !== null ||
  !Array.isArray(publishPackage.hashtags) ||
  publishPackage.platform_targets?.[0]?.platform !== "youtube_shorts" ||
  publishPackage.platform_targets?.[0]?.enabled !== false ||
  publishPackage.platform_targets?.[0]?.status !== "placeholder" ||
  publishPackage.approval?.approved !== true ||
  publishPackage.approval.reviewer_note !== "Approved for local publish gate." ||
  publishPackage.approval.approval_path !== manualApprovalPath ||
  !publishPackage.approval.approved_at ||
  publishPackage.metadata?.source !== "raiz_video_factory" ||
  !publishPackage.metadata.created_at ||
  !existsSync(publishPackagePath)
) {
  throw new Error("Expected publish package to include local publish contract fields after manual approval.");
}

const publishPackageStatusResponse = await server.inject({
  method: "GET",
  url: `/jobs/${realSendJobId}/status`
});
const publishPackageStatus = JSON.parse(publishPackageStatusResponse.body) as {
  status?: string;
  metadata?: {
    publish_package_created?: boolean;
    publish_package_path?: string;
  };
};

if (
  publishPackageStatus.status !== "rendered" ||
  publishPackageStatus.metadata?.publish_package_created !== true ||
  publishPackageStatus.metadata.publish_package_path !== publishPackagePath
) {
  throw new Error("Expected publish package creation to keep status rendered and update publish metadata.");
}

const publishPackageEvents = readFileSync(resolve(realSendJobDir, "events.ndjson"), "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line) as { type?: string });

if (!publishPackageEvents.some((event) => event.type === "job.publish_package_created")) {
  throw new Error("Expected publish package creation to append job.publish_package_created event.");
}

const publishPackageArtifactsResponse = await server.inject({
  method: "GET",
  url: `/jobs/${realSendJobId}/artifacts`
});
const publishPackageArtifacts = JSON.parse(publishPackageArtifactsResponse.body) as ArtifactInventoryBody;

if (
  publishPackageArtifacts.summary?.has_publish_package !== true ||
  !publishPackageArtifacts.artifacts?.some(
    (artifact) => artifact.name === "publish-package.json" && artifact.type === "publish_package" && artifact.exists
  )
) {
  throw new Error("Expected artifacts endpoint to detect publish-package.json.");
}

const youtubeUploadPlanResponse = await server.inject({
  method: "POST",
  url: `/jobs/${realSendJobId}/youtube-upload-plan`
});

if (youtubeUploadPlanResponse.statusCode !== 200) {
  throw new Error(`Expected YouTube upload plan creation to return 200, got ${youtubeUploadPlanResponse.statusCode}.`);
}

const youtubeUploadPlan = JSON.parse(youtubeUploadPlanResponse.body) as YouTubeUploadPlanBody;
const youtubeUploadPlanPath = resolve(realSendJobDir, "youtube-upload.plan.json");

if (
  youtubeUploadPlan.platform !== "youtube" ||
  youtubeUploadPlan.mode !== "upload_plan" ||
  youtubeUploadPlan.video_path !== finalVideoPath ||
  youtubeUploadPlan.title !== sampleJob.title ||
  youtubeUploadPlan.description !== null ||
  !Array.isArray(youtubeUploadPlan.tags) ||
  youtubeUploadPlan.privacyStatus !== "placeholder" ||
  youtubeUploadPlan.made_for_kids !== false ||
  youtubeUploadPlan.publish_package_path !== publishPackagePath ||
  youtubeUploadPlan.safety?.will_upload !== false ||
  youtubeUploadPlan.safety.will_make_network_request !== false ||
  youtubeUploadPlan.safety.will_modify_video !== false ||
  youtubeUploadPlan.metadata?.source !== "raiz_video_factory" ||
  !youtubeUploadPlan.metadata.created_at ||
  !existsSync(youtubeUploadPlanPath)
) {
  throw new Error("Expected YouTube upload plan to contain local no-upload plan fields.");
}

const youtubeUploadPlanStatusResponse = await server.inject({
  method: "GET",
  url: `/jobs/${realSendJobId}/status`
});
const youtubeUploadPlanStatus = JSON.parse(youtubeUploadPlanStatusResponse.body) as {
  status?: string;
  metadata?: {
    youtube_upload_plan_created?: boolean;
    youtube_upload_plan_path?: string;
  };
};

if (
  youtubeUploadPlanStatus.status !== "rendered" ||
  youtubeUploadPlanStatus.metadata?.youtube_upload_plan_created !== true ||
  youtubeUploadPlanStatus.metadata.youtube_upload_plan_path !== youtubeUploadPlanPath
) {
  throw new Error("Expected YouTube upload plan to keep status rendered and update metadata.");
}

const youtubeUploadPlanEvents = readFileSync(resolve(realSendJobDir, "events.ndjson"), "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line) as { type?: string });

if (!youtubeUploadPlanEvents.some((event) => event.type === "job.youtube_upload_plan_created")) {
  throw new Error("Expected YouTube upload plan creation to append job.youtube_upload_plan_created event.");
}

const youtubeUploadPlanArtifactsResponse = await server.inject({
  method: "GET",
  url: `/jobs/${realSendJobId}/artifacts`
});
const youtubeUploadPlanArtifacts = JSON.parse(youtubeUploadPlanArtifactsResponse.body) as ArtifactInventoryBody;

if (
  youtubeUploadPlanArtifacts.summary?.has_youtube_upload_plan !== true ||
  !youtubeUploadPlanArtifacts.artifacts?.some(
    (artifact) => artifact.name === "youtube-upload.plan.json" && artifact.type === "youtube_upload_plan" && artifact.exists
  )
) {
  throw new Error("Expected artifacts endpoint to detect youtube-upload.plan.json.");
}

const missingDriveN8nWorkflowPlanResponse = await server.inject({
  method: "POST",
  url: `/jobs/${realSendJobId}/n8n-workflow-plan`
});

if (missingDriveN8nWorkflowPlanResponse.statusCode !== 409) {
  throw new Error(
    `Expected n8n workflow plan before Google Drive export plan to return 409, got ${missingDriveN8nWorkflowPlanResponse.statusCode}.`
  );
}

const googleDriveExportPlanResponse = await server.inject({
  method: "POST",
  url: `/jobs/${realSendJobId}/google-drive-export-plan`
});

if (googleDriveExportPlanResponse.statusCode !== 200) {
  throw new Error(`Expected Google Drive export plan creation to return 200, got ${googleDriveExportPlanResponse.statusCode}.`);
}

const googleDriveExportPlan = JSON.parse(googleDriveExportPlanResponse.body) as GoogleDriveExportPlanBody;
const googleDriveExportPlanPath = resolve(realSendJobDir, "google-drive-export.plan.json");

if (
  googleDriveExportPlan.platform !== "google_drive" ||
  googleDriveExportPlan.mode !== "export_plan" ||
  googleDriveExportPlan.source_video_path !== finalVideoPath ||
  googleDriveExportPlan.filename !== `${realSendJobId}.mp4` ||
  googleDriveExportPlan.title !== sampleJob.title ||
  googleDriveExportPlan.description !== null ||
  googleDriveExportPlan.target?.type !== "google_drive_folder" ||
  googleDriveExportPlan.target.folder_id !== "placeholder" ||
  googleDriveExportPlan.target.folder_name !== "placeholder" ||
  googleDriveExportPlan.publish_package_path !== publishPackagePath ||
  googleDriveExportPlan.youtube_upload_plan_path !== youtubeUploadPlanPath ||
  googleDriveExportPlan.safety?.will_upload !== false ||
  googleDriveExportPlan.safety.will_make_network_request !== false ||
  googleDriveExportPlan.safety.will_modify_video !== false ||
  googleDriveExportPlan.metadata?.source !== "raiz_video_factory" ||
  !googleDriveExportPlan.metadata.created_at ||
  !existsSync(googleDriveExportPlanPath)
) {
  throw new Error("Expected Google Drive export plan to contain local no-upload plan fields.");
}

const googleDriveExportPlanStatusResponse = await server.inject({
  method: "GET",
  url: `/jobs/${realSendJobId}/status`
});
const googleDriveExportPlanStatus = JSON.parse(googleDriveExportPlanStatusResponse.body) as {
  status?: string;
  metadata?: {
    google_drive_export_plan_created?: boolean;
    google_drive_export_plan_path?: string;
  };
};

if (
  googleDriveExportPlanStatus.status !== "rendered" ||
  googleDriveExportPlanStatus.metadata?.google_drive_export_plan_created !== true ||
  googleDriveExportPlanStatus.metadata.google_drive_export_plan_path !== googleDriveExportPlanPath
) {
  throw new Error("Expected Google Drive export plan to keep status rendered and update metadata.");
}

const googleDriveExportPlanEvents = readFileSync(resolve(realSendJobDir, "events.ndjson"), "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line) as { type?: string });

if (!googleDriveExportPlanEvents.some((event) => event.type === "job.google_drive_export_plan_created")) {
  throw new Error("Expected Google Drive export plan creation to append job.google_drive_export_plan_created event.");
}

const googleDriveExportPlanArtifactsResponse = await server.inject({
  method: "GET",
  url: `/jobs/${realSendJobId}/artifacts`
});
const googleDriveExportPlanArtifacts = JSON.parse(googleDriveExportPlanArtifactsResponse.body) as ArtifactInventoryBody;

if (
  googleDriveExportPlanArtifacts.summary?.has_google_drive_export_plan !== true ||
  !googleDriveExportPlanArtifacts.artifacts?.some(
    (artifact) =>
      artifact.name === "google-drive-export.plan.json" &&
      artifact.type === "google_drive_export_plan" &&
      artifact.exists
  )
) {
  throw new Error("Expected artifacts endpoint to detect google-drive-export.plan.json.");
}

const n8nWorkflowPlanResponse = await server.inject({
  method: "POST",
  url: `/jobs/${realSendJobId}/n8n-workflow-plan`
});

if (n8nWorkflowPlanResponse.statusCode !== 200) {
  throw new Error(`Expected n8n workflow plan creation to return 200, got ${n8nWorkflowPlanResponse.statusCode}.`);
}

const n8nWorkflowPlan = JSON.parse(n8nWorkflowPlanResponse.body) as N8nWorkflowPlanBody;
const n8nWorkflowPlanPath = resolve(realSendJobDir, "n8n-workflow.plan.json");

if (
  n8nWorkflowPlan.platform !== "n8n" ||
  n8nWorkflowPlan.mode !== "workflow_plan" ||
  n8nWorkflowPlan.trigger?.type !== "manual" ||
  n8nWorkflowPlan.trigger.execution !== "disabled" ||
  n8nWorkflowPlan.inputs?.publish_package_path !== publishPackagePath ||
  n8nWorkflowPlan.inputs.youtube_upload_plan_path !== youtubeUploadPlanPath ||
  n8nWorkflowPlan.inputs.google_drive_export_plan_path !== googleDriveExportPlanPath ||
  !n8nWorkflowPlan.workflow_steps?.some((step) => step.name === "youtube_upload" && step.enabled === false) ||
  !n8nWorkflowPlan.workflow_steps.some((step) => step.name === "google_drive_export" && step.enabled === false) ||
  n8nWorkflowPlan.references?.final_video_path !== finalVideoPath ||
  n8nWorkflowPlan.references.youtube_title !== sampleJob.title ||
  n8nWorkflowPlan.references.google_drive_filename !== `${realSendJobId}.mp4` ||
  n8nWorkflowPlan.safety?.will_execute_workflow !== false ||
  n8nWorkflowPlan.safety.will_make_network_request !== false ||
  n8nWorkflowPlan.safety.will_upload !== false ||
  n8nWorkflowPlan.safety.will_modify_video !== false ||
  n8nWorkflowPlan.metadata?.source !== "raiz_video_factory" ||
  !n8nWorkflowPlan.metadata.created_at ||
  !existsSync(n8nWorkflowPlanPath)
) {
  throw new Error("Expected n8n workflow plan to contain local no-execution workflow fields.");
}

const n8nWorkflowPlanStatusResponse = await server.inject({
  method: "GET",
  url: `/jobs/${realSendJobId}/status`
});
const n8nWorkflowPlanStatus = JSON.parse(n8nWorkflowPlanStatusResponse.body) as {
  status?: string;
  metadata?: {
    n8n_workflow_plan_created?: boolean;
    n8n_workflow_plan_path?: string;
  };
};

if (
  n8nWorkflowPlanStatus.status !== "rendered" ||
  n8nWorkflowPlanStatus.metadata?.n8n_workflow_plan_created !== true ||
  n8nWorkflowPlanStatus.metadata.n8n_workflow_plan_path !== n8nWorkflowPlanPath
) {
  throw new Error("Expected n8n workflow plan to keep status rendered and update metadata.");
}

const n8nWorkflowPlanEvents = readFileSync(resolve(realSendJobDir, "events.ndjson"), "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line) as { type?: string });

if (!n8nWorkflowPlanEvents.some((event) => event.type === "job.n8n_workflow_plan_created")) {
  throw new Error("Expected n8n workflow plan creation to append job.n8n_workflow_plan_created event.");
}

const n8nWorkflowPlanArtifactsResponse = await server.inject({
  method: "GET",
  url: `/jobs/${realSendJobId}/artifacts`
});
const n8nWorkflowPlanArtifacts = JSON.parse(n8nWorkflowPlanArtifactsResponse.body) as ArtifactInventoryBody;

if (
  n8nWorkflowPlanArtifacts.summary?.has_n8n_workflow_plan !== true ||
  !n8nWorkflowPlanArtifacts.artifacts?.some(
    (artifact) => artifact.name === "n8n-workflow.plan.json" && artifact.type === "n8n_workflow_plan" && artifact.exists
  )
) {
  throw new Error("Expected artifacts endpoint to detect n8n-workflow.plan.json.");
}

const manualRejectJobId = "smoke-arabic-manual-reject-001";
const manualRejectJobDir = await createJobThroughReviewPackage(manualRejectJobId);
const manualRejectResponse = await server.inject({
  method: "POST",
  url: `/jobs/${manualRejectJobId}/manual-review/reject`,
  payload: {
    reviewerNote: "Rejected for local review."
  }
});

if (manualRejectResponse.statusCode !== 200) {
  throw new Error(`Expected manual rejection to return 200, got ${manualRejectResponse.statusCode}.`);
}

const manualRejection = JSON.parse(manualRejectResponse.body) as ManualReviewDecisionBody;
const manualRejectionPath = resolve(manualRejectJobDir, "manual-review-rejection.json");

if (
  manualRejection.status !== "rejected" ||
  manualRejection.reviewer_note !== "Rejected for local review." ||
  !manualRejection.rejected_at ||
  !existsSync(manualRejectionPath)
) {
  throw new Error("Expected manual rejection to write rejection artifact with reviewer note.");
}

const manualRejectionStatusResponse = await server.inject({
  method: "GET",
  url: `/jobs/${manualRejectJobId}/status`
});
const manualRejectionStatus = JSON.parse(manualRejectionStatusResponse.body) as {
  status?: string;
  metadata?: {
    manual_review_approved?: boolean;
    manual_review_rejection_path?: string;
  };
};

if (
  manualRejectionStatus.status !== "rendered" ||
  manualRejectionStatus.metadata?.manual_review_approved !== false ||
  manualRejectionStatus.metadata.manual_review_rejection_path !== manualRejectionPath
) {
  throw new Error("Expected manual rejection to keep status rendered and update rejection metadata.");
}

const manualRejectionEvents = readFileSync(resolve(manualRejectJobDir, "events.ndjson"), "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line) as { type?: string });

if (!manualRejectionEvents.some((event) => event.type === "job.manual_review_rejected")) {
  throw new Error("Expected manual rejection to append job.manual_review_rejected event.");
}

const manualRejectionArtifactsResponse = await server.inject({
  method: "GET",
  url: `/jobs/${manualRejectJobId}/artifacts`
});
const manualRejectionArtifacts = JSON.parse(manualRejectionArtifactsResponse.body) as ArtifactInventoryBody;

if (
  manualRejectionArtifacts.summary?.has_manual_review_rejection !== true ||
  !manualRejectionArtifacts.artifacts?.some(
    (artifact) =>
      artifact.name === "manual-review-rejection.json" &&
      artifact.type === "manual_review_rejection" &&
      artifact.exists
  )
) {
  throw new Error("Expected artifacts endpoint to detect manual-review-rejection.json.");
}

const rejectedPublishPackageResponse = await server.inject({
  method: "POST",
  url: `/jobs/${manualRejectJobId}/publish-package`
});

if (rejectedPublishPackageResponse.statusCode !== 409) {
  throw new Error(
    `Expected publish package after manual rejection to return 409, got ${rejectedPublishPackageResponse.statusCode}.`
  );
}

const rejectedYouTubeUploadPlanResponse = await server.inject({
  method: "POST",
  url: `/jobs/${manualRejectJobId}/youtube-upload-plan`
});

if (rejectedYouTubeUploadPlanResponse.statusCode !== 409) {
  throw new Error(
    `Expected YouTube upload plan after manual rejection to return 409, got ${rejectedYouTubeUploadPlanResponse.statusCode}.`
  );
}

const rejectedGoogleDriveExportPlanResponse = await server.inject({
  method: "POST",
  url: `/jobs/${manualRejectJobId}/google-drive-export-plan`
});

if (rejectedGoogleDriveExportPlanResponse.statusCode !== 409) {
  throw new Error(
    `Expected Google Drive export plan after manual rejection to return 409, got ${rejectedGoogleDriveExportPlanResponse.statusCode}.`
  );
}

const rejectedN8nWorkflowPlanResponse = await server.inject({
  method: "POST",
  url: `/jobs/${manualRejectJobId}/n8n-workflow-plan`
});

if (rejectedN8nWorkflowPlanResponse.statusCode !== 409) {
  throw new Error(
    `Expected n8n workflow plan after manual rejection to return 409, got ${rejectedN8nWorkflowPlanResponse.statusCode}.`
  );
}

const notRenderedReviewPackageResponse = await server.inject({
  method: "POST",
  url: "/jobs/smoke-arabic-prepare-001/review-package"
});

if (notRenderedReviewPackageResponse.statusCode !== 409) {
  throw new Error(
    `Expected review package for non-rendered job to return 409, got ${notRenderedReviewPackageResponse.statusCode}.`
  );
}

const notRenderedManualApprovalResponse = await server.inject({
  method: "POST",
  url: "/jobs/smoke-arabic-prepare-001/manual-review/approve"
});

if (notRenderedManualApprovalResponse.statusCode !== 409) {
  throw new Error(
    `Expected manual approval for non-rendered job to return 409, got ${notRenderedManualApprovalResponse.statusCode}.`
  );
}

const notRenderedManualRejectionResponse = await server.inject({
  method: "POST",
  url: "/jobs/smoke-arabic-prepare-001/manual-review/reject"
});

if (notRenderedManualRejectionResponse.statusCode !== 409) {
  throw new Error(
    `Expected manual rejection for non-rendered job to return 409, got ${notRenderedManualRejectionResponse.statusCode}.`
  );
}

const notRenderedPublishPackageResponse = await server.inject({
  method: "POST",
  url: "/jobs/smoke-arabic-prepare-001/publish-package"
});

if (notRenderedPublishPackageResponse.statusCode !== 409) {
  throw new Error(
    `Expected publish package for non-rendered job to return 409, got ${notRenderedPublishPackageResponse.statusCode}.`
  );
}

const notRenderedYouTubeUploadPlanResponse = await server.inject({
  method: "POST",
  url: "/jobs/smoke-arabic-prepare-001/youtube-upload-plan"
});

if (notRenderedYouTubeUploadPlanResponse.statusCode !== 409) {
  throw new Error(
    `Expected YouTube upload plan for non-rendered job to return 409, got ${notRenderedYouTubeUploadPlanResponse.statusCode}.`
  );
}

const notRenderedGoogleDriveExportPlanResponse = await server.inject({
  method: "POST",
  url: "/jobs/smoke-arabic-prepare-001/google-drive-export-plan"
});

if (notRenderedGoogleDriveExportPlanResponse.statusCode !== 409) {
  throw new Error(
    `Expected Google Drive export plan for non-rendered job to return 409, got ${notRenderedGoogleDriveExportPlanResponse.statusCode}.`
  );
}

const notRenderedN8nWorkflowPlanResponse = await server.inject({
  method: "POST",
  url: "/jobs/smoke-arabic-prepare-001/n8n-workflow-plan"
});

if (notRenderedN8nWorkflowPlanResponse.statusCode !== 409) {
  throw new Error(
    `Expected n8n workflow plan for non-rendered job to return 409, got ${notRenderedN8nWorkflowPlanResponse.statusCode}.`
  );
}

const missingOutputJobId = "smoke-arabic-output-missing-001";
const missingOutputJobDir = await createJobThroughRealHttpSenderReadiness(missingOutputJobId);
process.env.RAIZ_ENABLE_REAL_RENDER = "true";
const missingOutputSendResponse = await server.inject({
  method: "POST",
  url: `/jobs/${missingOutputJobId}/send-to-short-video-maker`
});
delete process.env.RAIZ_ENABLE_REAL_RENDER;

if (missingOutputSendResponse.statusCode !== 200) {
  throw new Error(`Expected missing-output job to reach rendering, got ${missingOutputSendResponse.statusCode}.`);
}

const missingOutputIngestionResponse = await server.inject({
  method: "POST",
  url: `/jobs/${missingOutputJobId}/ingest-output/short-video-maker`
});

if (missingOutputIngestionResponse.statusCode !== 200) {
  throw new Error(`Expected missing output ingestion to return report, got ${missingOutputIngestionResponse.statusCode}.`);
}

const missingOutputManifest = JSON.parse(missingOutputIngestionResponse.body) as ShortVideoMakerOutputManifestBody;
const missingOutputManifestPath = resolve(missingOutputJobDir, "output-manifest.json");

if (
  missingOutputManifest.status !== "failed" ||
  missingOutputManifest.final_video_path !== null ||
  !missingOutputManifest.errors?.some((error) => error.includes("Declared output file was not found.")) ||
  !existsSync(missingOutputManifestPath)
) {
  throw new Error("Expected missing output ingestion to write failed output manifest.");
}

const missingOutputStatusResponse = await server.inject({
  method: "GET",
  url: `/jobs/${missingOutputJobId}/status`
});
const missingOutputStatus = JSON.parse(missingOutputStatusResponse.body) as {
  status?: string;
  error?: string | null;
  metadata?: {
    output_manifest_path?: string;
    final_video_path?: string | null;
  };
};

if (
  missingOutputStatus.status !== "failed" ||
  !missingOutputStatus.error?.includes("Output ingestion failed") ||
  missingOutputStatus.metadata?.output_manifest_path !== missingOutputManifestPath ||
  missingOutputStatus.metadata.final_video_path !== null
) {
  throw new Error("Expected missing output ingestion to transition rendering -> failed with manifest metadata.");
}

const missingOutputEvents = readFileSync(resolve(missingOutputJobDir, "events.ndjson"), "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line) as { type?: string; from?: string; to?: string; adapter?: string });

if (
  !missingOutputEvents.some((event) => event.type === "job.status_changed" && event.from === "rendering" && event.to === "failed") ||
  !missingOutputEvents.some((event) => event.type === "job.output_ingestion_failed" && event.adapter === "short_video_maker")
) {
  throw new Error("Expected missing output ingestion to append failed transition and job.output_ingestion_failed event.");
}

const realSendFailureJobId = "smoke-arabic-real-send-failure-001";
const realSendFailureJobDir = await createJobThroughRealHttpSenderReadiness(realSendFailureJobId);
realHttpClientMode = "failure";
process.env.RAIZ_ENABLE_REAL_RENDER = "true";
const failedRealSendResponse = await server.inject({
  method: "POST",
  url: `/jobs/${realSendFailureJobId}/send-to-short-video-maker`
});
delete process.env.RAIZ_ENABLE_REAL_RENDER;
realHttpClientMode = "success";

if (failedRealSendResponse.statusCode !== 502) {
  throw new Error(`Expected failed real HTTP sender to return 502, got ${failedRealSendResponse.statusCode}.`);
}

const realSendFailureStatusResponse = await server.inject({
  method: "GET",
  url: `/jobs/${realSendFailureJobId}/status`
});
const realSendFailureStatus = JSON.parse(realSendFailureStatusResponse.body) as {
  status?: string;
  error?: string | null;
  metadata?: { short_video_maker_error_path?: string; real_http_send_failed?: boolean };
};
const realSendErrorPath = resolve(realSendFailureJobDir, "short-video-maker-error.json");

if (
  realSendFailureStatus.status !== "failed" ||
  !realSendFailureStatus.error?.includes("HTTP submit failed") ||
  realSendFailureStatus.metadata?.short_video_maker_error_path !== realSendErrorPath ||
  realSendFailureStatus.metadata.real_http_send_failed !== true ||
  !existsSync(realSendErrorPath)
) {
  throw new Error("Expected attempted real HTTP send failure to mark job failed and write error artifact.");
}

const mockRenderResponse = await server.inject({
  method: "POST",
  url: "/jobs/smoke-arabic-prepare-001/mock-render"
});

if (mockRenderResponse.statusCode !== 200) {
  throw new Error(`Expected mock render to complete after preflight, got ${mockRenderResponse.statusCode}.`);
}

const mockRenderStatus = JSON.parse(mockRenderResponse.body) as {
  status?: string;
  output_path?: string | null;
  metadata?: { mock_render?: boolean; render_completed_at?: string };
};
const mockOutputPath = resolve(prepareJobDir, "output", "smoke-arabic-prepare-001.mock-render.txt");

if (
  mockRenderStatus.status !== "rendered" ||
  mockRenderStatus.output_path !== mockOutputPath ||
  mockRenderStatus.metadata?.mock_render !== true ||
  !mockRenderStatus.metadata.render_completed_at
) {
  throw new Error("Expected mock render to return rendered status with output path and metadata.");
}

if (!existsSync(mockOutputPath)) {
  throw new Error("Expected mock render output artifact to be created.");
}

const mockRenderArtifactsResponse = await server.inject({
  method: "GET",
  url: "/jobs/smoke-arabic-prepare-001/artifacts"
});

if (mockRenderArtifactsResponse.statusCode !== 200) {
  throw new Error(`Expected artifacts endpoint to work after mock render, got ${mockRenderArtifactsResponse.statusCode}.`);
}

const mockRenderArtifacts = JSON.parse(mockRenderArtifactsResponse.body) as ArtifactInventoryBody;

if (
  mockRenderArtifacts.summary?.has_output !== true ||
  !mockRenderArtifacts.artifacts?.some(
    (artifact) =>
      artifact.name === "output/smoke-arabic-prepare-001.mock-render.txt" &&
      artifact.type === "output_file" &&
      artifact.exists
  )
) {
  throw new Error("Expected artifacts endpoint to detect mock output artifact after mock render.");
}

const mockOutput = readFileSync(mockOutputPath, "utf8");

if (
  !mockOutput.includes("job_id: smoke-arabic-prepare-001") ||
  !mockOutput.includes("width: 1080") ||
  !mockOutput.includes("height: 1920") ||
  !mockOutput.includes("This is a mock render artifact. No video was generated.")
) {
  throw new Error("Expected mock render artifact to contain deterministic render details.");
}

const mockRenderEvents = readFileSync(resolve(prepareJobDir, "events.ndjson"), "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line) as { type?: string; from?: string; to?: string });

if (
  !mockRenderEvents.some((event) => event.type === "job.status_changed" && event.from === "preparing" && event.to === "rendering") ||
  !mockRenderEvents.some((event) => event.type === "job.status_changed" && event.from === "rendering" && event.to === "rendered") ||
  !mockRenderEvents.some((event) => event.type === "job.mock_render_started") ||
  !mockRenderEvents.some((event) => event.type === "job.mock_render_completed")
) {
  throw new Error("Expected mock render to record rendering/rendered transitions and events.");
}

const queuedPreflightJob = {
  ...sampleJob,
  job_id: "smoke-arabic-preflight-queued-001",
  output: {
    ...(sampleJob.output as Record<string, unknown>),
    filename: "smoke-arabic-preflight-queued-001.mp4"
  }
};

const queuedPreflightRenderResponse = await server.inject({
  method: "POST",
  url: "/jobs/render",
  payload: queuedPreflightJob
});

if (queuedPreflightRenderResponse.statusCode !== 202) {
  throw new Error(`Expected queued preflight test job to queue, got ${queuedPreflightRenderResponse.statusCode}.`);
}

const queuedPreflightResponse = await server.inject({
  method: "POST",
  url: "/jobs/smoke-arabic-preflight-queued-001/preflight"
});

if (queuedPreflightResponse.statusCode !== 409) {
  throw new Error(`Expected preflight for queued job to return 409, got ${queuedPreflightResponse.statusCode}.`);
}

const warningOnlyPreflightJob = {
  ...sampleJob,
  job_id: "smoke-arabic-preflight-warnings-001",
  voice: {
    type: "external_file",
    provider: "external_file",
    voice_name: "local-voice-test",
    file_path: resolve(storageRoot, "missing-voice.wav")
  },
  assets: {
    broll_source: "local",
    broll_folder: resolve(storageRoot, "missing-broll"),
    music: resolve(storageRoot, "missing-music.mp3")
  },
  output: {
    ...(sampleJob.output as Record<string, unknown>),
    filename: "smoke-arabic-preflight-warnings-001.mp4"
  }
};

const warningOnlyRenderResponse = await server.inject({
  method: "POST",
  url: "/jobs/render",
  payload: warningOnlyPreflightJob
});

if (warningOnlyRenderResponse.statusCode !== 202) {
  throw new Error(`Expected warning-only preflight job to queue, got ${warningOnlyRenderResponse.statusCode}.`);
}

const warningOnlyPrepareResponse = await server.inject({
  method: "POST",
  url: "/jobs/smoke-arabic-preflight-warnings-001/prepare"
});

if (warningOnlyPrepareResponse.statusCode !== 200) {
  throw new Error(`Expected warning-only preflight job to prepare, got ${warningOnlyPrepareResponse.statusCode}.`);
}

const warningOnlyPreflightResponse = await server.inject({
  method: "POST",
  url: "/jobs/smoke-arabic-preflight-warnings-001/preflight"
});

if (warningOnlyPreflightResponse.statusCode !== 200) {
  throw new Error(`Expected warning-only preflight to return 200, got ${warningOnlyPreflightResponse.statusCode}.`);
}

const warningOnlyReport = JSON.parse(warningOnlyPreflightResponse.body) as {
  status?: string;
  warnings?: string[];
  checks?: Array<{ name?: string; passed?: boolean; severity?: string }>;
};
const warningOnlyWarnings = warningOnlyReport.warnings ?? [];
const warningOnlyChecks = warningOnlyReport.checks ?? [];

if (
  warningOnlyReport.status !== "passed" ||
  !warningOnlyWarnings.includes("Local voice file is declared but was not found.") ||
  !warningOnlyWarnings.includes("Local b-roll folder is declared but was not found.") ||
  !warningOnlyWarnings.includes("Local music file is declared but was not found.") ||
  !warningOnlyChecks.some((check) => check.name === "local_voice_file_exists" && !check.passed && check.severity === "warning") ||
  !warningOnlyChecks.some((check) => check.name === "local_broll_folder_exists" && !check.passed && check.severity === "warning") ||
  !warningOnlyChecks.some((check) => check.name === "local_music_file_exists" && !check.passed && check.severity === "warning")
) {
  throw new Error("Expected missing local voice, b-roll, and music paths to produce warning-only preflight pass.");
}

const warningOnlyJobDir = resolve(storageRoot, "jobs", "smoke-arabic-preflight-warnings-001");

if (!existsSync(resolve(warningOnlyJobDir, "preflight-report.json"))) {
  throw new Error("Expected warning-only preflight to write preflight-report.json.");
}

const savedWarningOnlyReport = JSON.parse(readFileSync(resolve(warningOnlyJobDir, "preflight-report.json"), "utf8")) as {
  warnings?: string[];
};

if (!savedWarningOnlyReport.warnings || savedWarningOnlyReport.warnings.length < 3) {
  throw new Error("Expected warning-only preflight-report.json to include warnings array.");
}

const warningOnlyStatusResponse = await server.inject({
  method: "GET",
  url: "/jobs/smoke-arabic-preflight-warnings-001/status"
});
const warningOnlyStatus = JSON.parse(warningOnlyStatusResponse.body) as {
  status?: string;
  metadata?: { preflight_status?: string };
};

if (warningOnlyStatus.status !== "preparing" || warningOnlyStatus.metadata?.preflight_status !== "passed") {
  throw new Error("Expected warning-only preflight to keep job preparing with passed metadata.");
}

const mockBeforePreflightJob = {
  ...sampleJob,
  job_id: "smoke-arabic-mock-before-preflight-001",
  output: {
    ...(sampleJob.output as Record<string, unknown>),
    filename: "smoke-arabic-mock-before-preflight-001.mp4"
  }
};

const mockBeforePreflightRenderResponse = await server.inject({
  method: "POST",
  url: "/jobs/render",
  payload: mockBeforePreflightJob
});

if (mockBeforePreflightRenderResponse.statusCode !== 202) {
  throw new Error(`Expected mock-before-preflight job to queue, got ${mockBeforePreflightRenderResponse.statusCode}.`);
}

const mockBeforePreflightPrepareResponse = await server.inject({
  method: "POST",
  url: "/jobs/smoke-arabic-mock-before-preflight-001/prepare"
});

if (mockBeforePreflightPrepareResponse.statusCode !== 200) {
  throw new Error(`Expected mock-before-preflight job to prepare, got ${mockBeforePreflightPrepareResponse.statusCode}.`);
}

const payloadBeforePreflightResponse = await server.inject({
  method: "POST",
  url: "/jobs/smoke-arabic-mock-before-preflight-001/adapter-payload/short-video-maker"
});

if (payloadBeforePreflightResponse.statusCode !== 409) {
  throw new Error(`Expected adapter payload before preflight to return 409, got ${payloadBeforePreflightResponse.statusCode}.`);
}

const mockBeforePreflightResponse = await server.inject({
  method: "POST",
  url: "/jobs/smoke-arabic-mock-before-preflight-001/mock-render"
});

if (mockBeforePreflightResponse.statusCode !== 409) {
  throw new Error(`Expected mock render before preflight to return 409, got ${mockBeforePreflightResponse.statusCode}.`);
}

const dryRunBeforeReadinessResponse = await server.inject({
  method: "POST",
  url: "/jobs/smoke-arabic-mock-before-preflight-001/adapter-dry-run/short-video-maker"
});

if (dryRunBeforeReadinessResponse.statusCode !== 409) {
  throw new Error(`Expected dry-run request before readiness to return 409, got ${dryRunBeforeReadinessResponse.statusCode}.`);
}

const httpSendPlanBeforeDryRunResponse = await server.inject({
  method: "POST",
  url: "/jobs/smoke-arabic-mock-before-preflight-001/http-send-plan/short-video-maker"
});

if (httpSendPlanBeforeDryRunResponse.statusCode !== 409) {
  throw new Error(`Expected HTTP send plan before dry-run request to return 409, got ${httpSendPlanBeforeDryRunResponse.statusCode}.`);
}

const httpMockSendBeforePlanResponse = await server.inject({
  method: "POST",
  url: "/jobs/smoke-arabic-mock-before-preflight-001/http-send-mock/short-video-maker"
});

if (httpMockSendBeforePlanResponse.statusCode !== 409) {
  throw new Error(`Expected mocked HTTP send before HTTP plan to return 409, got ${httpMockSendBeforePlanResponse.statusCode}.`);
}

const realReadinessMissingMockJobId = "smoke-arabic-real-readiness-missing-mock-001";
const realReadinessMissingMockDir = await createJobThroughHttpPlan(realReadinessMissingMockJobId);
const realReadinessMissingMockResponse = await server.inject({
  method: "POST",
  url: `/jobs/${realReadinessMissingMockJobId}/real-http-sender-readiness`
});

if (realReadinessMissingMockResponse.statusCode !== 200) {
  throw new Error(
    `Expected missing mock response readiness to return report, got ${realReadinessMissingMockResponse.statusCode}.`
  );
}

const realReadinessMissingMock = JSON.parse(realReadinessMissingMockResponse.body) as RealHttpSenderReadinessBody;

if (
  realReadinessMissingMock.status !== "failed" ||
  realReadinessMissingMock.ready_for_real_http_sender !== false ||
  !realReadinessMissingMock.checks?.some((check) => check.name === "mock_response_exists" && !check.passed)
) {
  throw new Error("Expected real HTTP sender readiness to fail when mock response is missing.");
}

const realReadinessMissingMockStatusResponse = await server.inject({
  method: "GET",
  url: `/jobs/${realReadinessMissingMockJobId}/status`
});
const realReadinessMissingMockStatus = JSON.parse(realReadinessMissingMockStatusResponse.body) as {
  status?: string;
  metadata?: { real_http_sender_readiness_status?: string; ready_for_real_http_sender?: boolean };
};

if (
  realReadinessMissingMockStatus.status !== "preparing" ||
  realReadinessMissingMockStatus.metadata?.real_http_sender_readiness_status !== "failed" ||
  realReadinessMissingMockStatus.metadata.ready_for_real_http_sender !== false ||
  !existsSync(resolve(realReadinessMissingMockDir, "real-http-sender-readiness.json"))
) {
  throw new Error("Expected failed real HTTP sender readiness to keep status preparing and write failed metadata.");
}

const realReadinessMissingMockEvents = readFileSync(resolve(realReadinessMissingMockDir, "events.ndjson"), "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line) as { type?: string });

if (!realReadinessMissingMockEvents.some((event) => event.type === "job.real_http_sender_readiness_failed")) {
  throw new Error("Expected missing mock response readiness to append failed event.");
}

const realReadinessMissingPlanJobId = "smoke-arabic-real-readiness-missing-plan-001";
await createJobThroughDryRun(realReadinessMissingPlanJobId);
const realReadinessMissingPlanResponse = await server.inject({
  method: "POST",
  url: `/jobs/${realReadinessMissingPlanJobId}/real-http-sender-readiness`
});

if (realReadinessMissingPlanResponse.statusCode !== 200) {
  throw new Error(
    `Expected missing HTTP plan readiness to return report, got ${realReadinessMissingPlanResponse.statusCode}.`
  );
}

const realReadinessMissingPlan = JSON.parse(realReadinessMissingPlanResponse.body) as RealHttpSenderReadinessBody;

if (
  realReadinessMissingPlan.status !== "failed" ||
  realReadinessMissingPlan.ready_for_real_http_sender !== false ||
  !realReadinessMissingPlan.checks?.some((check) => check.name === "http_send_plan_exists" && !check.passed)
) {
  throw new Error("Expected real HTTP sender readiness to fail when HTTP send plan is missing.");
}

const realReadinessNotPreparingResponse = await server.inject({
  method: "POST",
  url: `/jobs/${sampleJob.job_id}/real-http-sender-readiness`
});

if (realReadinessNotPreparingResponse.statusCode !== 409) {
  throw new Error(`Expected real HTTP sender readiness for non-preparing job to return 409, got ${realReadinessNotPreparingResponse.statusCode}.`);
}

const readinessMissingHealthJob = {
  ...sampleJob,
  job_id: "smoke-arabic-readiness-missing-health-001",
  output: {
    ...(sampleJob.output as Record<string, unknown>),
    filename: "smoke-arabic-readiness-missing-health-001.mp4"
  }
};

const readinessMissingHealthRenderResponse = await server.inject({
  method: "POST",
  url: "/jobs/render",
  payload: readinessMissingHealthJob
});

if (readinessMissingHealthRenderResponse.statusCode !== 202) {
  throw new Error(`Expected missing-health readiness job to queue, got ${readinessMissingHealthRenderResponse.statusCode}.`);
}

await server.inject({
  method: "POST",
  url: "/jobs/smoke-arabic-readiness-missing-health-001/prepare"
});

await server.inject({
  method: "POST",
  url: "/jobs/smoke-arabic-readiness-missing-health-001/preflight"
});

await server.inject({
  method: "POST",
  url: "/jobs/smoke-arabic-readiness-missing-health-001/adapter-payload/short-video-maker"
});

const readinessMissingHealthResponse = await server.inject({
  method: "POST",
  url: "/jobs/smoke-arabic-readiness-missing-health-001/readiness-review"
});

if (readinessMissingHealthResponse.statusCode !== 200) {
  throw new Error(`Expected missing adapter health readiness review to return report, got ${readinessMissingHealthResponse.statusCode}.`);
}

const readinessMissingHealthReview = JSON.parse(readinessMissingHealthResponse.body) as ReadinessReviewBody;

if (
  readinessMissingHealthReview.status !== "failed" ||
  readinessMissingHealthReview.ready_for_dry_run !== false ||
  !readinessMissingHealthReview.checks?.some((check) => check.name === "adapter_health_report_exists" && !check.passed)
) {
  throw new Error("Expected readiness to fail when adapter health report is missing.");
}

const readinessMissingHealthDir = resolve(storageRoot, "jobs", "smoke-arabic-readiness-missing-health-001");
const readinessMissingHealthStatusResponse = await server.inject({
  method: "GET",
  url: "/jobs/smoke-arabic-readiness-missing-health-001/status"
});
const readinessMissingHealthStatus = JSON.parse(readinessMissingHealthStatusResponse.body) as {
  status?: string;
  metadata?: { readiness_status?: string; ready_for_dry_run?: boolean };
};

if (
  readinessMissingHealthStatus.status !== "preparing" ||
  readinessMissingHealthStatus.metadata?.readiness_status !== "failed" ||
  readinessMissingHealthStatus.metadata.ready_for_dry_run !== false
) {
  throw new Error("Expected failed readiness to keep status preparing and update failed readiness metadata.");
}

const readinessMissingHealthEvents = readFileSync(resolve(readinessMissingHealthDir, "events.ndjson"), "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line) as { type?: string });

if (!readinessMissingHealthEvents.some((event) => event.type === "job.readiness_failed")) {
  throw new Error("Expected failed readiness to append job.readiness_failed event.");
}

const readinessMissingPayloadJob = {
  ...sampleJob,
  job_id: "smoke-arabic-readiness-missing-payload-001",
  output: {
    ...(sampleJob.output as Record<string, unknown>),
    filename: "smoke-arabic-readiness-missing-payload-001.mp4"
  }
};

const readinessMissingPayloadRenderResponse = await server.inject({
  method: "POST",
  url: "/jobs/render",
  payload: readinessMissingPayloadJob
});

if (readinessMissingPayloadRenderResponse.statusCode !== 202) {
  throw new Error(`Expected missing-payload readiness job to queue, got ${readinessMissingPayloadRenderResponse.statusCode}.`);
}

await server.inject({
  method: "POST",
  url: "/jobs/smoke-arabic-readiness-missing-payload-001/prepare"
});

await server.inject({
  method: "POST",
  url: "/jobs/smoke-arabic-readiness-missing-payload-001/preflight"
});

await server.inject({
  method: "POST",
  url: "/jobs/smoke-arabic-readiness-missing-payload-001/adapter-health"
});

const readinessMissingPayloadResponse = await server.inject({
  method: "POST",
  url: "/jobs/smoke-arabic-readiness-missing-payload-001/readiness-review"
});

if (readinessMissingPayloadResponse.statusCode !== 200) {
  throw new Error(`Expected missing payload readiness review to return report, got ${readinessMissingPayloadResponse.statusCode}.`);
}

const readinessMissingPayloadReview = JSON.parse(readinessMissingPayloadResponse.body) as ReadinessReviewBody;

if (
  readinessMissingPayloadReview.status !== "failed" ||
  readinessMissingPayloadReview.ready_for_dry_run !== false ||
  !readinessMissingPayloadReview.checks?.some((check) => check.name === "short_video_maker_payload_exists" && !check.passed)
) {
  throw new Error("Expected readiness to fail when short-video-maker payload is missing.");
}

const readinessBrokenPayloadJob = {
  ...sampleJob,
  job_id: "smoke-arabic-readiness-broken-payload-001",
  output: {
    ...(sampleJob.output as Record<string, unknown>),
    filename: "smoke-arabic-readiness-broken-payload-001.mp4"
  }
};

const readinessBrokenPayloadRenderResponse = await server.inject({
  method: "POST",
  url: "/jobs/render",
  payload: readinessBrokenPayloadJob
});

if (readinessBrokenPayloadRenderResponse.statusCode !== 202) {
  throw new Error(`Expected broken-payload readiness job to queue, got ${readinessBrokenPayloadRenderResponse.statusCode}.`);
}

await server.inject({
  method: "POST",
  url: "/jobs/smoke-arabic-readiness-broken-payload-001/prepare"
});

await server.inject({
  method: "POST",
  url: "/jobs/smoke-arabic-readiness-broken-payload-001/preflight"
});

await server.inject({
  method: "POST",
  url: "/jobs/smoke-arabic-readiness-broken-payload-001/adapter-health"
});

await server.inject({
  method: "POST",
  url: "/jobs/smoke-arabic-readiness-broken-payload-001/adapter-payload/short-video-maker"
});

const readinessBrokenPayloadDir = resolve(storageRoot, "jobs", "smoke-arabic-readiness-broken-payload-001");
const readinessBrokenPayloadPath = resolve(readinessBrokenPayloadDir, "short-video-maker-payload.json");
const readinessBrokenPayload = JSON.parse(readFileSync(readinessBrokenPayloadPath, "utf8")) as {
  composition?: Record<string, unknown>;
};
writeFileSync(
  readinessBrokenPayloadPath,
  `${JSON.stringify(
    {
      ...readinessBrokenPayload,
      composition: {
        ...(readinessBrokenPayload.composition ?? {}),
        direction: "ltr"
      }
    },
    null,
    2
  )}\n`
);

const readinessBrokenPayloadResponse = await server.inject({
  method: "POST",
  url: "/jobs/smoke-arabic-readiness-broken-payload-001/readiness-review"
});

if (readinessBrokenPayloadResponse.statusCode !== 200) {
  throw new Error(`Expected broken payload readiness review to return report, got ${readinessBrokenPayloadResponse.statusCode}.`);
}

const readinessBrokenPayloadReview = JSON.parse(readinessBrokenPayloadResponse.body) as ReadinessReviewBody;

if (
  readinessBrokenPayloadReview.status !== "failed" ||
  readinessBrokenPayloadReview.ready_for_dry_run !== false ||
  !readinessBrokenPayloadReview.checks?.some((check) => check.name === "payload_direction" && !check.passed)
) {
  throw new Error("Expected readiness to fail when payload direction is not RTL.");
}

const readinessRenderedResponse = await server.inject({
  method: "POST",
  url: `/jobs/${sampleJob.job_id}/readiness-review`
});

if (readinessRenderedResponse.statusCode !== 409) {
  throw new Error(`Expected readiness review for non-preparing job to return 409, got ${readinessRenderedResponse.statusCode}.`);
}

const brokenPreflightJob = {
  ...sampleJob,
  job_id: "smoke-arabic-preflight-broken-001",
  output: {
    ...(sampleJob.output as Record<string, unknown>),
    filename: "smoke-arabic-preflight-broken-001.mp4"
  }
};

const brokenPreflightRenderResponse = await server.inject({
  method: "POST",
  url: "/jobs/render",
  payload: brokenPreflightJob
});

if (brokenPreflightRenderResponse.statusCode !== 202) {
  throw new Error(`Expected broken preflight job to queue, got ${brokenPreflightRenderResponse.statusCode}.`);
}

const brokenPrepareResponse = await server.inject({
  method: "POST",
  url: "/jobs/smoke-arabic-preflight-broken-001/prepare"
});

if (brokenPrepareResponse.statusCode !== 200) {
  throw new Error(`Expected broken preflight job to prepare, got ${brokenPrepareResponse.statusCode}.`);
}

const brokenJobDir = resolve(storageRoot, "jobs", "smoke-arabic-preflight-broken-001");
const brokenRenderPlan = JSON.parse(readFileSync(resolve(brokenJobDir, "render-plan.json"), "utf8")) as Record<
  string,
  unknown
>;
writeFileSync(resolve(brokenJobDir, "render-plan.json"), `${JSON.stringify({ ...brokenRenderPlan, direction: "ltr" }, null, 2)}\n`);

const brokenPreflightResponse = await server.inject({
  method: "POST",
  url: "/jobs/smoke-arabic-preflight-broken-001/preflight"
});

if (brokenPreflightResponse.statusCode !== 200) {
  throw new Error(`Expected broken preflight to return report, got ${brokenPreflightResponse.statusCode}.`);
}

const brokenPreflightReport = JSON.parse(brokenPreflightResponse.body) as {
  status?: string;
  checks?: Array<{ name?: string; passed?: boolean }>;
};

if (
  brokenPreflightReport.status !== "failed" ||
  !brokenPreflightReport.checks?.some((check) => check.name === "arabic_direction" && !check.passed)
) {
  throw new Error("Expected non-RTL render plan to fail preflight.");
}

const brokenStatusResponse = await server.inject({
  method: "GET",
  url: "/jobs/smoke-arabic-preflight-broken-001/status"
});
const brokenStatus = JSON.parse(brokenStatusResponse.body) as { status?: string; error?: string | null };

if (brokenStatus.status !== "failed" || !brokenStatus.error?.includes("Direction is RTL.")) {
  throw new Error("Expected failed preflight to move job from preparing to failed with error summary.");
}

const brokenEvents = readFileSync(resolve(brokenJobDir, "events.ndjson"), "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line) as { type?: string; from?: string; to?: string });

if (
  !brokenEvents.some((event) => event.type === "job.status_changed" && event.from === "preparing" && event.to === "failed") ||
  !brokenEvents.some((event) => event.type === "job.preflight_failed")
) {
  throw new Error("Expected failed preflight to use preparing -> failed transition and append event.");
}

const unknownPrepareResponse = await server.inject({
  method: "POST",
  url: "/jobs/unknown-job/prepare"
});

if (unknownPrepareResponse.statusCode !== 404) {
  throw new Error(`Expected unknown job prepare to return 404, got ${unknownPrepareResponse.statusCode}.`);
}

const unknownPreflightResponse = await server.inject({
  method: "POST",
  url: "/jobs/unknown-job/preflight"
});

if (unknownPreflightResponse.statusCode !== 404) {
  throw new Error(`Expected unknown job preflight to return 404, got ${unknownPreflightResponse.statusCode}.`);
}

const unknownMockRenderResponse = await server.inject({
  method: "POST",
  url: "/jobs/unknown-job/mock-render"
});

if (unknownMockRenderResponse.statusCode !== 404) {
  throw new Error(`Expected unknown job mock render to return 404, got ${unknownMockRenderResponse.statusCode}.`);
}

const unknownAdapterPayloadResponse = await server.inject({
  method: "POST",
  url: "/jobs/unknown-job/adapter-payload/short-video-maker"
});

if (unknownAdapterPayloadResponse.statusCode !== 404) {
  throw new Error(`Expected unknown job adapter payload to return 404, got ${unknownAdapterPayloadResponse.statusCode}.`);
}

const unknownReadinessResponse = await server.inject({
  method: "POST",
  url: "/jobs/unknown-job/readiness-review"
});

if (unknownReadinessResponse.statusCode !== 404) {
  throw new Error(`Expected unknown job readiness review to return 404, got ${unknownReadinessResponse.statusCode}.`);
}

const unknownDryRunResponse = await server.inject({
  method: "POST",
  url: "/jobs/unknown-job/adapter-dry-run/short-video-maker"
});

if (unknownDryRunResponse.statusCode !== 404) {
  throw new Error(`Expected unknown job dry-run request to return 404, got ${unknownDryRunResponse.statusCode}.`);
}

const unknownHttpSendPlanResponse = await server.inject({
  method: "POST",
  url: "/jobs/unknown-job/http-send-plan/short-video-maker"
});

if (unknownHttpSendPlanResponse.statusCode !== 404) {
  throw new Error(`Expected unknown job HTTP send plan to return 404, got ${unknownHttpSendPlanResponse.statusCode}.`);
}

const unknownHttpMockSendResponse = await server.inject({
  method: "POST",
  url: "/jobs/unknown-job/http-send-mock/short-video-maker"
});

if (unknownHttpMockSendResponse.statusCode !== 404) {
  throw new Error(`Expected unknown job mocked HTTP send to return 404, got ${unknownHttpMockSendResponse.statusCode}.`);
}

const unknownRealHttpReadinessResponse = await server.inject({
  method: "POST",
  url: "/jobs/unknown-job/real-http-sender-readiness"
});

if (unknownRealHttpReadinessResponse.statusCode !== 404) {
  throw new Error(`Expected unknown job real HTTP sender readiness to return 404, got ${unknownRealHttpReadinessResponse.statusCode}.`);
}

const unknownSenderResponse = await server.inject({
  method: "POST",
  url: "/jobs/unknown-job/send-to-short-video-maker"
});

if (unknownSenderResponse.statusCode !== 404) {
  throw new Error(`Expected unknown job sender to return 404, got ${unknownSenderResponse.statusCode}.`);
}

const unknownOutputIngestionResponse = await server.inject({
  method: "POST",
  url: "/jobs/unknown-job/ingest-output/short-video-maker"
});

if (unknownOutputIngestionResponse.statusCode !== 404) {
  throw new Error(`Expected unknown job output ingestion to return 404, got ${unknownOutputIngestionResponse.statusCode}.`);
}

const unknownReviewPackageResponse = await server.inject({
  method: "POST",
  url: "/jobs/unknown-job/review-package"
});

if (unknownReviewPackageResponse.statusCode !== 404) {
  throw new Error(`Expected unknown job review package to return 404, got ${unknownReviewPackageResponse.statusCode}.`);
}

const unknownManualApprovalResponse = await server.inject({
  method: "POST",
  url: "/jobs/unknown-job/manual-review/approve"
});

if (unknownManualApprovalResponse.statusCode !== 404) {
  throw new Error(`Expected unknown job manual approval to return 404, got ${unknownManualApprovalResponse.statusCode}.`);
}

const unknownManualRejectionResponse = await server.inject({
  method: "POST",
  url: "/jobs/unknown-job/manual-review/reject"
});

if (unknownManualRejectionResponse.statusCode !== 404) {
  throw new Error(`Expected unknown job manual rejection to return 404, got ${unknownManualRejectionResponse.statusCode}.`);
}

const unknownPublishPackageResponse = await server.inject({
  method: "POST",
  url: "/jobs/unknown-job/publish-package"
});

if (unknownPublishPackageResponse.statusCode !== 404) {
  throw new Error(`Expected unknown job publish package to return 404, got ${unknownPublishPackageResponse.statusCode}.`);
}

const unknownYouTubeUploadPlanResponse = await server.inject({
  method: "POST",
  url: "/jobs/unknown-job/youtube-upload-plan"
});

if (unknownYouTubeUploadPlanResponse.statusCode !== 404) {
  throw new Error(`Expected unknown job YouTube upload plan to return 404, got ${unknownYouTubeUploadPlanResponse.statusCode}.`);
}

const unknownGoogleDriveExportPlanResponse = await server.inject({
  method: "POST",
  url: "/jobs/unknown-job/google-drive-export-plan"
});

if (unknownGoogleDriveExportPlanResponse.statusCode !== 404) {
  throw new Error(`Expected unknown job Google Drive export plan to return 404, got ${unknownGoogleDriveExportPlanResponse.statusCode}.`);
}

const unknownN8nWorkflowPlanResponse = await server.inject({
  method: "POST",
  url: "/jobs/unknown-job/n8n-workflow-plan"
});

if (unknownN8nWorkflowPlanResponse.statusCode !== 404) {
  throw new Error(`Expected unknown job n8n workflow plan to return 404, got ${unknownN8nWorkflowPlanResponse.statusCode}.`);
}

const adapterHealthJob = {
  ...sampleJob,
  job_id: "smoke-arabic-adapter-health-001",
  output: {
    ...(sampleJob.output as Record<string, unknown>),
    filename: "smoke-arabic-adapter-health-001.mp4"
  }
};

const adapterHealthRenderResponse = await server.inject({
  method: "POST",
  url: "/jobs/render",
  payload: adapterHealthJob
});

if (adapterHealthRenderResponse.statusCode !== 202) {
  throw new Error(`Expected adapter-health job to queue, got ${adapterHealthRenderResponse.statusCode}.`);
}

const adapterHealthJobStatusBefore = await server.inject({
  method: "GET",
  url: "/jobs/smoke-arabic-adapter-health-001/status"
});
const adapterHealthJobStatusBeforeBody = JSON.parse(adapterHealthJobStatusBefore.body) as { status?: string };

const jobAdapterHealthResponse = await server.inject({
  method: "POST",
  url: "/jobs/smoke-arabic-adapter-health-001/adapter-health"
});

if (jobAdapterHealthResponse.statusCode !== 200) {
  throw new Error(`Expected job adapter-health endpoint to return 200, got ${jobAdapterHealthResponse.statusCode}.`);
}

const adapterHealthJobDir = resolve(storageRoot, "jobs", "smoke-arabic-adapter-health-001");
const adapterHealthReportPath = resolve(adapterHealthJobDir, "adapter-health.short-video-maker.json");

if (!existsSync(adapterHealthReportPath)) {
  throw new Error("Expected job adapter-health endpoint to write adapter health report file.");
}

const savedAdapterHealthReport = JSON.parse(readFileSync(adapterHealthReportPath, "utf8")) as {
  adapter?: string;
  status?: string;
};

if (savedAdapterHealthReport.adapter !== "short_video_maker" || !savedAdapterHealthReport.status) {
  throw new Error("Expected saved adapter health report to include adapter status.");
}

const adapterHealthEvents = readFileSync(resolve(adapterHealthJobDir, "events.ndjson"), "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line) as { type?: string; adapter?: string });

if (!adapterHealthEvents.some((event) => event.type === "job.adapter_health_checked" && event.adapter === "short_video_maker")) {
  throw new Error("Expected job adapter-health endpoint to append adapter health event.");
}

const adapterHealthJobStatusAfter = await server.inject({
  method: "GET",
  url: "/jobs/smoke-arabic-adapter-health-001/status"
});
const adapterHealthJobStatusAfterBody = JSON.parse(adapterHealthJobStatusAfter.body) as { status?: string };

if (
  adapterHealthJobStatusBeforeBody.status !== "queued" ||
  adapterHealthJobStatusAfterBody.status !== adapterHealthJobStatusBeforeBody.status
) {
  throw new Error("Expected job adapter-health endpoint to leave job status unchanged.");
}

const unknownStatusResponse = await server.inject({
  method: "GET",
  url: "/jobs/unknown-job/status"
});

if (unknownStatusResponse.statusCode !== 404) {
  throw new Error(`Expected unknown job status to return 404, got ${unknownStatusResponse.statusCode}.`);
}

const unknownArtifactsResponse = await server.inject({
  method: "GET",
  url: "/jobs/unknown-job/artifacts"
});

if (unknownArtifactsResponse.statusCode !== 404) {
  throw new Error(`Expected unknown job artifacts to return 404, got ${unknownArtifactsResponse.statusCode}.`);
}

const unknownPatchResponse = await server.inject({
  method: "PATCH",
  url: "/jobs/unknown-job/status",
  payload: {
    status: "preparing"
  }
});

if (unknownPatchResponse.statusCode !== 404) {
  throw new Error(`Expected unknown job transition to return 404, got ${unknownPatchResponse.statusCode}.`);
}

// --- M1: /health and /engines ----------------------------------------------
const healthResponse = await server.inject({ method: "GET", url: "/health" });

if (healthResponse.statusCode !== 200) {
  throw new Error(`Expected /health to return 200, got ${healthResponse.statusCode}.`);
}

const healthBody = JSON.parse(healthResponse.body) as { status?: string; service?: string };

if (healthBody.status !== "ok" || healthBody.service !== "raiz-orchestrator") {
  throw new Error("Expected /health to report ok status for raiz-orchestrator.");
}

const enginesResponse = await server.inject({ method: "GET", url: "/engines" });

if (enginesResponse.statusCode !== 200) {
  throw new Error(`Expected /engines to return 200, got ${enginesResponse.statusCode}.`);
}

const enginesBody = JSON.parse(enginesResponse.body) as {
  default_engine?: string;
  engines?: Array<{ id?: string; status?: string }>;
};

if (
  enginesBody.default_engine !== "remotion_direct" ||
  !enginesBody.engines?.some((engine) => engine.id === "remotion_direct" && engine.status === "available")
) {
  throw new Error("Expected /engines to list remotion_direct as the available default engine.");
}

if (!enginesBody.engines?.some((engine) => engine.id === "short_video_maker" && engine.status === "available")) {
  throw new Error("Expected /engines to keep short_video_maker available as the optional English path.");
}

// --- H1: voice preflight is conditional on voice.type ----------------------
const prepareAndPreflight = async (jobId: string, voice: unknown): Promise<string> => {
  const job = {
    ...sampleJob,
    job_id: jobId,
    voice,
    output: { ...(sampleJob.output as Record<string, unknown>), filename: `${jobId}.mp4` }
  };
  const renderResponse = await server.inject({ method: "POST", url: "/jobs/render", payload: job });

  if (renderResponse.statusCode !== 202) {
    throw new Error(`Expected ${jobId} to queue, got ${renderResponse.statusCode}.`);
  }

  const prepareResponse = await server.inject({ method: "POST", url: `/jobs/${jobId}/prepare` });

  if (prepareResponse.statusCode !== 200) {
    throw new Error(`Expected ${jobId} to prepare, got ${prepareResponse.statusCode}.`);
  }

  const preflightResponse = await server.inject({ method: "POST", url: `/jobs/${jobId}/preflight` });

  if (preflightResponse.statusCode !== 200) {
    throw new Error(`Expected ${jobId} preflight to return 200, got ${preflightResponse.statusCode}.`);
  }

  return preflightResponse.body;
};

const externalVoiceReport = JSON.parse(
  await prepareAndPreflight("voice-external-file-001", {
    type: "external_file",
    file_path: resolve(storageRoot, "missing-external-voice.wav")
  })
) as { status?: string; checks?: Array<{ name?: string; severity?: string; passed?: boolean }> };

if (externalVoiceReport.status !== "passed") {
  throw new Error("Expected external_file voice without provider/voice_name to pass preflight.");
}

if (externalVoiceReport.checks?.some((check) => check.name === "voice_provider_exists")) {
  throw new Error("Expected external_file voice to skip the TTS provider requirement.");
}

if (!externalVoiceReport.checks?.some((check) => check.name === "voice_file_path_declared" && check.passed)) {
  throw new Error("Expected external_file voice to require a declared file path.");
}

const noneVoiceReport = JSON.parse(await prepareAndPreflight("voice-none-001", { type: "none" })) as {
  status?: string;
};

if (noneVoiceReport.status !== "passed") {
  throw new Error("Expected voice type none to pass preflight without narration fields.");
}

const ttsMissingReport = JSON.parse(await prepareAndPreflight("voice-tts-missing-001", { type: "edge_tts" })) as {
  status?: string;
};

if (ttsMissingReport.status !== "failed") {
  throw new Error("Expected edge_tts without provider/voice_name to fail preflight.");
}

const edgeTtsWarningReport = JSON.parse(
  await prepareAndPreflight("voice-edge-tts-warning-001", {
    type: "edge_tts",
    provider: "edge",
    voice_name: "ar-SA-HamedNeural"
  })
) as {
  status?: string;
  warnings?: string[];
  checks?: Array<{ name?: string; severity?: string; passed?: boolean; message?: string }>;
};

if (edgeTtsWarningReport.status !== "passed") {
  throw new Error("Expected edge_tts with provider and voice_name to pass preflight.");
}

if (
  !edgeTtsWarningReport.warnings?.some((warning) =>
    warning.includes("schema-supported but not implemented in local render v1")
  ) ||
  !edgeTtsWarningReport.checks?.some(
    (check) =>
      check.name === "voice_provider_not_implemented_locally" &&
      check.severity === "warning" &&
      check.passed === false
  )
) {
  throw new Error("Expected edge_tts with provider and voice_name to pass with unsupported-local-provider warning.");
}

// --- C1: upstream {scenes, config} request endpoint ------------------------
const upstreamUnknownResponse = await server.inject({
  method: "POST",
  url: "/jobs/does-not-exist/upstream-request/short-video-maker"
});

if (upstreamUnknownResponse.statusCode !== 404) {
  throw new Error(`Expected upstream request for unknown job to return 404, got ${upstreamUnknownResponse.statusCode}.`);
}

const queuedUpstreamJob = {
  ...sampleJob,
  job_id: "voice-upstream-queued-001",
  output: { ...(sampleJob.output as Record<string, unknown>), filename: "voice-upstream-queued-001.mp4" }
};
const queuedUpstreamRender = await server.inject({ method: "POST", url: "/jobs/render", payload: queuedUpstreamJob });

if (queuedUpstreamRender.statusCode !== 202) {
  throw new Error(`Expected queued upstream job to queue, got ${queuedUpstreamRender.statusCode}.`);
}

const queuedUpstreamResponse = await server.inject({
  method: "POST",
  url: "/jobs/voice-upstream-queued-001/upstream-request/short-video-maker"
});

if (queuedUpstreamResponse.statusCode !== 409) {
  throw new Error(`Expected upstream request for queued job to return 409, got ${queuedUpstreamResponse.statusCode}.`);
}

const upstreamPayloadResponse = await server.inject({
  method: "POST",
  url: "/jobs/voice-external-file-001/adapter-payload/short-video-maker"
});

if (upstreamPayloadResponse.statusCode !== 200) {
  throw new Error(`Expected adapter payload to return 200, got ${upstreamPayloadResponse.statusCode}.`);
}

const upstreamResponse = await server.inject({
  method: "POST",
  url: "/jobs/voice-external-file-001/upstream-request/short-video-maker"
});

if (upstreamResponse.statusCode !== 200) {
  throw new Error(`Expected upstream request to return 200, got ${upstreamResponse.statusCode}.`);
}

const upstreamBody = JSON.parse(upstreamResponse.body) as {
  request?: {
    scenes?: Array<{ text?: string; searchTerms?: string[] }>;
    config?: { orientation?: string; voice?: string };
  };
  limitations?: string[];
  scene_count?: number;
};

if (
  !upstreamBody.request?.scenes?.length ||
  upstreamBody.request.scenes.some((scene) => !scene.text?.trim() || !scene.searchTerms?.length) ||
  upstreamBody.request.config?.orientation !== "portrait" ||
  !upstreamBody.limitations?.some((limitation) => limitation.includes("Kokoro"))
) {
  throw new Error("Expected upstream request endpoint to return a valid {scenes, config} body with limitations.");
}

const upstreamArtifactPath = resolve(
  storageRoot,
  "jobs",
  "voice-external-file-001",
  "short-video-maker-upstream-request.json"
);

if (!existsSync(upstreamArtifactPath)) {
  throw new Error("Expected upstream request endpoint to persist short-video-maker-upstream-request.json.");
}

// --- remotion_direct guarded render route ----------------------------------
const remotionRenderJobId = "remotion-direct-001";
await prepareAndPreflight(remotionRenderJobId, {
  type: "edge_tts",
  provider: "edge",
  voice_name: "ar-SA-HamedNeural"
});

delete process.env.RAIZ_ENABLE_REAL_RENDER;
const blockedRender = await server.inject({
  method: "POST",
  url: `/jobs/${remotionRenderJobId}/render/remotion-direct`
});

if (blockedRender.statusCode !== 403) {
  throw new Error(`Expected guarded remotion-direct render to return 403, got ${blockedRender.statusCode}.`);
}

process.env.RAIZ_ENABLE_REAL_RENDER = "true";
const okRender = await server.inject({
  method: "POST",
  url: `/jobs/${remotionRenderJobId}/render/remotion-direct`
});
delete process.env.RAIZ_ENABLE_REAL_RENDER;

if (okRender.statusCode !== 200) {
  throw new Error(`Expected remotion-direct render to return 200, got ${okRender.statusCode}.`);
}

const okRenderBody = JSON.parse(okRender.body) as {
  status?: string;
  output_path?: string | null;
  metadata?: { render_engine?: string; render_manifest_path?: string; output_manifest_path?: string };
};

if (
  okRenderBody.status !== "rendered" ||
  okRenderBody.metadata?.render_engine !== "remotion_direct" ||
  !okRenderBody.output_path
) {
  throw new Error("Expected remotion-direct render to transition the job to rendered with an output path.");
}

const remotionJobDir = resolve(storageRoot, "jobs", remotionRenderJobId);
const remotionOutputManifestPath = resolve(remotionJobDir, "output-manifest.json");
const remotionRenderManifestPath = resolve(remotionJobDir, "render-manifest.remotion-direct.json");

if (!existsSync(remotionRenderManifestPath)) {
  throw new Error("Expected remotion-direct render to write render-manifest.remotion-direct.json.");
}

if (!existsSync(remotionOutputManifestPath) || okRenderBody.metadata?.output_manifest_path !== remotionOutputManifestPath) {
  throw new Error("Expected remotion-direct render to write output-manifest.json for the review pipeline.");
}

const remotionOutputManifest = JSON.parse(readFileSync(remotionOutputManifestPath, "utf8")) as {
  adapter?: string;
  status?: string;
  output_path?: string | null;
  final_video_path?: string | null;
  warnings?: string[];
  errors?: string[];
};

if (
  remotionOutputManifest.adapter !== "remotion_direct" ||
  remotionOutputManifest.status !== "ingested" ||
  remotionOutputManifest.output_path !== okRenderBody.output_path ||
  remotionOutputManifest.final_video_path !== okRenderBody.output_path ||
  !Array.isArray(remotionOutputManifest.warnings) ||
  !Array.isArray(remotionOutputManifest.errors)
) {
  throw new Error("Expected remotion-direct output manifest to be compatible with the review package pipeline.");
}

if (!existsSync(resolve(remotionJobDir, "output", `${remotionRenderJobId}.mp4`))) {
  throw new Error("Expected remotion-direct render to produce the output MP4 via the injected renderer.");
}

const remotionReviewPackageResponse = await server.inject({
  method: "POST",
  url: `/jobs/${remotionRenderJobId}/review-package`
});

if (remotionReviewPackageResponse.statusCode !== 200) {
  throw new Error(
    `Expected review package creation to work after remotion-direct render, got ${remotionReviewPackageResponse.statusCode}.`
  );
}

const remotionArtifactsResponse = await server.inject({
  method: "GET",
  url: `/jobs/${remotionRenderJobId}/artifacts`
});
const remotionArtifacts = JSON.parse(remotionArtifactsResponse.body) as ArtifactInventoryBody;

if (
  remotionArtifacts.summary?.has_output_manifest !== true ||
  remotionArtifacts.summary.has_remotion_render_manifest !== true ||
  !remotionArtifacts.artifacts?.some(
    (artifact) => artifact.name === "output-manifest.json" && artifact.type === "output_manifest" && artifact.exists
  ) ||
  !remotionArtifacts.artifacts.some(
    (artifact) =>
      artifact.name === "render-manifest.remotion-direct.json" &&
      artifact.type === "remotion_render_manifest" &&
      artifact.exists
  )
) {
  throw new Error("Expected artifacts endpoint to detect remotion output and render manifests.");
}

const blockedN8nJobId = "RVF-2026-N8N-BLOCKED-001";
const blockedN8nResponse = await server.inject({
  method: "POST",
  url: "/integrations/n8n/render/remotion-direct",
  payload: {
    ...n8nRenderPayload,
    video_id: blockedN8nJobId
  }
});

if (blockedN8nResponse.statusCode !== 403) {
  throw new Error(`Expected n8n Remotion intake to be blocked by default, got ${blockedN8nResponse.statusCode}.`);
}

if (existsSync(resolve(storageRoot, "jobs", blockedN8nJobId))) {
  throw new Error("Expected blocked n8n Remotion intake not to create a job folder.");
}

process.env.RAIZ_ENABLE_REAL_RENDER = "true";
const invalidN8nResponse = await server.inject({
  method: "POST",
  url: "/integrations/n8n/render/remotion-direct",
  payload: {
    ...n8nRenderPayload,
    video_id: "",
    voiceover: "",
    captions: []
  }
});
delete process.env.RAIZ_ENABLE_REAL_RENDER;

if (invalidN8nResponse.statusCode !== 400) {
  throw new Error(`Expected invalid n8n Remotion payload to return 400, got ${invalidN8nResponse.statusCode}.`);
}

process.env.RAIZ_ENABLE_REAL_RENDER = "true";
const n8nRenderResponse = await server.inject({
  method: "POST",
  url: "/integrations/n8n/render/remotion-direct",
  payload: n8nRenderPayload
});
delete process.env.RAIZ_ENABLE_REAL_RENDER;

if (n8nRenderResponse.statusCode !== 200) {
  throw new Error(`Expected n8n Remotion intake to render with enabled guard, got ${n8nRenderResponse.statusCode}.`);
}

const n8nRenderBody = JSON.parse(n8nRenderResponse.body) as {
  status?: string;
  output_path?: string | null;
  n8n_render_payload_path?: string;
  metadata?: {
    preflight_status?: string;
    render_manifest_path?: string;
    output_manifest_path?: string;
  };
};
const n8nJobId = n8nRenderPayload.video_id;
const n8nJobDir = resolve(storageRoot, "jobs", n8nJobId);
const n8nOutputPath = resolve(n8nJobDir, "output", `${n8nJobId}.mp4`);

if (
  n8nRenderBody.status !== "rendered" ||
  n8nRenderBody.output_path !== n8nOutputPath ||
  n8nRenderBody.n8n_render_payload_path !== resolve(n8nJobDir, "n8n-render-payload.json") ||
  n8nRenderBody.metadata?.preflight_status !== "passed" ||
  !existsSync(n8nOutputPath)
) {
  throw new Error("Expected n8n Remotion intake to create a rendered job with MP4 output.");
}

for (const requiredArtifact of [
  "job.json",
  "n8n-render-payload.json",
  "render-plan.json",
  "preflight-report.json",
  "output-manifest.json",
  "render-manifest.remotion-direct.json"
]) {
  if (!existsSync(resolve(n8nJobDir, requiredArtifact))) {
    throw new Error(`Expected n8n Remotion intake to create ${requiredArtifact}.`);
  }
}

const n8nStoredJob = JSON.parse(readFileSync(resolve(n8nJobDir, "job.json"), "utf8")) as {
  title?: string;
  script?: string;
  template?: {
    engine?: string;
    template_id?: string;
    style_preset?: string;
  };
  assets?: {
    broll_source?: string;
    search_terms?: string[];
    broll_count?: number;
  };
};

if (
  n8nStoredJob.title !== n8nRenderPayload.topic ||
  !n8nStoredJob.script?.includes("لا ينطفئ الإنسان") ||
  n8nStoredJob.template?.engine !== "remotion_direct" ||
  n8nStoredJob.template?.template_id !== "raiz_dark_hook_01" ||
  n8nStoredJob.template?.style_preset !== "new_era_dark_editorial" ||
  n8nStoredJob.assets?.broll_source !== "pexels" ||
  n8nStoredJob.assets?.broll_count !== 3 ||
  n8nStoredJob.assets?.search_terms?.join("|") !==
    "dark desk phone light|night office close up|writing notebook at night"
) {
  throw new Error("Expected n8n Remotion intake to map payload into a deterministic RAIZ job.");
}

const n8nArtifactsResponse = await server.inject({
  method: "GET",
  url: `/jobs/${n8nJobId}/artifacts`
});
const n8nArtifacts = JSON.parse(n8nArtifactsResponse.body) as ArtifactInventoryBody;

if (
  n8nArtifacts.summary?.has_n8n_render_payload !== true ||
  n8nArtifacts.summary.has_render_plan !== true ||
  n8nArtifacts.summary.has_preflight_report !== true ||
  n8nArtifacts.summary.has_output_manifest !== true ||
  n8nArtifacts.summary.has_remotion_render_manifest !== true ||
  n8nArtifacts.summary.has_output !== true ||
  !n8nArtifacts.artifacts?.some(
    (artifact) => artifact.name === "n8n-render-payload.json" && artifact.type === "n8n_render_payload" && artifact.exists
  ) ||
  !n8nArtifacts.artifacts.some(
    (artifact) => artifact.name === `output/${n8nJobId}.mp4` && artifact.type === "output_file" && artifact.exists
  )
) {
  throw new Error("Expected artifacts endpoint to detect n8n intake payload and rendered MP4 output.");
}

process.env.RAIZ_ENABLE_REAL_RENDER = "true";
const duplicateN8nResponse = await server.inject({
  method: "POST",
  url: "/integrations/n8n/render/remotion-direct",
  payload: n8nRenderPayload
});
delete process.env.RAIZ_ENABLE_REAL_RENDER;

if (duplicateN8nResponse.statusCode !== 409) {
  throw new Error(`Expected duplicate n8n Remotion job to return 409, got ${duplicateN8nResponse.statusCode}.`);
}

const queuedRenderJob = {
  ...sampleJob,
  job_id: "remotion-direct-queued-001",
  output: { ...(sampleJob.output as Record<string, unknown>), filename: "remotion-direct-queued-001.mp4" }
};
const queuedRenderResponse = await server.inject({ method: "POST", url: "/jobs/render", payload: queuedRenderJob });

if (queuedRenderResponse.statusCode !== 202) {
  throw new Error(`Expected queued remotion render job to queue, got ${queuedRenderResponse.statusCode}.`);
}

process.env.RAIZ_ENABLE_REAL_RENDER = "true";
const conflictRender = await server.inject({
  method: "POST",
  url: "/jobs/remotion-direct-queued-001/render/remotion-direct"
});
delete process.env.RAIZ_ENABLE_REAL_RENDER;

if (conflictRender.statusCode !== 409) {
  throw new Error(`Expected remotion-direct render on a queued job to return 409, got ${conflictRender.statusCode}.`);
}

const invalidStorageRoot = mkdtempSync(resolve(tmpdir(), "raiz-invalid-test-"));
const invalidServer = createServer({ storageRoot: invalidStorageRoot });
const invalidRenderResponse = await invalidServer.inject({
  method: "POST",
  url: "/jobs/render",
  payload: { ...sampleJob, resolution: { width: 1920, height: 1080 } }
});

if (invalidRenderResponse.statusCode !== 400) {
  throw new Error(`Expected invalid render job to fail validation, got ${invalidRenderResponse.statusCode}.`);
}

if (existsSync(resolve(invalidStorageRoot, "jobs"))) {
  throw new Error("Expected invalid job to create no storage.");
}

await invalidServer.close();
await server.close();
restoreEnv(originalEnv);
rmSync(storageRoot, { force: true, recursive: true });
rmSync(invalidStorageRoot, { force: true, recursive: true });
console.log(`Orchestrator API skeleton validated ${sampleJob.job_id}.`);

function snapshotEnv(keys: string[]): Record<string, string | undefined> {
  return Object.fromEntries(keys.map((key) => [key, process.env[key]]));
}

function restoreEnv(snapshot: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function clearManagedEnv(): void {
  for (const key of managedEnvKeys) {
    delete process.env[key];
  }
}

async function createJobThroughDryRun(jobId: string): Promise<string> {
  const payload = {
    ...sampleJob,
    job_id: jobId,
    output: {
      ...(sampleJob.output as Record<string, unknown>),
      filename: `${jobId}.mp4`
    }
  };
  const jobDir = resolve(storageRoot, "jobs", jobId);

  await expectStatus(
    server.inject({
      method: "POST",
      url: "/jobs/render",
      payload
    }),
    202,
    `queue ${jobId}`
  );
  await expectStatus(server.inject({ method: "POST", url: `/jobs/${jobId}/prepare` }), 200, `prepare ${jobId}`);
  await expectStatus(server.inject({ method: "POST", url: `/jobs/${jobId}/preflight` }), 200, `preflight ${jobId}`);
  await expectStatus(server.inject({ method: "POST", url: `/jobs/${jobId}/adapter-health` }), 200, `adapter health ${jobId}`);
  await expectStatus(
    server.inject({ method: "POST", url: `/jobs/${jobId}/adapter-payload/short-video-maker` }),
    200,
    `adapter payload ${jobId}`
  );
  await expectStatus(
    server.inject({ method: "POST", url: `/jobs/${jobId}/readiness-review` }),
    200,
    `readiness review ${jobId}`
  );
  await expectStatus(
    server.inject({ method: "POST", url: `/jobs/${jobId}/adapter-dry-run/short-video-maker` }),
    200,
    `dry-run request ${jobId}`
  );

  return jobDir;
}

async function createJobThroughHttpPlan(jobId: string): Promise<string> {
  const jobDir = await createJobThroughDryRun(jobId);

  await expectStatus(
    server.inject({ method: "POST", url: `/jobs/${jobId}/http-send-plan/short-video-maker` }),
    200,
    `HTTP send plan ${jobId}`
  );

  return jobDir;
}

async function createJobThroughRealHttpSenderReadiness(jobId: string): Promise<string> {
  const jobDir = await createJobThroughHttpPlan(jobId);

  process.env.RAIZ_ENABLE_REAL_RENDER = "true";
  await expectStatus(
    server.inject({ method: "POST", url: `/jobs/${jobId}/http-send-mock/short-video-maker` }),
    200,
    `mocked HTTP send ${jobId}`
  );
  delete process.env.RAIZ_ENABLE_REAL_RENDER;
  await expectStatus(
    server.inject({ method: "POST", url: `/jobs/${jobId}/real-http-sender-readiness` }),
    200,
    `real HTTP sender readiness ${jobId}`
  );

  return jobDir;
}

async function createJobThroughReviewPackage(jobId: string): Promise<string> {
  const jobDir = await createJobThroughRealHttpSenderReadiness(jobId);
  const finalOutputPath = resolve(jobDir, "output", `${jobId}.mp4`);

  process.env.RAIZ_ENABLE_REAL_RENDER = "true";
  await expectStatus(
    server.inject({ method: "POST", url: `/jobs/${jobId}/send-to-short-video-maker` }),
    200,
    `real HTTP sender ${jobId}`
  );
  delete process.env.RAIZ_ENABLE_REAL_RENDER;
  writeFileSync(finalOutputPath, "mock upstream video output for review package");
  await expectStatus(
    server.inject({ method: "POST", url: `/jobs/${jobId}/ingest-output/short-video-maker` }),
    200,
    `output ingestion ${jobId}`
  );
  await expectStatus(
    server.inject({ method: "POST", url: `/jobs/${jobId}/review-package` }),
    200,
    `review package ${jobId}`
  );

  return jobDir;
}

async function expectStatus(
  responsePromise: Promise<{ statusCode: number }>,
  expectedStatus: number,
  label: string
): Promise<void> {
  const response = await responsePromise;

  if (response.statusCode !== expectedStatus) {
    throw new Error(`Expected ${label} to return ${expectedStatus}, got ${response.statusCode}.`);
  }
}
