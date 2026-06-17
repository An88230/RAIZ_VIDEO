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
