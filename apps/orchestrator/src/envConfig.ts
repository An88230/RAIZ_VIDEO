export type ShortVideoMakerMode = "http";

export interface EnvConfig {
  realRenderEnabled: boolean;
  shortVideoMakerMode: ShortVideoMakerMode;
  shortVideoMakerBaseUrl: string;
  shortVideoMakerTimeoutMs: number;
  shortVideoMakerVendorPath: string;
  storageDir: string;
}

export class EnvConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvConfigError";
  }
}

const defaults = {
  enableRealRender: "false",
  shortVideoMakerMode: "http",
  shortVideoMakerBaseUrl: "http://localhost:3123",
  shortVideoMakerTimeoutMs: "120000",
  shortVideoMakerVendorPath: "vendor/short-video-maker",
  storageDir: "storage/jobs"
} as const;

export function loadEnvConfig(env: NodeJS.ProcessEnv = process.env): EnvConfig {
  const shortVideoMakerMode = env.RAIZ_SHORT_VIDEO_MAKER_MODE ?? defaults.shortVideoMakerMode;
  const timeoutRaw = env.RAIZ_SHORT_VIDEO_MAKER_TIMEOUT_MS ?? defaults.shortVideoMakerTimeoutMs;

  if (shortVideoMakerMode !== "http") {
    throw new EnvConfigError(`Invalid RAIZ_SHORT_VIDEO_MAKER_MODE "${shortVideoMakerMode}". Supported value: http.`);
  }

  if (!/^[1-9]\d*$/.test(timeoutRaw)) {
    throw new EnvConfigError("RAIZ_SHORT_VIDEO_MAKER_TIMEOUT_MS must be a positive integer.");
  }

  return {
    realRenderEnabled: env.RAIZ_ENABLE_REAL_RENDER === "true",
    shortVideoMakerMode,
    shortVideoMakerBaseUrl: env.RAIZ_SHORT_VIDEO_MAKER_BASE_URL ?? defaults.shortVideoMakerBaseUrl,
    shortVideoMakerTimeoutMs: Number(timeoutRaw),
    shortVideoMakerVendorPath: env.RAIZ_SHORT_VIDEO_MAKER_VENDOR_PATH ?? defaults.shortVideoMakerVendorPath,
    storageDir: env.RAIZ_STORAGE_DIR ?? defaults.storageDir
  };
}
