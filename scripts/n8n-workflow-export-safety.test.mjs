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

console.log(`Validated sanitized n8n workflow exports: ${workflowFiles.length}`);
