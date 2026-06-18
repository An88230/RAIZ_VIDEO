import { loadEnvConfig } from "./envConfig.js";

const realRenderFlag = "RAIZ_ENABLE_REAL_RENDER";

export interface ExecutionGuard {
  real_render_enabled: boolean;
  source: typeof realRenderFlag;
  raw_value: string | null;
  policy: "blocked_by_default";
  message: string;
}

export class RealRenderExecutionDisabledError extends Error {
  guard: ExecutionGuard;

  constructor(guard: ExecutionGuard) {
    super(guard.message);
    this.name = "RealRenderExecutionDisabledError";
    this.guard = guard;
  }
}

export function getExecutionGuard(env: NodeJS.ProcessEnv = process.env): ExecutionGuard {
  const config = loadEnvConfig(env);
  const rawValue = env[realRenderFlag] ?? null;

  return {
    real_render_enabled: config.realRenderEnabled,
    source: realRenderFlag,
    raw_value: rawValue,
    policy: "blocked_by_default",
    message: config.realRenderEnabled
      ? "Real render execution is enabled by RAIZ_ENABLE_REAL_RENDER=true."
      : "Real render execution is disabled. Set RAIZ_ENABLE_REAL_RENDER=true to allow it."
  };
}

export function assertRealRenderAllowed(env: NodeJS.ProcessEnv = process.env): ExecutionGuard {
  const guard = getExecutionGuard(env);

  if (!guard.real_render_enabled) {
    throw new RealRenderExecutionDisabledError(guard);
  }

  return guard;
}
