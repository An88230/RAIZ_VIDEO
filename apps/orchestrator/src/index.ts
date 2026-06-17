import { createServer } from "./server.js";

const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? "0.0.0.0";
const server = createServer({ logger: true });

await server.listen({ port, host });
