import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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
