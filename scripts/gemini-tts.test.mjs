#!/usr/bin/env node

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { generateGeminiTts, pcmToWav } from "./gemini-tts.mjs";

const tempRoot = mkdtempSync(resolve(tmpdir(), "raiz-gemini-test-"));
const silentLogger = { log() {} };

try {
  // pcmToWav writes a valid RIFF/WAVE header.
  const wav = pcmToWav(Buffer.from([1, 2, 3, 4]), { sampleRate: 24000 });
  if (wav.slice(0, 4).toString("ascii") !== "RIFF" || wav.slice(8, 12).toString("ascii") !== "WAVE") {
    throw new Error("Expected pcmToWav to produce a RIFF/WAVE header.");
  }

  // Success path: key goes in a header (not the URL), audio is decoded to WAV.
  const okClient = {
    async postJson(url, headers, body) {
      if (url.includes("key=") || url.includes(headers["x-goog-api-key"] ?? "__none__")) {
        throw new Error("API key must not appear in the request URL.");
      }
      if (headers["x-goog-api-key"] !== "test-key") {
        throw new Error("Expected the API key in the x-goog-api-key header.");
      }
      if (!body?.generationConfig?.responseModalities?.includes("AUDIO")) {
        throw new Error("Expected an AUDIO modality request.");
      }
      return {
        ok: true,
        status: 200,
        json: {
          candidates: [
            { content: { parts: [{ inlineData: { mimeType: "audio/L16;rate=24000", data: Buffer.from("abcd").toString("base64") } }] } }
          ]
        }
      };
    }
  };
  const outPath = resolve(tempRoot, "voiceover.wav");
  const okResult = await generateGeminiTts({ apiKey: "test-key", text: "مرحبا بالعالم", outPath, httpClient: okClient, logger: silentLogger });
  if (!okResult.ok || okResult.status !== "generated" || !existsSync(outPath)) {
    throw new Error("Expected Gemini TTS to write a WAV file on success.");
  }
  if (readFileSync(outPath).slice(0, 4).toString("ascii") !== "RIFF") {
    throw new Error("Expected the generated audio to be a WAV file.");
  }

  // Missing API key fails clearly without any request.
  const missing = await generateGeminiTts({ apiKey: "", text: "x", outPath, httpClient: okClient, logger: silentLogger });
  if (missing.ok || missing.status !== "missing_api_key") {
    throw new Error("Expected a missing API key to fail with missing_api_key.");
  }

  // HTTP error is surfaced, not swallowed into a fake success.
  const errorClient = { async postJson() { return { ok: false, status: 429, json: null, text: "rate limited" }; } };
  const httpError = await generateGeminiTts({ apiKey: "k", text: "x", outPath, httpClient: errorClient, logger: silentLogger });
  if (httpError.ok || httpError.status !== "http_error") {
    throw new Error("Expected an HTTP error to fail with http_error (no fallback).");
  }

  // The API key must never leak into an error message.
  const leakyClient = { async postJson() { throw new Error("network blew up with SUPER-SECRET-KEY in it"); } };
  const leaky = await generateGeminiTts({ apiKey: "SUPER-SECRET-KEY", text: "x", outPath, httpClient: leakyClient, logger: silentLogger });
  if (leaky.ok || leaky.error.includes("SUPER-SECRET-KEY")) {
    throw new Error("Expected the API key to be redacted from error messages.");
  }

  // Empty audio payload is rejected.
  const emptyClient = {
    async postJson() {
      return { ok: true, status: 200, json: { candidates: [{ content: { parts: [{ inlineData: { mimeType: "audio/L16;rate=24000", data: "" } }] } }] } };
    }
  };
  const empty = await generateGeminiTts({ apiKey: "k", text: "x", outPath, httpClient: emptyClient, logger: silentLogger });
  if (empty.ok || !["no_audio", "empty_audio"].includes(empty.status)) {
    throw new Error("Expected an empty audio payload to fail without producing a file.");
  }
} finally {
  rmSync(tempRoot, { force: true, recursive: true });
}

console.log("Validated Gemini TTS client: header-auth, WAV output, no-fallback failures, key redaction.");
