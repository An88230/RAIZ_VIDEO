#!/usr/bin/env node
// Gemini TTS client for RAIZ. Generates real Arabic voice-over from text.
//
// Safety:
//   - GEMINI_API_KEY is read by the caller from the environment only.
//   - The key is sent as the `x-goog-api-key` header, never in the URL.
//   - The key is never logged; error messages are redacted defensively.
//   - The HTTP client is injectable so `npm test` runs fully offline.

import { writeFileSync } from "node:fs";

const DEFAULT_MODEL = "gemini-2.5-flash-preview-tts";
const DEFAULT_VOICE = "Kore";
const endpointFor = (model) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

export function createGeminiHttpClient() {
  return {
    async postJson(url, headers, body) {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body)
      });
      const text = await response.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
      return { ok: response.ok, status: response.status, json, text };
    }
  };
}

// Wrap raw PCM (s16le) audio in a minimal WAV container.
export function pcmToWav(pcm, { sampleRate = 24000, channels = 1, bitsPerSample = 16 } = {}) {
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function parseSampleRate(mimeType, fallback = 24000) {
  const match = /rate=(\d+)/.exec(mimeType ?? "");
  return match ? Number(match[1]) : fallback;
}

function redact(message, secret) {
  if (!message || !secret) {
    return message ?? "";
  }
  return String(message).split(secret).join("[REDACTED]");
}

export async function generateGeminiTts({
  apiKey,
  text,
  outPath,
  model = DEFAULT_MODEL,
  voiceName = DEFAULT_VOICE,
  httpClient = createGeminiHttpClient(),
  logger = console
}) {
  if (!apiKey || !String(apiKey).trim()) {
    return { ok: false, status: "missing_api_key", error: "GEMINI_API_KEY is not set." };
  }

  if (!text || !String(text).trim()) {
    return { ok: false, status: "empty_text", error: "No voice-over text was provided for Gemini TTS." };
  }

  const body = {
    contents: [{ parts: [{ text: String(text) }] }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceName || DEFAULT_VOICE } } }
    }
  };

  let response;
  try {
    // Key in a header — never in the URL, never logged.
    response = await httpClient.postJson(endpointFor(model), { "x-goog-api-key": apiKey }, body);
  } catch (error) {
    return { ok: false, status: "request_failed", error: `Gemini TTS request failed: ${redact(error.message, apiKey)}` };
  }

  if (!response.ok) {
    return { ok: false, status: "http_error", httpStatus: response.status, error: `Gemini TTS returned HTTP ${response.status}.` };
  }

  const parts = response.json?.candidates?.[0]?.content?.parts ?? [];
  const inline = parts.find((part) => part?.inlineData?.data)?.inlineData;

  if (!inline?.data) {
    return { ok: false, status: "no_audio", error: "Gemini TTS response contained no audio data." };
  }

  const pcm = Buffer.from(inline.data, "base64");
  if (pcm.length === 0) {
    return { ok: false, status: "empty_audio", error: "Gemini TTS returned an empty audio payload." };
  }

  const wav = pcmToWav(pcm, { sampleRate: parseSampleRate(inline.mimeType) });
  writeFileSync(outPath, wav);
  logger.log(`[tts][gemini] wrote ${wav.length} bytes -> ${outPath}`);

  return { ok: true, status: "generated", path: outPath, bytes: wav.length };
}
