import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { validateRaizJob } from "@raiz/job-schema";

import { shortVideoMakerAdapter } from "./shortVideoMakerAdapter.js";

const currentDir = dirname(fileURLToPath(import.meta.url));
const samplePath = resolve(currentDir, "../../../samples/valid-arabic-9x16-job.json");
const sample = JSON.parse(readFileSync(samplePath, "utf8")) as unknown;
const validation = validateRaizJob(sample);

if (!validation.valid) {
  throw new Error("Sample job must be valid before adapter preparation.");
}

if (!(await shortVideoMakerAdapter.canRender(validation.job))) {
  throw new Error("short-video-maker adapter should accept short_video_maker jobs.");
}

const prepared = await shortVideoMakerAdapter.prepare(validation.job);
const result = await shortVideoMakerAdapter.render(prepared);

if (result.status !== "queued") {
  throw new Error("Phase 1 short-video-maker adapter must only return queued mock status.");
}

if (!shortVideoMakerAdapter.checkHealth) {
  throw new Error("short-video-maker adapter must expose checkHealth.");
}

const vendorHealth = await shortVideoMakerAdapter.checkHealth({
  vendorPath: resolve(currentDir, "../../../vendor/short-video-maker")
});

if (!["healthy", "degraded"].includes(vendorHealth.status)) {
  throw new Error(`Expected existing short-video-maker vendor health to be healthy or degraded, got ${vendorHealth.status}.`);
}

if (vendorHealth.adapter !== "short_video_maker" || vendorHealth.metadata.package_name !== "short-video-maker") {
  throw new Error("Expected short-video-maker health report to include adapter and package metadata.");
}

const missingRoot = mkdtempSync(resolve(tmpdir(), "raiz-missing-adapter-"));
const missingHealth = await shortVideoMakerAdapter.checkHealth({
  vendorPath: resolve(missingRoot, "missing-short-video-maker")
});

if (missingHealth.status !== "missing") {
  throw new Error(`Expected fake short-video-maker vendor path to be missing, got ${missingHealth.status}.`);
}

rmSync(missingRoot, { force: true, recursive: true });
console.log(`Prepared ${prepared.engine} render contract for ${prepared.jobId}`);
