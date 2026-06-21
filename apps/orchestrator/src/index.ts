import { createServer } from "./server.js";
import { resolveOrchestratorListenConfig } from "./envConfig.js";

const { port, host } = resolveOrchestratorListenConfig();
const server = createServer({ logger: true });

await server.listen({ port, host });
