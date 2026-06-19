#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const commandSchema = readJson(resolve(repoRoot, "creative_os_command.schema.json"));
const resultSchema = readJson(resolve(repoRoot, "creative_os_action_result.schema.json"));
const showModeTriggerSchema = readJson(resolve(repoRoot, "show_mode_trigger.schema.json"));
const showModeStatusResponseSchema = readJson(resolve(repoRoot, "show_mode_status_response.schema.json"));
const contentRadarModeSchema = readJson(resolve(repoRoot, "content_radar_mode.schema.json"));
const contentPatternReportSchema = readJson(resolve(repoRoot, "content_pattern_report.schema.json"));
const contentOpportunitySchema = readJson(resolve(repoRoot, "content_opportunity.schema.json"));
const sampleCommand = readJson(resolve(repoRoot, "samples/creative-os-command-render-arabic.json"));
const showModeTrigger = readJson(resolve(repoRoot, "samples/show-mode-double-clap-trigger.json"));
const showModeSystemQuestion = readJson(resolve(repoRoot, "samples/show-mode-system-status-question.json"));
const showModePublishQuestion = readJson(resolve(repoRoot, "samples/show-mode-publish-status-question.json"));
const contentRadarModes = [
  readJson(resolve(repoRoot, "samples/content-radar-mode-tech.json")),
  readJson(resolve(repoRoot, "samples/content-radar-mode-home-maintenance.json")),
  readJson(resolve(repoRoot, "samples/content-radar-mode-daily-life.json"))
];
const contentPatternReport = readJson(resolve(repoRoot, "samples/content-pattern-report-example.json"));

const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addFormat("date-time", true);

validate(commandSchema, sampleCommand, "sample Creative OS command");
validate(showModeTriggerSchema, showModeTrigger, "sample Show Mode trigger");
validate(commandSchema, showModeSystemQuestion, "sample Show Mode system status question");
validate(commandSchema, showModePublishQuestion, "sample Show Mode publish status question");
for (const mode of contentRadarModes) {
  validate(contentRadarModeSchema, mode, `sample Content Radar mode ${mode.mode_id}`);
}
validate(contentPatternReportSchema, contentPatternReport, "sample Content Radar pattern report");
for (const opportunity of contentPatternReport.opportunities) {
  validate(contentOpportunitySchema, opportunity, `sample Content Radar opportunity ${opportunity.opportunity_id}`);
}

if (
  sampleCommand.requested_action !== "run_local_render" ||
  sampleCommand.payload?.project !== "قاموس مشاعر العصر الجديد" ||
  sampleCommand.payload?.concept !== "الانطفاء اللامع" ||
  sampleCommand.payload?.template_id !== "raiz-dictionary-card-01" ||
  sampleCommand.payload?.voice_provider !== "gemini_tts" ||
  sampleCommand.payload?.output !== "local_mp4" ||
  sampleCommand.payload?.publish !== false ||
  sampleCommand.safety?.allow_arbitrary_shell !== false ||
  sampleCommand.safety?.secrets_in_payload !== false
) {
  throw new Error("Expected Arabic sample command to encode the requested safe local render action.");
}

const sampleResult = {
  command_id: sampleCommand.command_id,
  action_id: sampleCommand.requested_action,
  status: "requires_confirmation",
  summary: "Local render requires confirmation before side effects.",
  artifacts: [],
  logs: ["Command validated against the allowed action registry contract."],
  next_recommended_action: "run_local_render",
  errors: [],
  completed_at: "2026-06-19T00:00:01.000Z"
};
validate(resultSchema, sampleResult, "sample Creative OS action result");

const showModeStatusResult = {
  command_id: showModeSystemQuestion.command_id,
  action_id: showModeSystemQuestion.requested_action,
  status: "succeeded",
  summary: "Read-only Show Mode status question answered.",
  artifacts: [],
  logs: ["No shell, publishing, render, upload, or network side effect was requested."],
  next_recommended_action: "get_next_recommended_action",
  errors: [],
  completed_at: "2026-06-20T00:00:03.000Z"
};
validate(resultSchema, showModeStatusResult, "sample Show Mode action result");

const missingPublishPackageResponse = {
  response_id: "show_mode_publish_response_001",
  question: showModePublishQuestion.natural_language_command,
  answer: "النشر لم يبدأ. الموجود حاليًا خطة/حزمة مراجعة فقط.",
  status_type: "publish",
  read_only: true,
  git: {
    status_summary: null,
    latest_commit: null
  },
  latest_job: {
    job_id: null,
    status: null
  },
  latest_render: {
    output_path: null,
    status: null
  },
  review_package: {
    exists: true,
    path: "storage/jobs/example/review-package.json"
  },
  publish_package: {
    exists: false,
    path: null
  },
  publishing: {
    status: "planned_only",
    executed: false
  },
  next_recommended_action: "create_publish_package",
  created_at: "2026-06-20T00:00:04.000Z"
};
validate(showModeStatusResponseSchema, missingPublishPackageResponse, "Show Mode missing publish package response");

const existingPublishPackageResponse = {
  ...missingPublishPackageResponse,
  response_id: "show_mode_publish_response_002",
  answer: "جاهز للمراجعة قبل النشر.",
  publish_package: {
    exists: true,
    path: "storage/jobs/example/publish-package.json"
  },
  publishing: {
    status: "ready_for_review",
    executed: false
  },
  next_recommended_action: "inspect_job_artifacts",
  created_at: "2026-06-20T00:00:05.000Z"
};
validate(showModeStatusResponseSchema, existingPublishPackageResponse, "Show Mode existing publish package response");

if (
  showModeTrigger.listen_mode !== true ||
  showModeTrigger.safety?.will_execute_action !== false ||
  showModeTrigger.safety?.will_run_render !== false ||
  showModeTrigger.safety?.will_publish !== false ||
  showModeTrigger.safety?.will_push_git !== false ||
  showModeTrigger.safety?.will_execute_shell !== false
) {
  throw new Error("Expected Show Mode trigger to only activate listening UI state.");
}

for (const question of [showModeSystemQuestion, showModePublishQuestion]) {
  if (
    question.safety?.allow_arbitrary_shell !== false ||
    question.safety?.secrets_in_payload !== false ||
    question.safety?.network_allowed !== false ||
    question.safety?.requires_confirmation !== false
  ) {
    throw new Error(`Expected ${question.command_id} to be read-only and local-safe.`);
  }
}

if (
  showModePublishQuestion.payload?.required_answer_when_missing !==
    "النشر لم يبدأ. الموجود حاليًا خطة/حزمة مراجعة فقط." ||
  showModePublishQuestion.payload?.required_answer_when_publish_package_exists !==
    "جاهز للمراجعة قبل النشر." ||
  showModePublishQuestion.payload?.must_not_publish !== true ||
  missingPublishPackageResponse.publishing.executed !== false ||
  existingPublishPackageResponse.publishing.executed !== false
) {
  throw new Error("Expected publish status semantics to report readiness only.");
}

const expectedContentRadarModes = new Set(["tech_discovery", "home_maintenance", "daily_life"]);
for (const mode of contentRadarModes) {
  expectedContentRadarModes.delete(mode.mode_id);

  for (const scoreName of [
    "curiosity_score",
    "usefulness_score",
    "originality_potential",
    "affiliate_potential",
    "production_difficulty",
    "rights_risk",
    "brand_fit",
    "remake_safety"
  ]) {
    if (!mode.scoring_rules?.[scoreName]) {
      throw new Error(`Expected ${mode.mode_id} to define ${scoreName}.`);
    }
  }

  if (
    !mode.exclude_patterns.some((pattern) => pattern.includes("gross")) ||
    !mode.safety_rules.some((rule) => rule.rule_id === "no_video_download") ||
    mode.affiliate_angle_rules?.disclosure_required !== true ||
    mode.affiliate_angle_rules?.must_use_original_or_licensed_assets !== true
  ) {
    throw new Error(`Expected ${mode.mode_id} to enforce useful, safe, rights-aware radar behavior.`);
  }
}

if (expectedContentRadarModes.size > 0) {
  throw new Error(`Missing Content Radar modes: ${Array.from(expectedContentRadarModes).join(", ")}`);
}

if (
  contentPatternReport.source_reference?.source_video_downloaded !== false ||
  contentPatternReport.useful_curiosity?.avoids_gross_content !== true ||
  contentPatternReport.rights_review?.pattern_only !== true ||
  contentPatternReport.rights_review?.copies_source_video !== false ||
  contentPatternReport.rights_review?.uses_source_audio !== false ||
  contentPatternReport.rights_review?.watermark_removal_required !== false ||
  contentPatternReport.safety_review?.no_download !== true ||
  contentPatternReport.safety_review?.no_repost !== true ||
  contentPatternReport.safety_review?.no_publishing_automation !== true
) {
  throw new Error("Expected Content Radar report to copy patterns, not videos.");
}

for (const opportunity of contentPatternReport.opportunities) {
  if (
    opportunity.execution_policy?.will_download_source_video !== false ||
    opportunity.execution_policy?.will_repost_source_video !== false ||
    opportunity.execution_policy?.will_remove_watermark !== false ||
    opportunity.execution_policy?.will_scrape !== false ||
    opportunity.execution_policy?.will_publish !== false ||
    opportunity.rights_plan?.original_or_licensed_assets !== true ||
    opportunity.rights_plan?.source_assets_reused !== false
  ) {
    throw new Error(`Expected ${opportunity.opportunity_id} to be original/licensed and local-safe.`);
  }
}

const contentRadarCommand = {
  command_id: "cmd_content_radar_analyze_001",
  source: "typed_input",
  requested_action: "analyze_content_pattern",
  natural_language_command: "Analyze this tech discovery pattern and suggest an original remake only.",
  project_context: {
    workspace: "RAIZ_VIDEO",
    project: "RAIZ Content Radar",
    language: "en",
    direction: "ltr"
  },
  payload: {
    content_radar_mode_id: "tech_discovery",
    analysis_goal: "pattern_report",
    content_reference: {
      source_type: "manual_observation",
      label: "desk timer automation demo"
    },
    must_not_download: true,
    must_not_scrape: true,
    must_not_repost: true,
    must_not_publish: true,
    copy_patterns_not_videos: true
  },
  safety: {
    requires_confirmation: false,
    allow_arbitrary_shell: false,
    allowed_paths: ["docs/", "samples/"],
    secrets_in_payload: false,
    audit_log_required: true,
    network_allowed: false
  },
  created_at: "2026-06-20T00:00:06.000Z"
};
validate(commandSchema, contentRadarCommand, "sample Content Radar command");

const contentRadarResult = {
  command_id: contentRadarCommand.command_id,
  action_id: contentRadarCommand.requested_action,
  status: "succeeded",
  summary: "Pattern-only Content Radar analysis completed without scraping or downloading.",
  artifacts: [
    {
      name: "content-pattern-report-example.json",
      path: "samples/content-pattern-report-example.json",
      type: "content_pattern_report",
      exists: true
    }
  ],
  logs: ["Copied pattern structure only; no source video, audio, upload, or shell execution."],
  next_recommended_action: "generate_original_remake_ideas",
  errors: [],
  completed_at: "2026-06-20T00:00:07.000Z"
};
validate(resultSchema, contentRadarResult, "sample Content Radar action result");

const rejectedShellCommand = {
  ...sampleCommand,
  requested_action: "run_shell_command",
  safety: {
    ...sampleCommand.safety,
    allow_arbitrary_shell: true
  }
};

if (compile(commandSchema)(rejectedShellCommand)) {
  throw new Error("Expected command schema to reject arbitrary shell execution.");
}

console.log(`Validated Creative OS local agent contracts: ${sampleCommand.command_id}`);

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function compile(schema) {
  const validator = new Ajv2020({ allErrors: true, strict: true });
  validator.addFormat("date-time", true);
  if (schema.$id !== contentOpportunitySchema.$id) {
    validator.addSchema(contentOpportunitySchema);
  }
  return validator.compile(schema);
}

function validate(schema, value, label) {
  const validator = compile(schema);

  if (!validator(value)) {
    console.error(JSON.stringify(validator.errors, null, 2));
    throw new Error(`Expected valid ${label}.`);
  }
}
