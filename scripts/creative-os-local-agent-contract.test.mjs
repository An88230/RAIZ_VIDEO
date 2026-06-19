#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const commandSchema = readJson(resolve(repoRoot, "creative_os_command.schema.json"));
const resultSchema = readJson(resolve(repoRoot, "creative_os_action_result.schema.json"));
const sampleCommand = readJson(resolve(repoRoot, "samples/creative-os-command-render-arabic.json"));

const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addFormat("date-time", true);

validate(commandSchema, sampleCommand, "sample Creative OS command");

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
