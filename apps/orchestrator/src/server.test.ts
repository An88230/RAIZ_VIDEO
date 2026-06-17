import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createServer } from "./server.js";

const currentDir = dirname(fileURLToPath(import.meta.url));
const samplePath = resolve(currentDir, "../../../samples/valid-arabic-9x16-job.json");
const sampleJob = JSON.parse(readFileSync(samplePath, "utf8")) as Record<string, unknown>;
const storageRoot = mkdtempSync(resolve(tmpdir(), "raiz-orchestrator-test-"));
const server = createServer({ storageRoot });

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
rmSync(storageRoot, { force: true, recursive: true });
rmSync(invalidStorageRoot, { force: true, recursive: true });
console.log(`Orchestrator API skeleton validated ${sampleJob.job_id}.`);
