import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { validateRaizJob } from "@raiz/job-schema";

import { mapToShortVideoMakerPayload } from "./shortVideoMakerPayloadMapper.js";
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

const payload = mapToShortVideoMakerPayload({
  job: validation.job,
  renderPlan: {
    job_id: validation.job.job_id,
    adapter: "short_video_maker",
    engine: "remotion",
    aspect_ratio: "9:16",
    width: 1080,
    height: 1920,
    language: "ar",
    direction: "rtl",
    template_id: validation.job.template.template_id,
    voice: {
      provider: validation.job.voice.provider ?? null,
      voice_name: validation.job.voice.voice_name ?? null
    },
    captions: validation.job.captions,
    assets: {
      broll_source: validation.job.assets?.broll_source ?? null,
      broll_folder: validation.job.assets?.broll_folder ?? null,
      music: validation.job.assets?.music ?? null,
      logo: validation.job.assets?.logo ?? null
    },
    output: {
      filename: validation.job.output.filename,
      local_path: "/tmp/smoke-arabic-001.mp4"
    },
    created_at: "2026-06-17T00:00:00.000Z"
  },
  preflightReport: {
    job_id: validation.job.job_id,
    status: "passed",
    created_at: "2026-06-17T00:00:00.000Z"
  }
});

if (
  payload.adapter !== "short_video_maker" ||
  payload.composition.width !== 1080 ||
  payload.composition.height !== 1920 ||
  payload.composition.language !== "ar" ||
  payload.composition.direction !== "rtl" ||
  payload.script.text !== validation.job.script ||
  payload.voice.provider !== "edge" ||
  payload.captions.format !== "ass" ||
  payload.output.filename !== validation.job.output.filename
) {
  throw new Error("Expected short-video-maker payload mapper to preserve RAIZ render contract fields.");
}

rmSync(missingRoot, { force: true, recursive: true });
console.log(`Prepared ${prepared.engine} render contract for ${prepared.jobId}`);
