export type ShortVideoMakerMode = "http";

export interface EnvConfig {
  realRenderEnabled: boolean;
  shortVideoMakerMode: ShortVideoMakerMode;
  shortVideoMakerBaseUrl: string;
  shortVideoMakerRenderPath: string;
  shortVideoMakerTimeoutMs: number;
  shortVideoMakerVendorPath: string;
  storageDir: string;
  ttsProvider: string;
  geminiApiKeyPresent: boolean;
}

export interface OrchestratorListenConfig {
  host: string;
  port: number;
  allowNetworkBind: boolean;
  apiAuthEnabled: boolean;
}

export interface ApiAuthConfig {
  apiAuthEnabled: boolean;
  apiToken: string | null;
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
  shortVideoMakerRenderPath: "/api/short-video",
  shortVideoMakerTimeoutMs: "120000",
  shortVideoMakerVendorPath: "vendor/short-video-maker",
  storageDir: "storage/jobs"
} as const;

const defaultOrchestratorHost = "127.0.0.1";
const defaultOrchestratorPort = "4000";

export function loadEnvConfig(env: NodeJS.ProcessEnv = process.env): EnvConfig {
  const shortVideoMakerMode = env.RAIZ_SHORT_VIDEO_MAKER_MODE ?? defaults.shortVideoMakerMode;
  const timeoutRaw = env.RAIZ_SHORT_VIDEO_MAKER_TIMEOUT_MS ?? defaults.shortVideoMakerTimeoutMs;

  if (shortVideoMakerMode !== "http") {
    throw new EnvConfigError(`Invalid RAIZ_SHORT_VIDEO_MAKER_MODE "${shortVideoMakerMode}". Supported value: http.`);
  }

  if (!/^[1-9]\d*$/.test(timeoutRaw)) {
    throw new EnvConfigError("RAIZ_SHORT_VIDEO_MAKER_TIMEOUT_MS must be a positive integer.");
  }

  const shortVideoMakerRenderPath =
    env.RAIZ_SHORT_VIDEO_MAKER_RENDER_PATH ?? defaults.shortVideoMakerRenderPath;

  if (!shortVideoMakerRenderPath.startsWith("/") || shortVideoMakerRenderPath.trim().length === 1) {
    throw new EnvConfigError("RAIZ_SHORT_VIDEO_MAKER_RENDER_PATH must be an absolute path like /api/short-video.");
  }

  return {
    realRenderEnabled: env.RAIZ_ENABLE_REAL_RENDER === "true",
    shortVideoMakerMode,
    shortVideoMakerBaseUrl: env.RAIZ_SHORT_VIDEO_MAKER_BASE_URL ?? defaults.shortVideoMakerBaseUrl,
    shortVideoMakerRenderPath,
    shortVideoMakerTimeoutMs: Number(timeoutRaw),
    shortVideoMakerVendorPath: env.RAIZ_SHORT_VIDEO_MAKER_VENDOR_PATH ?? defaults.shortVideoMakerVendorPath,
    storageDir: env.RAIZ_STORAGE_DIR ?? defaults.storageDir,
    ttsProvider: (env.RAIZ_TTS_PROVIDER ?? "none").trim().toLowerCase() || "none",
    // Presence only — the key value itself is never read into config, logged, or returned.
    geminiApiKeyPresent: Boolean(env.GEMINI_API_KEY && env.GEMINI_API_KEY.trim())
  };
}

export function loadApiAuthConfig(env: NodeJS.ProcessEnv = process.env): ApiAuthConfig {
  const apiToken = env.RAIZ_API_TOKEN?.trim() || null;

  return {
    apiAuthEnabled: Boolean(apiToken),
    apiToken
  };
}

export function resolveOrchestratorListenConfig(env: NodeJS.ProcessEnv = process.env): OrchestratorListenConfig {
  const host = env.HOST?.trim() || defaultOrchestratorHost;
  const portRaw = env.PORT ?? defaultOrchestratorPort;
  const allowNetworkBind = env.RAIZ_ALLOW_NETWORK_BIND === "true";
  const apiAuth = loadApiAuthConfig(env);

  if (!/^[1-9]\d*$/.test(portRaw)) {
    throw new EnvConfigError("PORT must be a positive integer.");
  }

  if (!isLoopbackHost(host)) {
    if (!allowNetworkBind) {
      throw new EnvConfigError(
        `Refusing to bind orchestrator to non-loopback host "${host}". Set RAIZ_ALLOW_NETWORK_BIND=true to allow it.`
      );
    }

    if (!apiAuth.apiAuthEnabled) {
      throw new EnvConfigError("RAIZ_API_TOKEN is required when binding orchestrator to a non-loopback host.");
    }
  }

  return {
    host,
    port: Number(portRaw),
    allowNetworkBind,
    apiAuthEnabled: apiAuth.apiAuthEnabled
  };
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();

  return (
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized === "[::1]" ||
    normalized === "127.0.0.1" ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(normalized)
  );
}
