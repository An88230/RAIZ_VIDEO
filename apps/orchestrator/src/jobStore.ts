import type { RaizJob, RaizTemplateEngine } from "@raiz/job-schema";

export type OrchestratorJobStatus = "queued" | "processing" | "rendered" | "failed";

export interface StoredJob {
  job_id: string;
  status: OrchestratorJobStatus;
  engine: RaizTemplateEngine;
  created_at: string;
  updated_at: string;
  logs: string[];
}

export class JobStore {
  private readonly jobs = new Map<string, StoredJob>();

  queue(job: RaizJob, logs: string[] = []): StoredJob {
    const now = new Date().toISOString();
    const storedJob: StoredJob = {
      job_id: job.job_id,
      status: "queued",
      engine: job.template.engine,
      created_at: this.jobs.get(job.job_id)?.created_at ?? now,
      updated_at: now,
      logs
    };

    this.jobs.set(job.job_id, storedJob);
    return storedJob;
  }

  get(jobId: string): StoredJob | undefined {
    return this.jobs.get(jobId);
  }
}
