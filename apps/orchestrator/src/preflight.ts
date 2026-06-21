import { access, writeFile } from "node:fs/promises";

import type { RaizJob } from "@raiz/job-schema";

import type { RenderPlan } from "./renderPlan.js";
import { runLocalPathWarningChecks } from "./localPathChecks.js";
import {
  appendJobEvent,
  getJobPaths,
  getJobStatus,
  getStoredJob,
  getStoredRenderPlan,
  type PersistenceOptions,
  updateJobMetadata,
  updateJobStatus
} from "./persistence.js";

export type PreflightStatus = "passed" | "failed";
export type PreflightSeverity = "error" | "warning";

export interface PreflightCheck {
  name: string;
  passed: boolean;
  severity: PreflightSeverity;
  message: string;
}

export interface PreflightReport {
  job_id: string;
  status: PreflightStatus;
  checks: PreflightCheck[];
  warnings: string[];
  errors: string[];
  created_at: string;
}

export class JobPreflightStateError extends Error {
  constructor(jobId: string, status: string) {
    super(`Job ${jobId} must be preparing before preflight. Current status is ${status}.`);
    this.name = "JobPreflightStateError";
  }
}

export async function runPreflight(jobId: string, options: PersistenceOptions = {}): Promise<PreflightReport> {
  const paths = getJobPaths(jobId, options);
  const status = await getJobStatus(jobId, options);

  if (status.status !== "preparing") {
    throw new JobPreflightStateError(jobId, status.status);
  }

  const [job, renderPlan] = await Promise.all([getStoredJob(jobId, options), getStoredRenderPlan(jobId, options)]);
  const outputDirectoryExists = await pathExists(paths.outputDir);
  const checks = await buildChecks(job, renderPlan, outputDirectoryExists);
  const errors = checks
    .filter((check) => check.severity === "error" && !check.passed)
    .map((check) => check.message);
  const warnings = checks
    .filter((check) => check.severity === "warning" && !check.passed)
    .map((check) => check.message);
  const report: PreflightReport = {
    job_id: jobId,
    status: errors.length > 0 ? "failed" : "passed",
    checks,
    warnings,
    errors,
    created_at: new Date().toISOString()
  };

  await writeFile(paths.preflightReportPath, `${JSON.stringify(report, null, 2)}\n`);

  if (report.status === "failed") {
    const errorSummary = errors.join("; ");
    await updateJobStatus(jobId, "failed", {
      storageRoot: options.storageRoot,
      error: errorSummary,
      metadata: {
        ...(status.metadata ?? {}),
        preflight_report_path: paths.preflightReportPath,
        preflight_status: "failed"
      }
    });
    await appendJobEvent(
      jobId,
      {
        type: "job.preflight_failed",
        preflight_report_path: paths.preflightReportPath,
        errors
      },
      options
    );
  } else {
    await updateJobMetadata(
      jobId,
      {
        preflight_report_path: paths.preflightReportPath,
        preflight_status: "passed"
      },
      options
    );
    await appendJobEvent(
      jobId,
      {
        type: "job.preflight_passed",
        preflight_report_path: paths.preflightReportPath,
        warnings
      },
      options
    );
  }

  return report;
}

async function buildChecks(job: RaizJob, renderPlan: RenderPlan, outputDirectoryExists: boolean): Promise<PreflightCheck[]> {
  const baseChecks = [
    errorCheck("job_id_exists", Boolean(job.job_id && renderPlan.job_id), "Job id exists."),
    errorCheck("script_exists", Boolean(job.script?.trim()), "Script text exists."),
    errorCheck("aspect_ratio", job.aspect_ratio === "9:16" && renderPlan.aspect_ratio === "9:16", "Aspect ratio is 9:16."),
    errorCheck("render_plan_width", renderPlan.width === 1080, "Render plan width is 1080."),
    errorCheck("render_plan_height", renderPlan.height === 1920, "Render plan height is 1920."),
    errorCheck("arabic_language", job.language === "ar" && renderPlan.language === "ar", "Language is Arabic."),
    errorCheck("arabic_direction", job.direction === "rtl" && renderPlan.direction === "rtl", "Direction is RTL."),
    errorCheck("template_id_exists", Boolean(renderPlan.template_id?.trim()), "Template id exists."),
    ...buildVoiceChecks(job, renderPlan),
    errorCheck("captions_config_exists", Boolean(renderPlan.captions), "Captions config exists."),
    errorCheck("output_local_path_exists", Boolean(renderPlan.output.local_path?.trim()), "Output local path exists."),
    errorCheck("output_directory_exists", outputDirectoryExists, "Output directory exists."),
    warningCheck("assets_declared", hasDeclaredAsset(job, renderPlan), "Assets declaration is present when available.")
  ];
  const localPathChecks = await runLocalPathWarningChecks(job, renderPlan);

  return [...baseChecks, ...localPathChecks];
}

function buildVoiceChecks(job: RaizJob, renderPlan: RenderPlan): PreflightCheck[] {
  const voiceType = job.voice.type;

  // No narration requested: nothing is required for the render to proceed.
  if (voiceType === "none") {
    return [warningCheck("voice_none", true, "Voice type is none; no narration will be generated.")];
  }

  // External recorded voice-over: a declared file path is required. Its actual
  // existence is a warning-only check handled by runLocalPathWarningChecks, so a
  // missing file does not fail preflight.
  if (voiceType === "external_file") {
    return [
      errorCheck(
        "voice_external_source_declared",
        Boolean(job.voice.file_path?.trim() || job.voice.audio_url?.trim()),
        "External voice file path or audio URL is declared."
      )
    ];
  }

  // TTS providers (edge_tts, elevenlabs, azure) need a provider and a voice name.
  const checks = [
    errorCheck("voice_provider_exists", Boolean(renderPlan.voice.provider?.trim()), "Voice provider exists."),
    errorCheck("voice_name_exists", Boolean(renderPlan.voice.voice_name?.trim()), "Voice name exists.")
  ];

  if (isSchemaSupportedTtsProvider(voiceType)) {
    checks.push(
      warningCheck(
        "voice_provider_not_implemented_locally",
        false,
        "This voice provider is schema-supported but not implemented in local render v1. Local render requires external voice generation or fallback."
      )
    );
  }

  return checks;
}

function errorCheck(name: string, passed: boolean, message: string): PreflightCheck {
  return { name, passed, severity: "error", message };
}

function warningCheck(name: string, passed: boolean, message: string): PreflightCheck {
  return { name, passed, severity: "warning", message };
}

function isSchemaSupportedTtsProvider(voiceType: string): boolean {
  return voiceType === "edge_tts" || voiceType === "elevenlabs" || voiceType === "azure";
}

function hasDeclaredAsset(job: RaizJob, renderPlan: RenderPlan): boolean {
  return Boolean(
    job.assets?.broll_source ||
      job.assets?.broll_folder ||
      job.assets?.music ||
      job.assets?.logo ||
      renderPlan.assets.broll_source ||
      renderPlan.assets.broll_folder ||
      renderPlan.assets.music ||
      renderPlan.assets.logo
  );
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
