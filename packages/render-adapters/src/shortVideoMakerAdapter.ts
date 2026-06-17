import type { RaizJob } from "@raiz/job-schema";

import type { PreparedRenderJob, RenderAdapter, RenderResult } from "./types.js";

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
  }
};
