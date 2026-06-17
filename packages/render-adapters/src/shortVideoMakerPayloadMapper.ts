import type { RaizJob } from "@raiz/job-schema";

export interface ShortVideoMakerRenderPlanInput {
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

export interface ShortVideoMakerPreflightReportInput {
  job_id: string;
  status: "passed" | "failed";
  created_at: string;
}

export interface ShortVideoMakerPayloadInput {
  job: RaizJob;
  renderPlan: ShortVideoMakerRenderPlanInput;
  preflightReport: ShortVideoMakerPreflightReportInput;
}

export interface ShortVideoMakerPayload {
  adapter: "short_video_maker";
  job_id: string;
  composition: {
    aspect_ratio: "9:16";
    width: 1080;
    height: 1920;
    language: "ar" | "en";
    direction: "rtl" | "ltr";
    template_id: string;
  };
  script: {
    title: string;
    text: string;
    hook: string | null;
  };
  voice: {
    provider: string | null;
    voice_name: string | null;
  };
  captions: {
    enabled: boolean;
    format: string;
    burn_in: boolean;
  };
  assets: {
    summary: Record<string, string | null>;
    declared: Record<string, unknown>;
  };
  output: {
    filename: string;
    local_path: string;
  };
  metadata: {
    source: "raiz_video_factory";
    engine: "remotion";
    created_at: string;
  };
}

export function mapToShortVideoMakerPayload(input: ShortVideoMakerPayloadInput): ShortVideoMakerPayload {
  const { job, renderPlan } = input;

  return {
    adapter: "short_video_maker",
    job_id: job.job_id,
    composition: {
      aspect_ratio: renderPlan.aspect_ratio,
      width: renderPlan.width,
      height: renderPlan.height,
      language: renderPlan.language,
      direction: renderPlan.direction,
      template_id: renderPlan.template_id
    },
    script: {
      title: job.title,
      text: job.script,
      hook: job.hook ?? null
    },
    voice: {
      provider: renderPlan.voice.provider,
      voice_name: renderPlan.voice.voice_name
    },
    captions: {
      enabled: renderPlan.captions.enabled,
      format: renderPlan.captions.format,
      burn_in: renderPlan.captions.burn_in
    },
    assets: {
      summary: renderPlan.assets,
      declared: job.assets ?? {}
    },
    output: {
      filename: renderPlan.output.filename,
      local_path: renderPlan.output.local_path
    },
    metadata: {
      source: "raiz_video_factory",
      engine: renderPlan.engine,
      created_at: renderPlan.created_at
    }
  };
}
