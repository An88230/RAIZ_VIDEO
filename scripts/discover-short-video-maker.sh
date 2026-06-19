#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

VENDOR_PATH="${RAIZ_SHORT_VIDEO_MAKER_VENDOR_PATH:-vendor/short-video-maker}"
OUTPUT_PATH="${RAIZ_SHORT_VIDEO_MAKER_DISCOVERY_DOC:-docs/SHORT_VIDEO_MAKER_RUNTIME_DISCOVERY.md}"

cd "$REPO_ROOT"

if [[ ! -d "$VENDOR_PATH" ]]; then
  echo "[FAIL] vendor path not found: $VENDOR_PATH"
  exit 1
fi

mkdir -p "$(dirname "$OUTPUT_PATH")"

node - "$VENDOR_PATH" "$OUTPUT_PATH" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const vendorPath = process.argv[2];
const outputPath = process.argv[3];

function readText(relativePath) {
  const fullPath = path.join(vendorPath, relativePath);
  return fs.existsSync(fullPath) ? fs.readFileSync(fullPath, "utf8") : "";
}

function readJson(relativePath) {
  const text = readText(relativePath);
  return text ? JSON.parse(text) : null;
}

function listFiles(dir, base = "") {
  const absoluteDir = path.join(dir, base);
  return fs.readdirSync(absoluteDir, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = path.join(base, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === ".git" || entry.name === "node_modules") {
        return [];
      }
      return listFiles(dir, relativePath);
    }
    return relativePath;
  });
}

function unique(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

function markdownList(values, fallback = "- None detected.") {
  return values.length > 0 ? values.map((value) => `- ${value}`).join("\n") : fallback;
}

function codeList(values, fallback = "- None detected.") {
  return values.length > 0 ? values.map((value) => `- \`${value}\``).join("\n") : fallback;
}

function extractExpressRoutes(source, prefix, sourceName) {
  const routes = [];
  const routePattern = /(?:this\.)?(?:app|router)\.(get|post|delete|put|patch)\(\s*["'`]([^"'`]+)["'`]/g;
  let match;

  while ((match = routePattern.exec(source)) !== null) {
    const method = match[1].toUpperCase();
    const routePath = match[2];
    routes.push(`${method} ${prefix}${routePath === "/" ? "" : routePath} (${sourceName})`);
  }

  return routes;
}

function extractRestHttpRoutes(source) {
  const routes = [];
  const routePattern = /^(GET|POST|DELETE|PUT|PATCH)\s+\{\{host\}\}([^\s]+)\s+HTTP\/1\.1/gm;
  let match;

  while ((match = routePattern.exec(source)) !== null) {
    routes.push(`${match[1]} ${match[2]} (rest.http)`);
  }

  return routes;
}

function extractEnvExample(source) {
  return source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => line.split("#")[0].trim())
    .filter(Boolean);
}

const packageJson = readJson("package.json") || {};
const configTs = readText("src/config.ts");
const serverTs = readText("src/server/server.ts");
const restRouterTs = readText("src/server/routers/rest.ts");
const mcpRouterTs = readText("src/server/routers/mcp.ts");
const restHttp = readText("rest.http");
const envExample = readText(".env.example");
const indexTs = readText("src/index.ts");
const files = listFiles(vendorPath);

const packageScripts = Object.entries(packageJson.scripts || {}).map(
  ([name, command]) => `${name}: ${String(command).replace(/\s+/g, " ").trim()}`
);
const dockerFiles = files.filter((file) => /(^|\/)(docker-compose\.ya?ml|compose\..+\.ya?ml|.*Dockerfile|\.dockerignore)$/i.test(file));
const envFiles = files.filter((file) => /(^|\/)\.env(\..*)?$|env.*example/i.test(file));
const envVarsFromConfig = unique([...configTs.matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((match) => match[1]));
const envVarsFromExample = extractEnvExample(envExample);
const defaultPort = configTs.match(/const defaultPort\s*=\s*(\d+)/)?.[1] || null;
const ports = unique([
  defaultPort ? `default config port: ${defaultPort}` : "",
  ...envVarsFromExample.filter((entry) => entry.startsWith("PORT=")).map((entry) => `.env.example ${entry}`),
  ...readText("docker-compose.yml")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^-\s*["']?\d+:\d+["']?/.test(line))
    .map((line) => `docker-compose.yml ${line.replace(/^-\s*/, "")}`),
  ...unique([...restHttp.matchAll(/@host\s*=\s*(.+)$/gm)].map((match) => `rest.http host: ${match[1].trim()}`))
]);
const routes = unique([
  ...extractExpressRoutes(serverTs, "", "src/server/server.ts"),
  ...extractExpressRoutes(restRouterTs, "/api", "src/server/routers/rest.ts"),
  ...extractExpressRoutes(mcpRouterTs, "/mcp", "src/server/routers/mcp.ts"),
  ...extractRestHttpRoutes(restHttp)
]);
const mcpTools = unique([...mcpRouterTs.matchAll(/mcpServer\.tool\(\s*["'`]([^"'`]+)["'`]/g)].map((match) => match[1]));
const startupSignals = [
  indexTs.includes("config.ensureConfig()") ? "Requires configuration validation before server start." : "",
  indexTs.includes("PEXELS_API_KEY") || configTs.includes("PEXELS_API_KEY") ? "Requires PEXELS_API_KEY for normal startup." : "",
  indexTs.includes("Kokoro.init") ? "Initializes Kokoro TTS on startup." : "",
  indexTs.includes("Whisper.init") ? "Initializes Whisper on startup." : "",
  indexTs.includes("Remotion.init") ? "Initializes Remotion on startup." : "",
  indexTs.includes("FFMpeg.init") ? "Initializes FFmpeg on startup." : "",
  indexTs.includes("PexelsAPI") ? "Initializes Pexels API integration on startup." : "",
  indexTs.includes("testRender") ? "Non-Docker startup may run an installation self-test including a Remotion test render." : "",
  indexTs.includes("findVideo") ? "Non-Docker startup self-test may call Pexels." : "",
  serverTs.includes("express.static") ? "Serves built UI/static files from dist/ui and static." : ""
].filter(Boolean);

const markdown = `# short-video-maker Runtime Discovery

This document was generated by \`scripts/discover-short-video-maker.sh\` from a read-only scan of \`${vendorPath}\`.

Safety boundary:
- No dependencies were installed.
- Docker was not started.
- short-video-maker was not started.
- No network request was made by this discovery.
- No file inside \`vendor/\` was modified.

## Package

- Name: \`${packageJson.name || "unknown"}\`
- Version: \`${packageJson.version || "unknown"}\`
- Description: ${packageJson.description || "Not declared."}
- Binary: ${packageJson.bin ? Object.entries(packageJson.bin).map(([name, target]) => `\`${name}\` -> \`${target}\``).join(", ") : "None declared."}

## Package Scripts

${codeList(packageScripts)}

## Runtime Ports

${markdownList(ports)}

## API Routes

${codeList(routes)}

## MCP Tools

${codeList(mcpTools)}

## Docker And Compose Files

${codeList(dockerFiles)}

## Environment Files

${codeList(envFiles)}

## Environment Variables

Detected from \`.env.example\`:

${codeList(envVarsFromExample)}

Detected from \`src/config.ts\`:

${codeList(envVarsFromConfig)}

## Startup Behavior Signals

${markdownList(startupSignals)}

## RAIZ Integration Notes

- The primary REST creation endpoint appears to be \`POST /api/short-video\`.
- Status polling appears to be \`GET /api/short-video/:videoId/status\`.
- Binary output retrieval appears to be \`GET /api/short-video/:videoId\`.
- The default upstream port is \`3123\`.
- Startup requires \`PEXELS_API_KEY\` and initializes video-generation dependencies, so RAIZ should not start this process implicitly.
- For RAIZ, this repository remains reference-only until an explicitly guarded real integration phase.
`;

fs.writeFileSync(outputPath, markdown);
console.log(`[OK] wrote ${outputPath}`);
NODE

echo "[OK] scanned $VENDOR_PATH without modifying vendor."
