#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveBrollPlan, resolveLocalRenderSupportPlan, resolveVoicePlan } from "./render-arabic-local.mjs";

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
      "--dry-check"
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

  for (const expectedWarning of [
    "job.title is accepted by the schema",
    "assets.music is reserved/unsupported",
    'captions.font="Cairo-Bold" is reserved/unsupported',
    'captions.position="center" is reserved/unsupported',
    "captions.burn_in=true is not configurable",
    "output.drive_folder is ignored"
  ]) {
    if (!dryCheck.stderr.includes("[render][warning]") || !dryCheck.stderr.includes(expectedWarning)) {
      throw new Error(`Expected dry render check to warn about unsupported field: ${expectedWarning}`);
    }
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

  const supportPlan = resolveLocalRenderSupportPlan({
    title: "Reserved title",
    language: "en",
    direction: "ltr",
    template: {
      style_preset: "cinematic"
    },
    assets: {
      broll_source: "pixabay",
      music: "storage/audio/music.mp3",
      logo: "storage/logo.png"
    },
    captions: {
      enabled: false,
      format: "none",
      font: "Cairo-Bold",
      position: "top",
      burn_in: false,
      style_preset: "bold"
    },
    output: {
      drive_folder: "local"
    }
  });

  for (const expectedWarning of [
    "assets.logo is reserved/unsupported",
    'assets.broll_source="pixabay" is reserved/unsupported',
    "captions.enabled=false is not implemented",
    'captions.format="none" is reserved/unsupported',
    "captions.burn_in=false is not configurable",
    'captions.style_preset="bold" is reserved/unsupported',
    'template.style_preset="cinematic" is reserved/unsupported',
    'language="en" is accepted by the schema',
    'direction="ltr" is accepted by the schema'
  ]) {
    if (!supportPlan.warnings.some((warning) => warning.includes(expectedWarning))) {
      throw new Error(`Expected render support plan to warn about unsupported field: ${expectedWarning}`);
    }
  }

  const pexelsPlan = resolveBrollPlan(
    { assets: { broll_source: "pexels", search_terms: ["dark desk", "night city"], broll_count: 2 } },
    { repoRoot }
  );

  if (
    pexelsPlan.source !== "pexels" ||
    pexelsPlan.query !== "dark desk" ||
    pexelsPlan.count !== 2 ||
    pexelsPlan.shouldFetch !== true ||
    pexelsPlan.folder !== resolve(repoRoot, "storage/assets/broll/pexels")
  ) {
    throw new Error("Expected pexels b-roll plan to fetch the first search term into the pexels folder.");
  }

  const pexelsNoTerms = resolveBrollPlan({ assets: { broll_source: "pexels" } }, { repoRoot });

  if (
    pexelsNoTerms.shouldFetch !== false ||
    !pexelsNoTerms.warnings.some((warning) => warning.includes("no usable assets.search_terms"))
  ) {
    throw new Error("Expected pexels without search terms to skip the fetch with a warning.");
  }

  const localWithTerms = resolveBrollPlan(
    { assets: { broll_source: "local", broll_folder: "storage/assets/broll", search_terms: ["ignored"] } },
    { repoRoot }
  );

  if (
    localWithTerms.source !== "local" ||
    localWithTerms.shouldFetch !== false ||
    localWithTerms.folder !== resolve(repoRoot, "storage/assets/broll") ||
    !localWithTerms.warnings.some((warning) => warning.includes('ignored unless broll_source is "pexels"'))
  ) {
    throw new Error("Expected local b-roll plan to ignore search terms with a warning.");
  }
} finally {
  rmSync(tempRoot, { force: true, recursive: true });
}

console.log("Validated render-arabic-local voice fallback and unsupported field warnings.");
