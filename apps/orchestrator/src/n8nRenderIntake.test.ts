import { mapN8nRenderPayloadToRaizJob, N8nRenderPayloadValidationError } from "./n8nRenderIntake.js";

function expectValidationError(fn: () => unknown, label: string): void {
  let threw = false;

  try {
    fn();
  } catch (error) {
    threw = true;

    if (!(error instanceof N8nRenderPayloadValidationError)) {
      throw new Error(`${label}: expected N8nRenderPayloadValidationError, got ${String(error)}`);
    }
  }

  if (!threw) {
    throw new Error(`${label}: expected the mapping to throw.`);
  }
}

// 1. A multi-line voiceover that repeats the captions/scenes must NOT double the
// script (this was the source of captions rendering twice across the timeline).
const duplicatedPayload = {
  video_id: "n8n-dedupe-001",
  duration: 45,
  voiceover: "سطر أول\nسطر ثانٍ\nسطر ثالث",
  captions: ["سطر أول", "سطر ثانٍ", "سطر ثالث"],
  scenes: [{ caption: "سطر أول" }]
};
const dedupeJob = mapN8nRenderPayloadToRaizJob(duplicatedPayload);
const scriptLines = dedupeJob.script.split("\n");

if (scriptLines.length !== 3 || new Set(scriptLines).size !== 3) {
  throw new Error(`Expected a deduped 3-line script, got ${scriptLines.length}: ${JSON.stringify(scriptLines)}`);
}

// 2. voiceover text but no audio_url => voice.type "none". The render layer then
// ships no audio track rather than a silent stream presented as success.
const noAudioJob = mapN8nRenderPayloadToRaizJob({
  video_id: "n8n-noaudio-001",
  voiceover: "نص بدون رابط صوت",
  captions: ["نص بدون رابط صوت"]
});

if (noAudioJob.voice.type !== "none") {
  throw new Error(`Expected voice.type "none" without an audio_url, got ${noAudioJob.voice.type}.`);
}

// 3. A real audio_url maps to an external_file voice carrying the URL.
const audioUrl = "https://example.test/voice.wav";
const audioJob = mapN8nRenderPayloadToRaizJob({
  video_id: "n8n-audio-001",
  voiceover: "مع صوت",
  captions: ["مع صوت"],
  audio_url: audioUrl
});

if (audioJob.voice.type !== "external_file" || (audioJob.voice as { audio_url?: string }).audio_url !== audioUrl) {
  throw new Error("Expected audio_url to map to an external_file voice with the URL preserved.");
}

// 3b. A file: audio_url is accepted and mapped to an external_file voice.
const fileAudioJob = mapN8nRenderPayloadToRaizJob({
  video_id: "n8n-fileaudio-001",
  captions: ["مع صوت محلي"],
  audio_url: "file:samples/assets/raiz-sample-voice.m4a"
});

if (
  fileAudioJob.voice.type !== "external_file" ||
  (fileAudioJob.voice as { audio_url?: string }).audio_url !== "file:samples/assets/raiz-sample-voice.m4a"
) {
  throw new Error("Expected a file: audio_url to map to an external_file voice.");
}

// 4. A missing video_id must fail before any render runs.
expectValidationError(
  () => mapN8nRenderPayloadToRaizJob({ voiceover: "بدون معرّف", captions: ["بدون معرّف"] }),
  "missing video_id"
);

// 5. A non-object payload must fail (no silent fallback).
expectValidationError(() => mapN8nRenderPayloadToRaizJob("not-an-object"), "non-object payload");

console.log("Validated n8n render payload mapping: script dedupe, audio mapping, and video_id guard.");
