import type { RaizJob } from "@raiz/job-schema";
import { access, readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

import type {
  AdapterHealthCheck,
  AdapterHealthOptions,
  AdapterHealthReport,
  PreparedRenderJob,
  RenderAdapter,
  RenderResult
} from "./types.js";

const adapterId = "short_video_maker" as const;

export const shortVideoMakerAdapter: RenderAdapter = {
  id: adapterId,

  async canRender(job: RaizJob): Promise<boolean> {
    return job.template.engine === adapterId;
  },

  async prepare(job: RaizJob): Promise<PreparedRenderJob> {
    if (!(await this.canRender(job))) {
      throw new Error(`Adapter ${adapterId} cannot prepare engine ${job.template.engine}.`);
    }

    return {
      jobId: job.job_id,
      engine: adapterId,
      job,
      payload: {
        job_id: job.job_id,
        template_id: job.template.template_id,
        title: job.title,
        script: job.script,
        voice: job.voice,
        assets: job.assets,
        captions: job.captions,
        output: job.output
      },
      notes: ["Phase 1 contract only. short-video-maker is not called yet."]
    };
  },

  async render(prepared: PreparedRenderJob): Promise<RenderResult> {
    return {
      jobId: prepared.jobId,
      engine: adapterId,
      status: "queued",
      logs: ["Mock queued. Real short-video-maker rendering is disabled in phase 1."]
    };
  },

  async checkHealth(options: AdapterHealthOptions): Promise<AdapterHealthReport> {
    return checkShortVideoMakerHealth(options);
  }
};

export async function checkShortVideoMakerHealth(options: AdapterHealthOptions): Promise<AdapterHealthReport> {
  const vendorPath = resolve(options.vendorPath);
  const checks: AdapterHealthCheck[] = [];
  const detectedFiles: string[] = [];
  let packageName: string | null = null;
  let packageVersion: string | null = null;

  if (!(await pathExists(vendorPath))) {
    return {
      adapter: adapterId,
      status: "missing",
      vendor_path: vendorPath,
      checks: [
        {
          name: "vendor_path_exists",
          passed: false,
          severity: "error",
          message: "Vendor path does not exist."
        }
      ],
      metadata: {
        package_name: null,
        package_version: null,
        detected_files: []
      },
      created_at: new Date().toISOString()
    };
  }

  const vendorPathStats = await stat(vendorPath);
  const fileNames = vendorPathStats.isDirectory() ? await readdir(vendorPath) : [];
  checks.push({
    name: "vendor_path_exists",
    passed: vendorPathStats.isDirectory(),
    severity: "error",
    message: vendorPathStats.isDirectory() ? "Vendor path exists." : "Vendor path is not a directory."
  });
  checks.push({
    name: "vendor_path_name",
    passed: basename(vendorPath) === "short-video-maker" && basename(dirname(vendorPath)) === "vendor",
    severity: "warning",
    message: "Vendor path points to vendor/short-video-maker."
  });

  const packageJsonCheck = await checkFile(vendorPath, "package.json", fileNames);
  checks.push(packageJsonCheck);

  if (packageJsonCheck.passed) {
    detectedFiles.push("package.json");
    const packageJson = JSON.parse(await readFile(resolve(vendorPath, "package.json"), "utf8")) as {
      name?: string;
      version?: string;
    };
    packageName = packageJson.name ?? null;
    packageVersion = packageJson.version ?? null;
  }

  addDetectedFile(detectedFiles, "README.md", fileNames);
  addDetectedFile(detectedFiles, "docker-compose.yml", fileNames);

  const dockerfileNames = fileNames.filter((fileName) => fileName === "Dockerfile" || fileName.endsWith(".Dockerfile"));
  detectedFiles.push(...dockerfileNames);
  checks.push(checkPresent("readme_exists", fileNames.includes("README.md"), "README.md is present."));
  checks.push(
    checkPresent(
      "dockerfile_exists",
      dockerfileNames.length > 0,
      dockerfileNames.length > 0 ? `Dockerfile variant present: ${dockerfileNames.join(", ")}.` : "No Dockerfile variant was found."
    )
  );
  checks.push(
    checkPresent(
      "compose_file_exists",
      fileNames.some((fileName) => fileName === "docker-compose.yml" || /^compose\..+ya?ml$/.test(fileName)),
      "Docker Compose file is present."
    )
  );

  const hasError = checks.some((check) => check.severity === "error" && !check.passed);
  const hasWarning = checks.some((check) => check.severity === "warning" && !check.passed);

  return {
    adapter: adapterId,
    status: hasError ? "missing" : hasWarning ? "degraded" : "healthy",
    vendor_path: vendorPath,
    checks,
    metadata: {
      package_name: packageName,
      package_version: packageVersion,
      detected_files: [...new Set(detectedFiles)].sort()
    },
    created_at: new Date().toISOString()
  };
}

async function checkFile(vendorPath: string, fileName: string, fileNames: string[]): Promise<AdapterHealthCheck> {
  return checkPresent(`${fileName.replace(/[^a-zA-Z0-9]+/g, "_")}_exists`, fileNames.includes(fileName), `${fileName} is present.`);
}

function checkPresent(name: string, passed: boolean, message: string): AdapterHealthCheck {
  return {
    name,
    passed,
    severity: passed ? "warning" : "warning",
    message
  };
}

function addDetectedFile(detectedFiles: string[], fileName: string, fileNames: string[]): void {
  if (fileNames.includes(fileName)) {
    detectedFiles.push(fileName);
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
