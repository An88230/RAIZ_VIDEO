import type { RaizJob, RaizTemplateEngine } from "@raiz/job-schema";

export type RenderEngineId = RaizTemplateEngine;

export interface PreparedRenderJob {
  jobId: string;
  engine: RenderEngineId;
  job: RaizJob;
  payload: unknown;
  notes?: string[];
}

export interface RenderResult {
  jobId: string;
  engine: RenderEngineId;
  status: "queued" | "processing" | "rendered" | "failed";
  outputPath?: string;
  logs: string[];
}

export interface AdapterHealthCheck {
  name: string;
  passed: boolean;
  severity: "error" | "warning";
  message: string;
}

export interface AdapterHealthReport {
  adapter: RenderEngineId;
  status: "healthy" | "degraded" | "missing";
  vendor_path: string;
  checks: AdapterHealthCheck[];
  metadata: {
    package_name: string | null;
    package_version: string | null;
    detected_files: string[];
  };
  created_at: string;
}

export interface AdapterHealthOptions {
  vendorPath: string;
}

export interface RenderAdapter {
  id: RenderEngineId;
  canRender(job: RaizJob): Promise<boolean>;
  prepare(job: RaizJob): Promise<PreparedRenderJob>;
  render(prepared: PreparedRenderJob): Promise<RenderResult>;
  checkHealth?(options: AdapterHealthOptions): Promise<AdapterHealthReport>;
  cleanup?(jobId: string): Promise<void>;
}
