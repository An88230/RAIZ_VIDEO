import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadEnvConfig } from "./envConfig.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

// Presence flag is true with a key — and the key VALUE never appears in config.
const withKey = loadEnvConfig({ GEMINI_API_KEY: "SUPER-SECRET-VALUE", RAIZ_TTS_PROVIDER: "Gemini" });

if (withKey.geminiApiKeyPresent !== true || withKey.ttsProvider !== "gemini") {
  throw new Error("Expected geminiApiKeyPresent=true and ttsProvider=gemini.");
}

if (JSON.stringify(withKey).includes("SUPER-SECRET-VALUE")) {
  throw new Error("GEMINI_API_KEY value must never appear in the config object.");
}

const withoutKey = loadEnvConfig({});

if (withoutKey.geminiApiKeyPresent !== false || withoutKey.ttsProvider !== "none") {
  throw new Error("Expected geminiApiKeyPresent=false and ttsProvider=none without env.");
}

// .env must be gitignored, and .env.example must not carry a real key.
const gitignore = readFileSync(resolve(repoRoot, ".gitignore"), "utf8");
if (!/^\.env$/m.test(gitignore)) {
  throw new Error("Expected .env to be listed in .gitignore.");
}

const envExample = readFileSync(resolve(repoRoot, ".env.example"), "utf8");
if (!/^GEMINI_API_KEY=\s*$/m.test(envExample)) {
  throw new Error("Expected .env.example to declare an empty GEMINI_API_KEY (no secret).");
}

console.log("Validated env config: Gemini key presence flag, no key leakage, .env gitignored.");
