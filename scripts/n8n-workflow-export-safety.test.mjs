#!/usr/bin/env node

import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workflowDir = resolve(repoRoot, "workflows/n8n/nabil8855-workflows");
const forbiddenTerms = ["credentials", "apikey", "secret", "password", "token"];
const workflowFiles = readdirSync(workflowDir)
  .filter((fileName) => fileName.endsWith(".json"))
  .sort();

if (workflowFiles.length === 0) {
  throw new Error("Expected at least one n8n workflow export JSON file.");
}

for (const fileName of workflowFiles) {
  const filePath = resolve(workflowDir, fileName);
  const raw = readFileSync(filePath, "utf8");

  JSON.parse(raw);

  const normalized = raw.toLowerCase();
  const forbiddenTerm = forbiddenTerms.find((term) => normalized.includes(term));

  if (forbiddenTerm) {
    throw new Error(`n8n workflow export ${fileName} contains forbidden term "${forbiddenTerm}".`);
  }
}

const shortsWorkflow = readWorkflow("8wULkx50U7yc1wNX-RAIZ_Shorts_Factory_YouTube_Shorts_Pipeline.json");
const sendRenderJob = findNode(shortsWorkflow, "Send Render Job");
const buildShortsPackage = findNode(shortsWorkflow, "Build Shorts Package");
const downloadRenderedVideo = findNode(shortsWorkflow, "Download Rendered Video");
const uploadToYouTube = findNode(shortsWorkflow, "Upload to YouTube Shorts");

if (!String(sendRenderJob.parameters?.url).includes("/integrations/n8n/render/remotion-direct")) {
  throw new Error("Expected n8n Send Render Job node to target the RAIZ n8n Remotion intake endpoint.");
}

if (String(sendRenderJob.parameters?.url).includes("example-render-api.com")) {
  throw new Error("Expected n8n Send Render Job node not to use the placeholder render API URL.");
}

if (sendRenderJob.disabled !== true || downloadRenderedVideo.disabled !== true || uploadToYouTube.disabled !== true) {
  throw new Error("Expected n8n render/download/publish nodes to remain disabled in source-controlled exports.");
}

const buildCode = String(buildShortsPackage.parameters?.jsCode ?? "");

for (const requiredSnippet of [
  "const videoId = payload.video_id || payload.idea_id || generatedId;",
  "video_id: videoId",
  "format: payload.format || '9:16'",
  "width: 1080",
  "height: 1920"
]) {
  if (!buildCode.includes(requiredSnippet)) {
    throw new Error(`Expected Build Shorts Package to include n8n render contract snippet: ${requiredSnippet}`);
  }
}

const renderBatchWorkflow = readWorkflow("Zd8S487NWzzwx7V9-RAIZ_Render_Batch_v2.json");
const renderBatchPlan = findNode(renderBatchWorkflow, "Build Render Batch Plan");

if (!String(renderBatchPlan.parameters?.jsCode ?? "").includes("/integrations/n8n/render/remotion-direct")) {
  throw new Error("Expected render batch plan to reference the RAIZ n8n Remotion intake endpoint.");
}

console.log(`Validated sanitized n8n workflow exports: ${workflowFiles.length}`);

function readWorkflow(fileName) {
  return JSON.parse(readFileSync(resolve(workflowDir, fileName), "utf8"));
}

function findNode(workflow, nodeName) {
  const node = workflow.nodes?.find((candidate) => candidate.name === nodeName);

  if (!node) {
    throw new Error(`Expected workflow ${workflow.name ?? "unknown"} to contain node "${nodeName}".`);
  }

  return node;
}
