import type { RaizJob } from "@raiz/job-schema";
import { resolve } from "node:path";

export interface RenderPlan {
  job_id: string;
  adapter: "short_video_maker";
  engine: "remotion";
  aspect_ratio: "9:16";
  width: 1080;
  height: 1920;
  language: "ar" | "en";
  direction: "rtl" | "ltr";
  template_id: string;
  voice: {
    provider: string | null;
    voice_name: string | null;
  };
  captions: RaizJob["captions"];
  assets: {
    broll_source: string | null;
    broll_folder: string | null;
    music: string | null;
    logo: string | null;
  };
  output: {
    filename: string;
    local_path: string;
  };
  created_at: string;
}

export interface PrepareRenderPlanOptions {
  outputLocalPath?: string;
  createdAt?: string;
}

export function prepareRenderPlan(job: RaizJob, options: PrepareRenderPlanOptions = {}): RenderPlan {
  return {
    job_id: job.job_id,
    adapter: "short_video_maker",
    engine: "remotion",
    aspect_ratio: job.aspect_ratio,
    width: 1080,
    height: 1920,
    language: job.language,
    direction: job.direction,
    template_id: job.template.template_id,
    voice: {
      provider: job.voice.provider ?? null,
      voice_name: job.voice.voice_name ?? null
    },
    captions: job.captions,
    assets: {
      broll_source: job.assets?.broll_source ?? null,
      broll_folder: job.assets?.broll_folder ?? null,
      music: job.assets?.music ?? null,
      logo: job.assets?.logo ?? null
    },
    output: {
      filename: job.output.filename,
      local_path: options.outputLocalPath ?? resolve("storage", "jobs", job.job_id, "output", job.output.filename)
    },
    created_at: options.createdAt ?? new Date().toISOString()
  };
}
