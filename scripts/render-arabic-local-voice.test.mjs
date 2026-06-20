#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveVoicePlan } from "./render-arabic-local.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = resolve(repoRoot, "scripts/render-arabic-local.mjs");
const tempRoot = mkdtempSync(resolve(tmpdir(), "raiz-voice-test-"));

try {
  const dryCheck = spawnSync(
    process.execPath,
    [
      scriptPath,
      "--job=samples/valid-arabic-9x16-job.json",
      `--out=${resolve(tempRoot, "dry-check")}`,
      "--dry-voice-check"
    ],
    {
      cwd: repoRoot,
      encoding: "utf8"
    }
  );

  if (dryCheck.status !== 0) {
    throw new Error(`Expected dry voice check to pass: ${dryCheck.stderr || dryCheck.stdout}`);
  }

  if (
    !dryCheck.stderr.includes("[voice][warning]") ||
    !dryCheck.stderr.includes('voice.type="edge_tts"') ||
    !dryCheck.stderr.includes("not implemented") ||
    !dryCheck.stderr.includes("macOS say")
  ) {
    throw new Error("Expected edge_tts dry voice check to print an explicit macOS say fallback warning.");
  }

  const externalVoicePath = resolve(tempRoot, "voice.aiff");
  writeFileSync(externalVoicePath, "fake-aiff");
  const externalPlan = resolveVoicePlan(
    {
      voice: {
        type: "external_file",
        file_path: externalVoicePath
      }
    },
    { repoRoot }
  );

  if (externalPlan.source !== "external_file" || externalPlan.warnings.length !== 0) {
    throw new Error("Expected existing external_file voice to avoid fallback warnings.");
  }

  const missingExternalPlan = resolveVoicePlan(
    {
      voice: {
        type: "external_file",
        file_path: resolve(tempRoot, "missing-voice.aiff")
      }
    },
    { repoRoot }
  );

  if (
    missingExternalPlan.source !== "macos_say_fallback" ||
    !missingExternalPlan.warnings.some((warning) => warning.includes("was not found") && warning.includes("macOS say"))
  ) {
    throw new Error("Expected missing external_file voice to warn before macOS say fallback.");
  }
} finally {
  rmSync(tempRoot, { force: true, recursive: true });
}

console.log("Validated render-arabic-local voice fallback warnings.");
