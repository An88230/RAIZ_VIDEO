# RAIZ Video Factory

RAIZ Video Factory is a local-first control layer for Arabic 9:16 short-video production.

Current local-first scope:

- Validate RAIZ Job JSON using `raiz-job.schema.json`.
- Provide a thin orchestrator API for validation, mock render queueing, and file-backed job status.
- Define the render adapter contract without calling external render engines.
- Prepare Arabic RTL Remotion template rules.
- Persist accepted render requests under `storage/jobs/{job_id}`.
- Control job status transitions before real render execution.
- Create deterministic render plans before calling any render engine.
- Run render readiness preflight checks without generating video.
- Prove the full local lifecycle with a mock render artifact.
- Inspect the upstream `short-video-maker` adapter presence without running it.
- Create a deterministic `short_video_maker` payload artifact without sending it.
- Validate declared local voice and asset paths as preflight warnings only.
- Inspect generated job artifacts without changing job status or event history.
- Run a local readiness review before any short-video-maker dry-run generation.
- Create a short-video-maker dry-run request artifact without sending or executing it.
- Add an execution guard that blocks real adapter execution unless explicitly enabled.
- Document the real short-video-maker sender plan before any execution code is added.
- Centralize runtime configuration and add `.env.example`.
- Create a planned HTTP sender artifact without making network requests.
- Validate the HTTP sender contract with injectable mocked HTTP only.
- Run a real HTTP sender readiness checklist before any real network execution.
- Submit one guarded real HTTP request when explicitly enabled.
- Ingest a verified local output path from the upstream response.
- Create a local output review package without uploading or modifying the video.
- Register both `short_video_maker` and `remotion_direct` adapters for safe
  `/jobs/render` queueing.
- Run real Remotion-direct rendering only through the guarded
  `/jobs/:id/render/remotion-direct` route.
- Warn when schema-supported local render fields are reserved or not implemented
  in local render v1.

## Current Status

The current project state, source-of-truth boundary, and recommended next phases
are documented in
[PROJECT_STATE_AND_NEXT_PHASES.md](docs/PROJECT_STATE_AND_NEXT_PHASES.md).

Last stable tag: `v0.1.34`. Recommended next phase: `Phase 35 — Orchestrator
Hardening`.

## Vendor Policy

`vendor/` is reference-only upstream code.

- Do not modify anything inside `vendor/`.
- Do not install or rewrite vendor repositories from this app.
- Do not copy full vendor repositories into RAIZ Video Factory.
- Use upstream code only to study contracts, behavior, and implementation patterns.

RAIZ owns the job schema, orchestrator, adapter contracts, Arabic RTL rules, status lifecycle, and future publishing gates.

## Project Structure

```text
apps/orchestrator              Fastify API skeleton with local job persistence
apps/render-remotion           Remotion-direct Arabic RTL render app (1080x1920)
packages/job-schema            RAIZ Job validation package
packages/render-adapters       Generic adapter contract and phase 1 stub
packages/remotion-templates    Arabic RTL template placeholder and rules
workflows/n8n                  Reserved for future n8n workflows
docs                           Implementation and local run notes
samples                        Valid sample jobs
vendor                         Reference-only upstream repositories
```

## Local Arabic Render (Remotion-direct)

RAIZ renders real Arabic 9:16 video locally with the chosen v1 engine path:
**Remotion-direct + external/local Arabic voice-over + FFmpeg mux**. Captions are
rendered inside Remotion (Chromium shapes Arabic RTL correctly) and also exported
as `.srt` and `.ass` sidecars.

```bash
npm install
npm run raiz:render-arabic                      # renders the sample Arabic job
npm run raiz:render-arabic -- --job=samples/valid-arabic-9x16-job.json --out=storage/renders/demo
npm run raiz:render-arabic -- --job=samples/valid-arabic-9x16-job.json --dry-check
```

The driver ([scripts/render-arabic-local.mjs](scripts/render-arabic-local.mjs)):

1. Resolves the Arabic voice-over: the job's `voice.file_path` when `voice.type` is
   `external_file` and the file exists, otherwise a local macOS `say -v Majed` voice
   with an explicit warning.
2. Measures the voice-over duration with `ffprobe`.
3. Builds timed caption cues and writes `captions.srt` + `captions.ass`.
4. Renders the `raiz-dark-hook-01` Remotion composition (1080x1920, RTL Arabic,
   IBM Plex Sans Arabic) sized to the voice-over.
5. Muxes the voice-over into the silent Remotion output with FFmpeg.
6. Verifies the final MP4 is 1080x1920 with an audio track.

Output lands in `storage/renders/{job_id}/{job_id}.mp4` alongside `raw.mp4`,
`voice.aiff`, `captions.srt`, and `captions.ass`.

Requirements: Node 20+, FFmpeg on `PATH`, and (for the local fallback voice) macOS
`say`. The first render downloads a headless Chromium for Remotion. Remotion
composition ids allow only `a-z A-Z 0-9 -`, so RAIZ `template_id` underscores are
mapped to hyphens (`raiz_dark_hook_01` -> `raiz-dark-hook-01`).

## Supported in local render v1

The local Remotion-direct driver currently supports:

- Arabic-first 9:16 output at `1080x1920`.
- `template.template_id` mapped from RAIZ underscore form to Remotion composition
  id hyphen form, for example `raiz_dark_hook_01` -> `raiz-dark-hook-01`.
- `hook` as the main centered visual hook.
- `script` as narration text and timed caption source.
- `voice.type: "external_file"` when `voice.file_path` exists.
- macOS fallback narration through `say -v Majed`.
- Local b-roll when `assets.broll_source: "local"` and `assets.broll_folder`
  points to available local clips.
- Optional Pexels b-roll when `assets.broll_source: "pexels"`: the render
  auto-fetches portrait clips for `assets.search_terms` (first term in v1, up to
  `assets.broll_count`) when `PEXELS_API_KEY` is set, then picks the best match.
- Caption sidecar generation: `captions.srt` and `captions.ass`.
- Burned-in Remotion captions using the current fixed template style.
- `output.filename` for the final MP4 filename.
- `--dry-check` / `--dry-voice-check` to print local voice and unsupported-field
  warnings without running `say`, Remotion, or FFmpeg.

## Reserved / not implemented in local render v1

These fields are accepted by the schema or existing samples, but they are
reserved or not fully implemented by `scripts/render-arabic-local.mjs` v1. The
driver prints `[render][warning]` or `[voice][warning]` messages so they do not
pass silently.

- `voice.type: "edge_tts"`, `"elevenlabs"`, and `"azure"` are schema-supported
  but not implemented locally in v1. They fall back to macOS `say -v Majed`.
- `assets.music` is not mixed into the final MP4.
- `assets.logo` is not composited.
- `assets.broll_source` values `pixabay` and `google_drive` are reserved for
  other workflows; local render v1 consumes `local` and `pexels` b-roll.
- `assets.search_terms` only drives fetching when `broll_source: "pexels"`; it is
  ignored (with a warning) for other sources, and only the first term is used in v1.
- `captions.font` is ignored; the Remotion template uses bundled IBM Plex Sans
  Arabic.
- `captions.position` is ignored; the current template uses a fixed caption
  layout.
- `captions.burn_in` is not configurable; local Remotion captions are always
  burned into the visual layer.
- `captions.enabled=false` is not implemented; captions are still generated from
  script cues.
- `captions.format` does not disable Remotion captions; local render v1 writes
  both SRT and ASS sidecars and renders captions visually.
- `title` is metadata only in the current Remotion template and is not displayed.
- `output.drive_folder` is ignored by local render v1; use `--out` or the
  default `storage/renders/{job_id}` folder.
- `template.style_preset` and `captions.style_preset` are reserved for future
  template variants.
- Non-Arabic `language` or non-RTL `direction` values are schema-valid for the
  broader RAIZ contract, but local render v1 is Arabic/RTL-first.

### Running the render through the orchestrator

The same render is wired into the orchestrator as a guarded route:

```bash
RAIZ_ENABLE_REAL_RENDER=true npm run dev:orchestrator
# then, for a job that is `preparing` with `preflight_status: passed`:
curl -X POST http://127.0.0.1:4000/jobs/{job_id}/render/remotion-direct
```

The output MP4 lands at `storage/jobs/{job_id}/output/{filename}` and the job moves
to `rendered`.

`POST /jobs/render` is different: it validates and queues a job only. It accepts
both `template.engine: "short_video_maker"` and `template.engine:
"remotion_direct"` when their adapters can prepare a safe queued plan, but it
does not render video and does not call Remotion. Real Remotion execution is
only available through `POST /jobs/:id/render/remotion-direct`, and only when the
server is started with `RAIZ_ENABLE_REAL_RENDER=true`.

### Local b-roll videos

Put your own local background clips here (shared pool, gitignored):

```text
storage/assets/broll/
```

Then point the job at them:

```json
"assets": { "broll_source": "local", "broll_folder": "storage/assets/broll" }
```

Prefer vertical `9:16` `.mp4` clips. The render automatically picks the clip
closest to `1080x1920` from `broll_folder` and uses it as a **darkened background
layer** behind the hook (looped to the voice-over length). With no clips, it falls
back to a solid dark background. Local b-roll is the brand-first source.

#### Optional: fetch b-roll from Pexels

Pexels is an optional enrichment (not the brand default). It only runs when a
`PEXELS_API_KEY` is present in `.env`. There are two ways to use it.

**Job-driven (automatic during render).** Declare it on the job and the render
fetches portrait clips before compositing:

```json
"assets": {
  "broll_source": "pexels",
  "search_terms": ["dark desk notebook", "phone light at night"],
  "broll_count": 2
}
```

The render queries Pexels with the first search term (multi-term blending is
reserved), downloads up to `broll_count` portrait clips into
`storage/assets/broll/pexels/` (or the job's `broll_folder` when set), then picks
the clip closest to `1080x1920`. Without a key — or on any fetch error — it warns
(`[broll][warning]`) and falls back to cached clips or a solid dark background; it
never fails the render. Downloads are validated as `video/*`, skipping non-video
or empty responses.

**Manual (pre-fetch via CLI).** Populate the pool ahead of time:

```bash
# put PEXELS_API_KEY=... in .env (gitignored), then:
npm run raiz:fetch-broll -- --query="dark moody clouds" --count=3
```

Clips download to `storage/assets/broll/pexels/` (portrait only, cached, never
overwrites). Point the job's `broll_folder` at that subfolder to use them.

## Commands

```bash
npm install
npm test
npm run build
npm run dev:orchestrator
./scripts/start-raiz.sh
npm run raiz:local-pipeline
npm run raiz:render-arabic -- --job=samples/valid-arabic-9x16-job.json --dry-check
```

The orchestrator listens on port `4000` by default.

The RAIZ runtime connect script is documented in [START_RAIZ.md](docs/START_RAIZ.md). It starts RAIZ only and prints exact local health and pipeline commands without starting vendor services or Docker.

The one-command local safe pipeline is documented in [RUN_LOCAL_PIPELINE.md](docs/RUN_LOCAL_PIPELINE.md). It runs the local artifact pipeline through the RAIZ API only and does not start Docker, call short-video-maker, upload, run n8n, or generate video.

To re-run the sample job intentionally, use `RAIZ_RESET_JOB=true RAIZ_API_URL=http://127.0.0.1:4000 npm run raiz:local-pipeline`. Reset is off by default.

The short-video-maker runtime connection contract is documented in [SHORT_VIDEO_MAKER_CONNECTION.md](docs/SHORT_VIDEO_MAKER_CONNECTION.md). Use `./scripts/check-short-video-maker-runtime.sh` for a health-only check of a separately running upstream service.

Current endpoints:

- `GET /health`
- `GET /engines`
- `GET /adapters/short-video-maker/health`
- `POST /jobs/validate`
- `POST /jobs/render`
- `POST /jobs/:id/prepare`
- `POST /jobs/:id/preflight`
- `POST /jobs/:id/mock-render`
- `POST /jobs/:id/render/remotion-direct`
- `POST /jobs/:id/adapter-health`
- `POST /jobs/:id/adapter-payload/short-video-maker`
- `POST /jobs/:id/upstream-request/short-video-maker`
- `POST /jobs/:id/readiness-review`
- `POST /jobs/:id/adapter-dry-run/short-video-maker`
- `POST /jobs/:id/http-send-plan/short-video-maker`
- `POST /jobs/:id/http-send-mock/short-video-maker`
- `POST /jobs/:id/real-http-sender-readiness`
- `GET /system/execution-guard`
- `GET /system/config`
- `POST /jobs/:id/send-to-short-video-maker`
- `POST /jobs/:id/ingest-output/short-video-maker`
- `POST /jobs/:id/review-package`
- `POST /jobs/:id/manual-review/approve`
- `POST /jobs/:id/manual-review/reject`
- `POST /jobs/:id/publish-package`
- `POST /jobs/:id/youtube-upload-plan`
- `POST /jobs/:id/google-drive-export-plan`
- `POST /jobs/:id/n8n-workflow-plan`
- `GET /jobs/:id/artifacts`
- `GET /jobs/:id/status`
- `PATCH /jobs/:id/status`

`POST /jobs/render` validates the payload, chooses a registered adapter by
`job.template.engine`, and returns a queued status. It currently supports safe
queueing for `short_video_maker` and `remotion_direct`. It does not render video,
call Remotion, call short-video-maker, upload, or publish.

For each accepted render request, the orchestrator creates:

```text
storage/jobs/{job_id}/job.json
storage/jobs/{job_id}/status.json
storage/jobs/{job_id}/events.ndjson
```

`POST /jobs/:id/prepare` reads `job.json`, requires the job to be `queued`, writes `render-plan.json`, creates `output/.gitkeep`, and moves the job to `preparing`. It does not call a render adapter and does not generate video.

`POST /jobs/:id/preflight` reads `job.json`, `status.json`, and `render-plan.json`, requires the job to be `preparing`, writes `preflight-report.json`, and records whether the job is ready for a future render call.

Preflight also checks declared local voice and asset paths. Missing local voice files, b-roll folders, music files, or logo files are warnings only. Warning-only preflight still passes and leaves the job in `preparing`.

`POST /jobs/:id/mock-render` requires `preflight_status: passed`, moves the job through `rendering -> rendered`, and writes a text artifact at `storage/jobs/{job_id}/output/{job_id}.mock-render.txt`. It does not call a render engine and does not generate video.

`POST /jobs/:id/render/remotion-direct` is the **guarded real render** for the v1 Arabic engine. It requires `RAIZ_ENABLE_REAL_RENDER=true`, `status: preparing`, and `preflight_status: passed`. It runs the Remotion-direct pipeline ([scripts/render-arabic-local.mjs](scripts/render-arabic-local.mjs)) against the stored job, writes the MP4 to `storage/jobs/{job_id}/output/{filename}` plus `render-manifest.remotion-direct.json`, and moves the job `preparing -> rendering -> rendered` (or `failed`). It does not publish, upload, touch `vendor/`, or start Docker. Tests inject a fake renderer; real Remotion/FFmpeg runs only when the route is called with the guard enabled.

`GET /health` returns a lightweight liveness response for the orchestrator itself, including the current real render flag. It does not touch storage, start processes, or call the network.

`GET /engines` lists the render adapters registered in RAIZ and the default engine. The default engine is `remotion_direct` (the Arabic-first v1 render path); `short_video_maker` stays registered as the optional English-only path. Routing in `POST /jobs/render` is by engine id, so adapter order only affects which engine is reported as the default. It does not call any engine.

`GET /adapters/short-video-maker/health` inspects `vendor/short-video-maker` for expected reference files. It does not install dependencies, start Docker, call short-video-maker, or render anything.

`POST /jobs/:id/adapter-health` writes `storage/jobs/{job_id}/adapter-health.short-video-maker.json` and appends `job.adapter_health_checked` without changing job status.

`POST /jobs/:id/adapter-payload/short-video-maker` requires `status: preparing` and `preflight_status: passed`, writes `storage/jobs/{job_id}/short-video-maker-payload.json`, appends `job.adapter_payload_created`, and leaves job status unchanged.

`POST /jobs/:id/upstream-request/short-video-maker` requires `status: preparing`, `preflight_status: passed`, and an existing adapter payload. It maps the RAIZ payload into the **actual upstream short-video-maker contract** (`{ scenes, config }` for `POST /api/short-video`), writes `storage/jobs/{job_id}/short-video-maker-upstream-request.json`, and appends `job.upstream_request_created`. The artifact also records `limitations` — the semantic gaps of this engine (Kokoro narrates English only, footage is sourced from Pexels via per-scene `searchTerms`, captions are always rendered). It does not send the request, call short-video-maker, change job status, or generate video. The guarded real sender does not yet send this body; wiring it is the next step.

`POST /jobs/:id/readiness-review` requires the job to remain `preparing`, checks the required local artifacts, verifies preflight, adapter health, short-video-maker payload composition, and output directory readiness, then writes `storage/jobs/{job_id}/readiness-review.json`. It updates readiness metadata and appends either `job.readiness_passed` or `job.readiness_failed`, but it does not call short-video-maker and does not generate video.

`POST /jobs/:id/adapter-dry-run/short-video-maker` requires `status: preparing`, `preflight_status: passed`, and readiness metadata showing the job is ready for dry-run. It writes `storage/jobs/{job_id}/short-video-maker-request.dry-run.json`, updates dry-run metadata, and appends `job.adapter_dry_run_request_created`. It does not send the request, call short-video-maker, start a process, modify vendor files, or generate video.

`POST /jobs/:id/http-send-plan/short-video-maker` requires the dry-run request and passed readiness metadata, reads centralized config, and writes `storage/jobs/{job_id}/short-video-maker-http-send.plan.json`. It records the planned HTTP method, URL, timeout, headers, request artifact path, expected response artifact path, and disabled safety flags. It updates metadata and appends `job.http_send_plan_created`, but it does not call short-video-maker, make a network request, start a process, modify vendor files, change job status, or generate video.

`POST /jobs/:id/http-send-mock/short-video-maker` requires the HTTP send plan, passed readiness metadata, and `RAIZ_ENABLE_REAL_RENDER=true`. It uses an internal mocked HTTP client only, writes `storage/jobs/{job_id}/short-video-maker-response.mock.json`, updates metadata, and appends `job.http_mock_send_completed`. It does not use global fetch, make a real network request, call short-video-maker, start a process, change job status, or generate video.

`POST /jobs/:id/real-http-sender-readiness` reads the local job artifacts through the mocked HTTP response, validates config and the planned HTTP request, then writes `storage/jobs/{job_id}/real-http-sender-readiness.json`. It updates readiness metadata and appends either `job.real_http_sender_readiness_passed` or `job.real_http_sender_readiness_failed`. It does not change job status, call short-video-maker, make a network request, start Docker, or generate video.

`GET /system/execution-guard` reports whether real render execution is allowed. By default, real execution is blocked unless `RAIZ_ENABLE_REAL_RENDER=true`.

`GET /system/config` returns a safe view of centralized runtime config. It includes the real render flag, short-video-maker HTTP mode settings, vendor path, storage directory, and safety markers. It does not expose secrets, start processes, call the network, or alter storage.

`POST /jobs/:id/send-to-short-video-maker` is the guarded real HTTP sender. It requires `RAIZ_ENABLE_REAL_RENDER=true`, `status: preparing`, and passed real HTTP sender readiness. It writes `short-video-maker-request.sent.json` and `short-video-maker-response.json`, then moves the job `preparing -> rendering` only after a successful submit. If an attempted submit fails, it writes `short-video-maker-error.json` and moves the job to `failed`. It does not start Docker, mutate `vendor/`, upload anywhere, or generate video.

The real sender plan is documented in [SHORT_VIDEO_MAKER_REAL_SENDER_PLAN.md](docs/SHORT_VIDEO_MAKER_REAL_SENDER_PLAN.md). Phase 19 implements the guarded HTTP submit path. Tests inject a mocked HTTP client; real network use is manual only.

`POST /jobs/:id/ingest-output/short-video-maker` requires `status: rendering`, reads `short-video-maker-response.json`, verifies the declared local output file path exists, and writes `output-manifest.json`. A valid output transitions `rendering -> rendered`; a missing or invalid output transitions `rendering -> failed`.

`POST /jobs/:id/review-package` requires `status: rendered`, reads `job.json`, `status.json`, and `output-manifest.json`, creates `review-package.json` and `review/`, updates review metadata, and appends `job.review_package_created`. It does not upload anywhere, modify the video, or call the network.

`GET /jobs/:id/artifacts` returns a read-only inventory of known files under `storage/jobs/{job_id}` including job payload, status, events, render plan, preflight report, adapter health, adapter payload, dry-run request, HTTP send plan, mocked HTTP response, real HTTP sender readiness, sent request, real response, error artifact, output manifest, review package, review folder, output directory, and output files. It does not change `status.json`, append events, create files, call adapters, or render video.

Execution guard values:

```text
RAIZ_ENABLE_REAL_RENDER=false
RAIZ_ENABLE_REAL_RENDER=true
```

Copy [.env.example](.env.example) when local configuration is needed. Real rendering remains disabled by default.

Duplicate `job_id` values return `409 conflict` unless overwrite support is explicitly added later.

Allowed lifecycle statuses:

```text
queued
preparing
rendering
rendered
failed
cancelled
```

Valid transitions are enforced before status files are updated. For example, `queued -> preparing` is accepted, but `queued -> rendered` is rejected with `409 conflict`.
