import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { validateRaizJob } from "@raiz/job-schema";

import { prepareRenderPlan } from "./renderPlan.js";

const currentDir = dirname(fileURLToPath(import.meta.url));
const samplePath = resolve(currentDir, "../../../samples/valid-arabic-9x16-job.json");
const sample = JSON.parse(readFileSync(samplePath, "utf8")) as unknown;
const validation = validateRaizJob(sample);

if (!validation.valid) {
  throw new Error("Sample job must be valid before render plan preparation.");
}

const plan = prepareRenderPlan(validation.job, {
  createdAt: "2026-06-17T00:00:00.000Z"
});

if (plan.width !== 1080 || plan.height !== 1920 || plan.aspect_ratio !== "9:16") {
  throw new Error("Expected Arabic 9:16 render plan to use 1080x1920.");
}

if (plan.language !== "ar" || plan.direction !== "rtl") {
  throw new Error("Expected Arabic render plan to preserve language and direction.");
}

if (plan.adapter !== "short_video_maker" || plan.engine !== "remotion") {
  throw new Error("Expected default adapter short_video_maker and default engine remotion.");
}

console.log(`Prepared deterministic render plan for ${plan.job_id}.`);

if (plan.duration_seconds !== null) {
  throw new Error("Expected sample render plan duration to be null when the job does not declare duration_seconds.");
}

const audioUrlPlan = prepareRenderPlan(
  {
    ...validation.job,
    job_id: "render-plan-audio-url-001",
    duration_seconds: 45,
    voice: {
      type: "external_file",
      provider: "external_url",
      voice_name: "external_url",
      audio_url: "https://gemini.example.test/audio.wav?token=secret-token"
    },
    output: {
      ...validation.job.output,
      filename: "render-plan-audio-url-001.mp4"
    }
  },
  {
    createdAt: "2026-06-17T00:00:00.000Z"
  }
);

if (
  audioUrlPlan.duration_seconds !== 45 ||
  audioUrlPlan.voice.external_url !== "https://gemini.example.test/audio.wav?__redacted__=true" ||
  JSON.stringify(audioUrlPlan).includes("secret-token")
) {
  throw new Error("Expected render plan to record duration and masked external audio URL.");
}
