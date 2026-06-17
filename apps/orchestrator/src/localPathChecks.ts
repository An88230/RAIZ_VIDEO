import { access, stat } from "node:fs/promises";

import type { RaizJob } from "@raiz/job-schema";

import type { PreflightCheck } from "./preflight.js";
import type { RenderPlan } from "./renderPlan.js";

interface LocalPathDeclaration {
  name: string;
  path: string;
  expectedType: "file" | "directory";
  missingMessage: string;
}

export async function runLocalPathWarningChecks(job: RaizJob, renderPlan: RenderPlan): Promise<PreflightCheck[]> {
  const declarations = collectLocalPathDeclarations(job, renderPlan);
  const checks = await Promise.all(declarations.map((declaration) => checkLocalPath(declaration)));

  return checks;
}

function collectLocalPathDeclarations(job: RaizJob, renderPlan: RenderPlan): LocalPathDeclaration[] {
  const declarations: LocalPathDeclaration[] = [];

  if (
    (isLocalVoiceProvider(job.voice.provider) || isLocalVoiceProvider(job.voice.type)) &&
    job.voice.file_path &&
    isLocalPath(job.voice.file_path)
  ) {
    declarations.push({
      name: "local_voice_file_exists",
      path: job.voice.file_path,
      expectedType: "file",
      missingMessage: "Local voice file is declared but was not found."
    });
  }

  addAssetDeclaration(declarations, "local_broll_folder_exists", job.assets?.broll_folder, "directory", "Local b-roll folder is declared but was not found.");
  addAssetDeclaration(declarations, "local_music_file_exists", job.assets?.music, "file", "Local music file is declared but was not found.");
  addAssetDeclaration(declarations, "local_logo_file_exists", job.assets?.logo, "file", "Local logo file is declared but was not found.");
  addAssetDeclaration(
    declarations,
    "render_plan_broll_folder_exists",
    renderPlan.assets.broll_folder,
    "directory",
    "Render plan b-roll folder is declared but was not found."
  );
  addAssetDeclaration(
    declarations,
    "render_plan_music_file_exists",
    renderPlan.assets.music,
    "file",
    "Render plan music file is declared but was not found."
  );
  addAssetDeclaration(
    declarations,
    "render_plan_logo_file_exists",
    renderPlan.assets.logo,
    "file",
    "Render plan logo file is declared but was not found."
  );

  return dedupeDeclarations(declarations);
}

async function checkLocalPath(declaration: LocalPathDeclaration): Promise<PreflightCheck> {
  const pathType = await getPathType(declaration.path);
  const passed = pathType === declaration.expectedType;

  return {
    name: declaration.name,
    passed,
    severity: "warning",
    message: passed ? `Local ${declaration.expectedType} exists: ${declaration.path}` : declaration.missingMessage
  };
}

function addAssetDeclaration(
  declarations: LocalPathDeclaration[],
  name: string,
  path: string | null | undefined,
  expectedType: "file" | "directory",
  missingMessage: string
): void {
  if (!path || !isLocalPath(path)) {
    return;
  }

  declarations.push({
    name,
    path,
    expectedType,
    missingMessage
  });
}

function dedupeDeclarations(declarations: LocalPathDeclaration[]): LocalPathDeclaration[] {
  const seen = new Set<string>();

  return declarations.filter((declaration) => {
    const key = `${declaration.name}:${declaration.path}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function isLocalVoiceProvider(provider: string | undefined): boolean {
  return provider === "external_file" || provider === "local_file";
}

function isLocalPath(path: string): boolean {
  return !/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(path);
}

async function getPathType(path: string): Promise<"file" | "directory" | "missing"> {
  try {
    await access(path);
    const pathStats = await stat(path);

    if (pathStats.isDirectory()) {
      return "directory";
    }

    if (pathStats.isFile()) {
      return "file";
    }

    return "missing";
  } catch {
    return "missing";
  }
}
