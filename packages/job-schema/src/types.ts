export type RaizPlatform = "youtube_shorts" | "instagram_reels" | "tiktok" | "local_only";
export type RaizTemplateEngine =
  | "short_video_maker"
  | "remotion_direct"
  | "money_printer_turbo"
  | "editly"
  | "ffmpeg_only";
export type RaizVoiceType = "external_file" | "edge_tts" | "elevenlabs" | "azure" | "none";
export type RaizCaptionFormat = "srt" | "ass" | "none";
export type RaizCaptionPosition = "top" | "center" | "bottom";
export type RaizPublishMode = "review_first" | "private" | "scheduled" | "manual_only";

export interface RaizJob {
  job_id: string;
  platform: RaizPlatform;
  aspect_ratio: "9:16";
  resolution: {
    width: 1080;
    height: 1920;
  };
  language: "ar" | "en";
  direction: "rtl" | "ltr";
  title: string;
  hook?: string;
  script: string;
  template: {
    engine: RaizTemplateEngine;
    template_id: string;
    style_preset?: string;
  };
  voice: {
    type: RaizVoiceType;
    provider?: string;
    voice_name?: string;
    file_path?: string;
  };
  assets?: {
    broll_source?: "google_drive" | "local" | "pexels" | "pixabay" | "none";
    broll_folder?: string;
    search_terms?: string[];
    broll_count?: number;
    music?: string;
    logo?: string;
  };
  captions: {
    enabled: boolean;
    format: RaizCaptionFormat;
    font?: string;
    burn_in: boolean;
    position?: RaizCaptionPosition;
    style_preset?: string;
  };
  output: {
    drive_folder?: string;
    filename: string;
  };
  publish: {
    youtube: boolean;
    mode: RaizPublishMode;
    scheduled_time?: string;
    description?: string;
    tags?: string[];
  };
}
