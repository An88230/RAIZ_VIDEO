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
const sampleCommand = readJson(resolve(repoRoot, "samples/creative-os-command-render-arabic.json"));
const showModeTrigger = readJson(resolve(repoRoot, "samples/show-mode-double-clap-trigger.json"));
const showModeSystemQuestion = readJson(resolve(repoRoot, "samples/show-mode-system-status-question.json"));
const showModePublishQuestion = readJson(resolve(repoRoot, "samples/show-mode-publish-status-question.json"));

const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addFormat("date-time", true);

validate(commandSchema, sampleCommand, "sample Creative OS command");
validate(showModeTriggerSchema, showModeTrigger, "sample Show Mode trigger");
validate(commandSchema, showModeSystemQuestion, "sample Show Mode system status question");
validate(commandSchema, showModePublishQuestion, "sample Show Mode publish status question");

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
  return validator.compile(schema);
}

function validate(schema, value, label) {
  const validator = compile(schema);

  if (!validator(value)) {
    console.error(JSON.stringify(validator.errors, null, 2));
    throw new Error(`Expected valid ${label}.`);
  }
}
