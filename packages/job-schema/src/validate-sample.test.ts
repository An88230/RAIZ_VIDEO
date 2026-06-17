import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { validateRaizJob } from "./index.js";

const currentDir = dirname(fileURLToPath(import.meta.url));
const samplePath = resolve(currentDir, "../../../samples/valid-arabic-9x16-job.json");
const sample = JSON.parse(readFileSync(samplePath, "utf8")) as unknown;
const result = validateRaizJob(sample);

if (!result.valid) {
  console.error(JSON.stringify(result.errors, null, 2));
  throw new Error("Expected valid Arabic 9:16 sample job to pass schema validation.");
}

if (result.job.language !== "ar" || result.job.direction !== "rtl") {
  throw new Error("Expected sample job to be Arabic RTL.");
}

if (result.job.resolution.width !== 1080 || result.job.resolution.height !== 1920) {
  throw new Error("Expected sample job to be 1080x1920.");
}

console.log(`Validated RAIZ sample job: ${result.job.job_id}`);
