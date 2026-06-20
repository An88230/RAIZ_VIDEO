import type { RaizJob } from "@raiz/job-schema";

import type { PreparedRenderJob, RenderAdapter, RenderResult } from "./types.js";

const adapterId = "remotion_direct" as const;

export const remotionDirectAdapter: RenderAdapter = {
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
        output: job.output,
        render_mode: "queued_only"
      },
      notes: [
        "Queue-only adapter for /jobs/render.",
        "Real Remotion rendering is guarded separately by RAIZ_ENABLE_REAL_RENDER and /jobs/:id/render/remotion-direct."
      ]
    };
  },

  async render(prepared: PreparedRenderJob): Promise<RenderResult> {
    return {
      jobId: prepared.jobId,
      engine: adapterId,
      status: "queued",
      logs: [
        "Mock queued. /jobs/render does not execute Remotion.",
        "Use the guarded remotion-direct render route only when real rendering is explicitly enabled."
      ]
    };
  }
};
