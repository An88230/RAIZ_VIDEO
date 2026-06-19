# short-video-maker Connection Contract

This document is based on a read-only inspection of `vendor/short-video-maker`. No dependencies were installed, Docker was not started, short-video-maker was not started, and no video was rendered.

## Runtime Summary

- Package: `short-video-maker`
- Version: `1.3.4`
- Server type: Express REST API plus MCP SSE endpoints.
- Default port: `3123`
- Health endpoint: `GET /health`
- Render submit endpoint: `POST /api/short-video`
- Status endpoint: `GET /api/short-video/{videoId}/status`
- Output retrieval endpoint: `GET /api/short-video/{videoId}`
- List videos endpoint: `GET /api/short-videos`
- Delete video endpoint: `DELETE /api/short-video/{videoId}`
- Voices endpoint: `GET /api/voices`
- Music tags endpoint: `GET /api/music-tags`

## Install And Run Commands

No install or run command was executed during discovery.

Observed package scripts:

```text
build: rimraf dist && tsc --project tsconfig.build.json && vite build
dev: vite build --watch | node --watch -r ts-node/register src/index.ts
start: node dist/index.js
test: vitest
```

Docker is the upstream recommended runtime in the README, but RAIZ must not start Docker automatically.

For future manual npm-based upstream setup, the repository contains `pnpm-lock.yaml`, Dockerfiles use `pnpm install`, and `npm start` maps to `node dist/index.js` only after a build exists.

## Required Environment

Required:

```text
PEXELS_API_KEY
```

Common/default variables:

```text
PORT=3123
LOG_LEVEL=info
WHISPER_VERBOSE=false
DATA_DIR_PATH=~/.ai-agents-az-video-generator
```

Docker images set:

```text
DATA_DIR_PATH=/app/data
DOCKER=true
WHISPER_MODEL=tiny.en or base.en or medium.en
KOKORO_MODEL_PRECISION=q4 for tiny
CONCURRENCY=1
VIDEO_CACHE_SIZE_IN_BYTES=2097152000
```

## Render Request Body

`POST /api/short-video`

```json
{
  "scenes": [
    {
      "text": "Hello world!",
      "searchTerms": ["river"]
    }
  ],
  "config": {
    "paddingBack": 1500,
    "music": "chill",
    "captionPosition": "center",
    "captionBackgroundColor": "#ff0000",
    "voice": "bm_lewis",
    "orientation": "portrait",
    "musicVolume": "muted"
  }
}
```

Required by validator:

```text
scenes[]
scenes[].text
scenes[].searchTerms[]
config
```

Config is optional per field, but the `config` object itself is part of the schema.

## Render Response Body

Success returns HTTP `201`:

```json
{
  "videoId": "cma9sjly700020jo25vwzfnv9"
}
```

Validation failure returns HTTP `400` with either:

```json
{
  "error": "Validation failed",
  "message": "...",
  "missingFields": {}
}
```

or:

```json
{
  "error": "Invalid input",
  "message": "..."
}
```

## Status And Output

Status:

```http
GET /api/short-video/{videoId}/status
```

Response:

```json
{
  "status": "processing"
}
```

Allowed observed statuses:

```text
processing
ready
failed
```

Output file location in upstream code:

```text
{DATA_DIR_PATH}/videos/{videoId}.mp4
```

Default npm data dir:

```text
~/.ai-agents-az-video-generator/videos/{videoId}.mp4
```

Docker data dir:

```text
/app/data/videos/{videoId}.mp4
```

Binary output can also be fetched from:

```http
GET /api/short-video/{videoId}
```

## RAIZ Config Mapping

RAIZ prepares the future HTTP plan with:

```text
RAIZ_SHORT_VIDEO_MAKER_BASE_URL=http://localhost:3123
RAIZ_SHORT_VIDEO_MAKER_RENDER_PATH=/api/short-video
RAIZ_SHORT_VIDEO_MAKER_TIMEOUT_MS=120000
```

Health-only check:

```bash
./scripts/check-short-video-maker-runtime.sh
```

This script only calls `GET /health` on the configured base URL. It does not submit a render request and does not start any process.

## Integration Notes

- RAIZ's current adapter payload is an internal contract and is not yet the upstream request body.
- A future sender must map RAIZ scenes/script into upstream `scenes` and `config`.
- Upstream TTS uses Kokoro and is English-only per README, so Arabic production should continue to use RAIZ-side voice/assets until a compatible path is designed.
- Upstream uses Pexels for background videos and requires `PEXELS_API_KEY`.
- RAIZ should treat upstream submit success as queued/submitted, then poll `/api/short-video/{videoId}/status`.
- RAIZ should ingest output only after status is `ready` and either fetch the binary endpoint or read a mounted `{DATA_DIR_PATH}/videos/{videoId}.mp4`.
