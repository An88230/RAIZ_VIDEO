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

export interface RenderAdapter {
  id: RenderEngineId;
  canRender(job: RaizJob): Promise<boolean>;
  prepare(job: RaizJob): Promise<PreparedRenderJob>;
  render(prepared: PreparedRenderJob): Promise<RenderResult>;
  cleanup?(jobId: string): Promise<void>;
}
