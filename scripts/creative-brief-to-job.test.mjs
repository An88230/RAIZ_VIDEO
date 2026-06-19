#!/usr/bin/env node

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const samplePath = resolve(repoRoot, "samples/creative-brief-arabic-lexicon.json");
const creativeBriefSchemaPath = resolve(repoRoot, "creative_brief.schema.json");
const raizJobSchemaPath = resolve(repoRoot, "raiz-job.schema.json");
const converterPath = resolve(repoRoot, "scripts/creative-brief-to-job.mjs");
const tempStorage = mkdtempSync(resolve(tmpdir(), "raiz-creative-bridge-test-"));

try {
  const sample = readJson(samplePath);
  validateJson(readJson(creativeBriefSchemaPath), sample, "creative brief sample");

  const convertResult = spawnSync(
    process.execPath,
    [converterPath, `--brief=${samplePath}`, `--storage=${tempStorage}`],
    {
      cwd: repoRoot,
      encoding: "utf8"
    }
  );

  if (convertResult.status !== 0) {
    console.error(convertResult.stdout);
    console.error(convertResult.stderr);
    throw new Error(`creative-brief-to-job.mjs failed with exit code ${convertResult.status}.`);
  }

  const jobDir = resolve(tempStorage, sample.job_id);
  const creativeBriefPath = resolve(jobDir, "creative_brief.json");
  const editingPlanPath = resolve(jobDir, "editing_plan.json");
  const jobPath = resolve(jobDir, "job.json");

  for (const path of [creativeBriefPath, editingPlanPath, jobPath]) {
    if (!existsSync(path)) {
      throw new Error(`Expected converter to write ${path}.`);
    }
  }

  const job = readJson(jobPath);
  validateJson(readJson(raizJobSchemaPath), job, "generated RAIZ job");

  if (
    job.job_id !== sample.job_id ||
    job.title !== sample.project ||
    job.platform !== sample.platform ||
    job.language !== "ar" ||
    job.direction !== "rtl" ||
    job.template?.engine !== "remotion_direct" ||
    job.template.template_id !== "raiz_dark_hook_01" ||
    job.output?.filename !== `${sample.job_id}.mp4`
  ) {
    throw new Error("Expected creative brief fields to map into the generated RAIZ job.");
  }

  if (job.hook !== sample.beats[0].text || !sample.beats.every((beat) => job.script.includes(beat.text))) {
    throw new Error("Expected beat text to map into RAIZ hook and script.");
  }

  const expectedSearchTerm = sample.beats[0].broll_search_terms[0];
  if (job.assets?.broll_source !== "pexels" || !job.publish?.tags?.includes(expectedSearchTerm)) {
    throw new Error("Expected b-roll search terms to map into job asset intent and publish tags.");
  }

  const editingPlan = readJson(editingPlanPath);
  if (
    editingPlan.source !== "creative_os" ||
    editingPlan.safety?.will_call_external_api !== false ||
    editingPlan.safety?.will_render_video !== false ||
    editingPlan.beats?.[0]?.visual_intent !== sample.beats[0].visual_intent ||
    !editingPlan.broll_search_terms?.includes(expectedSearchTerm)
  ) {
    throw new Error("Expected editing_plan.json to preserve Creative OS visual intent and safety flags.");
  }

  console.log(`Validated Creative OS bridge conversion: ${sample.job_id}`);
} finally {
  rmSync(tempStorage, { recursive: true, force: true });
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function validateJson(schema, value, label) {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const validate = ajv.compile(schema);

  if (!validate(value)) {
    console.error(JSON.stringify(validate.errors, null, 2));
    throw new Error(`Expected valid ${label}.`);
  }
}
