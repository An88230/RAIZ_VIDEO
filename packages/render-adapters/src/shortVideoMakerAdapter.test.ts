import { readFileSync } from "node:fs";
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

console.log(`Prepared ${prepared.engine} render contract for ${prepared.jobId}`);
