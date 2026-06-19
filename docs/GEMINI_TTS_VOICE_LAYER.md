# Gemini TTS Voice Layer

Gemini TTS is the official RAIZ voice layer. ElevenLabs is not part of the RAIZ
voice path.

Phase 37 defines the contract only. It does not implement Gemini calls.

## Two Voice Modes

### Live UI Speech

Creative OS may use Gemini TTS to speak responses in the UI. This voice is
ephemeral, optimized for interaction, and does not become a render asset.

### Render Voice

RAIZ_VIDEO render voice must be saved as a local job asset by the future Local
Agent:

```text
storage/jobs/{job_id}/assets/voice/voice.wav
storage/jobs/{job_id}/assets/voice/gemini-tts-manifest.json
```

The render pipeline should consume the saved voice file as a deterministic local
asset.

## Input Contract

```json
{
  "job_id": "creative-arabic-lexicon-001",
  "text": "Arabic narration text",
  "language": "ar",
  "voice_name": "gemini-arabic-voice",
  "speaking_style": "calm, intimate, cinematic",
  "output_format": "wav"
}
```

## Output Contract

```json
{
  "job_id": "creative-arabic-lexicon-001",
  "provider": "gemini_tts",
  "status": "generated",
  "voice_path": "storage/jobs/creative-arabic-lexicon-001/assets/voice/voice.wav",
  "manifest_path": "storage/jobs/creative-arabic-lexicon-001/assets/voice/gemini-tts-manifest.json",
  "language": "ar",
  "voice_name": "gemini-arabic-voice",
  "speaking_style": "calm, intimate, cinematic",
  "output_format": "wav",
  "created_at": "..."
}
```

## Manifest

`gemini-tts-manifest.json` should include:

- `job_id`
- provider: `gemini_tts`
- model name
- voice name
- language
- speaking style
- text hash
- output format
- output path
- duration if available
- created timestamp
- safety flags

## Fallback Behavior

If Gemini TTS fails, the Local Agent must:

1. Return `creative_os_action_result.status = "failed"`.
2. Write no fake voice file.
3. Preserve the requested text and error summary in logs.
4. Recommend one next action:
   - retry Gemini TTS
   - use an existing local voice file
   - continue with `voice.type = "none"` only if Nabil confirms

The system must not silently switch to ElevenLabs or any undeclared provider.

## Key Boundary

The Gemini API key is read by the future Local Agent from local `.env`, for
example:

```text
GEMINI_API_KEY=...
```

The browser UI sends command payloads only. It does not store or transmit
production secrets.
