#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const creativeBriefSchemaPath = resolve(repoRoot, "creative_brief.schema.json");
const raizJobSchemaPath = resolve(repoRoot, "raiz-job.schema.json");

const defaultVoice = {
  type: "edge_tts",
  provider: "edge",
  voice_name: "ar-SA-HamedNeural"
};

export function convertCreativeBriefToJob(brief) {
  const jobId = brief.job_id;
  const beatTexts = brief.beats.map((beat) => beat.text.trim()).filter(Boolean);
  const brollSearchTerms = uniqueStrings(brief.beats.flatMap((beat) => beat.broll_search_terms ?? []));
  const templateIntent = brief.template_intent ?? {};
  const visualCodeSummary = summarizeVisualCode(brief.visual_code);
  const publishDescription = [
    brief.publish?.description || brief.objective,
    visualCodeSummary ? `Visual code: ${visualCodeSummary}` : "",
    templateIntent.composition_goal ? `Template intent: ${templateIntent.composition_goal}` : ""
  ]
    .filter(Boolean)
    .join("\n\n");

  return {
    job_id: jobId,
    platform: brief.platform,
    aspect_ratio: "9:16",
    resolution: {
      width: 1080,
      height: 1920
    },
    language: brief.language ?? "ar",
    direction: brief.direction ?? "rtl",
    title: brief.project,
    hook: beatTexts[0],
    script: beatTexts.join("\n\n"),
    template: {
      engine: templateIntent.engine ?? "remotion_direct",
      template_id: templateIntent.template_id ?? "raiz_dark_hook_01",
      ...(templateIntent.style_preset || brief.tone ? { style_preset: templateIntent.style_preset ?? safeStylePreset(brief.tone) } : {})
    },
    voice: brief.voice ?? defaultVoice,
    assets: {
      broll_source: brollSearchTerms.length > 0 ? "pexels" : "none"
    },
    captions: {
      enabled: true,
      format: "ass",
      font: "Cairo-Bold",
      burn_in: true,
      position: templateIntent.caption_position ?? "bottom",
      ...(templateIntent.style_preset ? { style_preset: templateIntent.style_preset } : {})
    },
    output: {
      drive_folder: "local",
      filename: brief.output?.filename ?? `${jobId}.mp4`
    },
    publish: {
      youtube: false,
      mode: "manual_only",
      description: publishDescription,
      tags: uniqueStrings([...(brief.publish?.tags ?? []), ...brollSearchTerms, brief.tone, brief.platform])
    }
  };
}

export function createEditingPlan(brief, job, paths) {
  const createdAt = new Date().toISOString();
  const brollSearchTerms = uniqueStrings(brief.beats.flatMap((beat) => beat.broll_search_terms ?? []));

  return {
    job_id: job.job_id,
    source: "creative_os",
    status: "planned",
    creative_brief_path: paths.creativeBriefPath,
    raiz_job_path: paths.jobPath,
    project: brief.project,
    objective: brief.objective,
    tone: brief.tone,
    platform: brief.platform,
    visual_code: brief.visual_code,
    template_intent: brief.template_intent,
    template_id: job.template.template_id,
    render_engine: job.template.engine,
    beats: brief.beats.map((beat, index) => ({
      index,
      text: beat.text,
      visual_intent: beat.visual_intent,
      broll_search_terms: beat.broll_search_terms ?? []
    })),
    broll_search_terms: brollSearchTerms,
    safety: {
      will_call_external_api: false,
      will_render_video: false,
      will_upload: false,
      will_modify_vendor: false
    },
    created_at: createdAt
  };
}

export function convertAndWriteCreativeBrief(briefPath, options = {}) {
  const overwrite = options.overwrite === true;
  const storageRoot = resolve(repoRoot, options.storage ?? "storage/jobs");
  const brief = readJson(resolve(repoRoot, briefPath));
  const creativeBriefSchema = readJson(creativeBriefSchemaPath);
  const raizJobSchema = readJson(raizJobSchemaPath);

  validateJson(creativeBriefSchema, brief, "creative brief");
  const job = convertCreativeBriefToJob(brief);
  validateJson(raizJobSchema, job, "RAIZ job");

  const jobDir = resolve(storageRoot, job.job_id);
  const paths = {
    jobDir,
    creativeBriefPath: resolve(jobDir, "creative_brief.json"),
    editingPlanPath: resolve(jobDir, "editing_plan.json"),
    jobPath: resolve(jobDir, "job.json")
  };
  const editingPlan = createEditingPlan(brief, job, paths);

  if (existsSync(jobDir)) {
    if (!overwrite) {
      throw new Error(`Job bridge folder already exists: ${jobDir}. Use --overwrite to replace it.`);
    }

    rmSync(jobDir, { recursive: true, force: true });
  }

  mkdirSync(jobDir, { recursive: true });
  writeJson(paths.creativeBriefPath, brief);
  writeJson(paths.editingPlanPath, editingPlan);
  writeJson(paths.jobPath, job);

  return {
    job,
    editingPlan,
    paths
  };
}

function parseArgs(argv) {
  const args = {
    brief: "samples/creative-brief-arabic-lexicon.json",
    storage: "storage/jobs",
    overwrite: false,
    stdout: false
  };

  for (const token of argv) {
    if (token === "--overwrite") {
      args.overwrite = true;
      continue;
    }

    if (token === "--stdout") {
      args.stdout = true;
      continue;
    }

    const match = /^--([^=]+)=(.*)$/.exec(token);
    if (match) {
      args[match[1]] = match[2];
    }
  }

  return args;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function validateJson(schema, value, label) {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const validate = ajv.compile(schema);

  if (!validate(value)) {
    const errors = JSON.stringify(validate.errors ?? [], null, 2);
    throw new Error(`Invalid ${label}: ${errors}`);
  }
}

function uniqueStrings(values) {
  const seen = new Set();
  const result = [];

  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }

    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

function safeStylePreset(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48) || "creative_os";
}

function summarizeVisualCode(visualCode) {
  if (!visualCode || typeof visualCode !== "object") {
    return "";
  }

  return Object.entries(visualCode)
    .map(([key, value]) => `${key}=${Array.isArray(value) ? value.join(", ") : value}`)
    .join("; ");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = convertAndWriteCreativeBrief(args.brief, args);

  if (args.stdout) {
    console.log(JSON.stringify(result.job, null, 2));
    return;
  }

  console.log("Creative OS bridge conversion complete.");
  console.log(`job_id: ${result.job.job_id}`);
  console.log(`creative_brief: ${result.paths.creativeBriefPath}`);
  console.log(`editing_plan: ${result.paths.editingPlanPath}`);
  console.log(`raiz_job: ${result.paths.jobPath}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
