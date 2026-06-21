import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { createServer } from "./server.js";
import { resolveOrchestratorListenConfig } from "./envConfig.js";

// Load .env (Node 20.12+) so HOST/PORT/RAIZ_API_TOKEN/GEMINI_API_KEY/RAIZ_TTS_PROVIDER
// are available. The key lives only in the gitignored .env file and is never logged.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
for (const envPath of [resolve(repoRoot, ".env"), resolve(process.cwd(), ".env")]) {
  try {
    process.loadEnvFile(envPath);
    break;
  } catch {
    // Try the next candidate; fall back to the ambient environment.
  }
}

const { port, host } = resolveOrchestratorListenConfig();
const server = createServer({ logger: true });

await server.listen({ port, host });
