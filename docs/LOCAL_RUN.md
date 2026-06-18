# Local Run

## Prerequisites

- Node.js 20 or newer.
- npm.

## Install

```bash
npm install
```

## Validate Everything

```bash
npm test
npm run build
```

## Start Orchestrator

```bash
npm run dev:orchestrator
```

Default URL:

```text
http://localhost:4000
```

## Validate A Job

```bash
curl -s \
  -H "content-type: application/json" \
  --data @samples/valid-arabic-9x16-job.json \
  http://localhost:4000/jobs/validate
```

Expected result:

```json
{
  "valid": true,
  "job_id": "smoke-arabic-001"
}
```

## Queue A Mock Render

```bash
curl -s \
  -H "content-type: application/json" \
  --data @samples/valid-arabic-9x16-job.json \
  http://localhost:4000/jobs/render
```

Expected result includes:

```json
{
  "job_id": "smoke-arabic-001",
  "status": "queued",
  "adapter": "short_video_maker",
  "output_path": null,
  "error": null
}
```

This creates:

```text
storage/jobs/smoke-arabic-001/job.json
storage/jobs/smoke-arabic-001/status.json
storage/jobs/smoke-arabic-001/events.ndjson
```

## Check Status

```bash
curl -s http://localhost:4000/jobs/smoke-arabic-001/status
```

The response is read from:

```text
storage/jobs/smoke-arabic-001/status.json
```

Unknown jobs return `404`.

## Prepare Render Plan

Phase 4 converts the saved RAIZ job into a deterministic render plan. It still does not render video and does not call `short-video-maker`.

```bash
curl -s \
  -X POST \
  http://localhost:4000/jobs/smoke-arabic-001/prepare
```

This requires the job to be `queued`. It creates:

```text
storage/jobs/smoke-arabic-001/render-plan.json
storage/jobs/smoke-arabic-001/output/.gitkeep
```

It also moves the job to `preparing` and adds metadata to `status.json`:

```json
{
  "metadata": {
    "render_plan_path": "storage/jobs/smoke-arabic-001/render-plan.json",
    "output_dir": "storage/jobs/smoke-arabic-001/output"
  }
}
```

The event log receives:

```text
job.status_changed
job.render_plan_created
```

Calling prepare again returns `409 conflict`. Unknown jobs return `404`.

## Run Preflight

Phase 5 validates render readiness without calling any render engine and without generating video.

```bash
curl -s \
  -X POST \
  http://localhost:4000/jobs/smoke-arabic-001/preflight
```

This requires the job to be `preparing`. It reads:

```text
storage/jobs/smoke-arabic-001/job.json
storage/jobs/smoke-arabic-001/status.json
storage/jobs/smoke-arabic-001/render-plan.json
```

It creates:

```text
storage/jobs/smoke-arabic-001/preflight-report.json
```

On success, the job remains `preparing`, `status.json` metadata receives `preflight_report_path` and `preflight_status`, and `events.ndjson` receives `job.preflight_passed`.

If an error-level preflight check fails, the job moves from `preparing` to `failed`, `status.json` stores the error summary, and `events.ndjson` receives `job.preflight_failed`.

Preflight does not require real media files yet. Assets are summarized from the job and render plan.

Phase 9 adds warning-only checks for declared local files and folders:

```text
local voice file
local b-roll folder
local music file
local logo file
```

Missing local voice/assets are written to `warnings` in `preflight-report.json`, but preflight still passes if there are no error-level failures. The job remains `preparing` and `metadata.preflight_status` remains `passed`.

## Run Mock Render

Phase 6 proves the full local lifecycle before integrating `short-video-maker`.

```bash
curl -s \
  -X POST \
  http://localhost:4000/jobs/smoke-arabic-001/mock-render
```

This requires:

```text
status: preparing
metadata.preflight_status: passed
```

It transitions:

```text
preparing -> rendering -> rendered
```

It creates a text artifact, not a video:

```text
storage/jobs/smoke-arabic-001/output/smoke-arabic-001.mock-render.txt
```

The artifact includes the job id, title, Arabic direction metadata, 1080x1920 dimensions, template id, adapter, engine, created timestamp, and this note:

```text
This is a mock render artifact. No video was generated.
```

`status.json` receives the mock output path plus `metadata.mock_render: true` and `metadata.render_completed_at`. `events.ndjson` receives `job.mock_render_started` and `job.mock_render_completed`.

Calling mock render before passing preflight returns `409 conflict`. Unknown jobs return `404`.

## Check short-video-maker Adapter Health

Phase 7 inspects the reference checkout at `vendor/short-video-maker` without installing, running Docker, starting a process, calling a render endpoint, or generating video.

```bash
curl -s http://localhost:4000/adapters/short-video-maker/health
```

The response includes:

```json
{
  "adapter": "short_video_maker",
  "status": "healthy",
  "vendor_path": "/absolute/path/vendor/short-video-maker",
  "checks": [],
  "metadata": {
    "package_name": "short-video-maker",
    "package_version": "1.3.4",
    "detected_files": []
  }
}
```

To attach the same report to a job without changing its status:

```bash
curl -s \
  -X POST \
  http://localhost:4000/jobs/smoke-arabic-001/adapter-health
```

This creates:

```text
storage/jobs/smoke-arabic-001/adapter-health.short-video-maker.json
```

The event log receives:

```text
job.adapter_health_checked
```

## Create short-video-maker Payload

Phase 8 creates a deterministic adapter payload artifact. It does not call `short-video-maker`, does not call any render endpoint, and does not generate video.

Run this after `render`, `prepare`, and passing `preflight`:

```bash
curl -s \
  -X POST \
  http://localhost:4000/jobs/smoke-arabic-001/adapter-payload/short-video-maker
```

This creates:

```text
storage/jobs/smoke-arabic-001/short-video-maker-payload.json
```

The payload includes:

```text
composition: 9:16, 1080x1920, ar, rtl
script: title, text, hook
voice: provider, voice_name
captions: enabled, format, burn_in
assets: summary, declared
output: filename, local_path
metadata: source, engine, created_at
```

The job remains `preparing`. `status.json` receives `metadata.short_video_maker_payload_path`, and `events.ndjson` receives `job.adapter_payload_created`.

Calling this before preflight returns `409 conflict`. Unknown jobs return `404`.

## Run Readiness Review

Phase 11 creates a local gate before generating any short-video-maker dry-run request. It does not call `short-video-maker`, does not call a render endpoint, and does not generate video.

Run this after `render`, `prepare`, passing `preflight`, `adapter-health`, and `adapter-payload`:

```bash
curl -s \
  -X POST \
  http://localhost:4000/jobs/smoke-arabic-001/readiness-review
```

This creates:

```text
storage/jobs/smoke-arabic-001/readiness-review.json
```

Readiness passes only when required artifacts exist, status is `preparing`, preflight has passed, adapter health is `healthy` or `degraded`, the short-video-maker payload is Arabic RTL 9:16 at 1080x1920, and the output directory exists.

The job remains `preparing`. `status.json` receives `metadata.readiness_review_path`, `metadata.readiness_status`, and `metadata.ready_for_dry_run`. `events.ndjson` receives `job.readiness_passed` or `job.readiness_failed`.

Missing adapter health, missing payload, bad payload composition, or missing output directory fail readiness without moving the job to `failed`. Unknown jobs return `404`; jobs that are not `preparing` return `409 conflict`.

## Create short-video-maker Dry-Run Request

Phase 12 creates a local request artifact for a future short-video-maker dry-run. It does not send the request, call `short-video-maker`, call an external render endpoint, start Docker, start a process, install dependencies, or generate video.

Run this after readiness passes:

```bash
curl -s \
  -X POST \
  http://localhost:4000/jobs/smoke-arabic-001/adapter-dry-run/short-video-maker
```

This creates:

```text
storage/jobs/smoke-arabic-001/short-video-maker-request.dry-run.json
```

The artifact contains the adapter payload fields under `request`, a disabled local target, and safety flags proving that execution, process start, video generation, and vendor modification are all disabled.

The job remains `preparing`. `status.json` receives `metadata.short_video_maker_dry_run_request_path` and `metadata.dry_run_request_created`. `events.ndjson` receives `job.adapter_dry_run_request_created`.

Calling this before readiness passes returns `409 conflict`. Unknown jobs return `404`.

## Check Execution Guard

Phase 13 adds a mandatory safety lock before any real adapter execution.

```bash
curl -s http://localhost:4000/system/execution-guard
```

Default behavior is blocked:

```text
RAIZ_ENABLE_REAL_RENDER=false
```

Only this exact value enables the guard state:

```text
RAIZ_ENABLE_REAL_RENDER=true
```

Even when enabled, Phase 13 does not send anything and does not implement real rendering.

## Try Protected Sender Stub

The protected sender reads the dry-run request artifact and validates local readiness, but it is still a stub.

```bash
curl -i \
  -X POST \
  http://localhost:4000/jobs/smoke-arabic-001/send-to-short-video-maker
```

With the default guard, the response is `403`. It does not change `status.json`, append events, start a process, call `short-video-maker`, or generate video.

With the guard explicitly enabled:

```bash
RAIZ_ENABLE_REAL_RENDER=true npm run dev:orchestrator
```

The same request returns `501 Not Implemented`:

```text
Real short-video-maker sender is not implemented yet.
```

This phase proves the safety lock only. It still does not execute, send, render, install, or start Docker.

## Real Sender Plan

Phase 14 is documentation-only. The future real sender plan is here:

```text
docs/SHORT_VIDEO_MAKER_REAL_SENDER_PLAN.md
```

No runtime behavior changes in this phase. The protected sender still returns `403` by default and `501 Not Implemented` when `RAIZ_ENABLE_REAL_RENDER=true`.

## Inspect Job Artifacts

Phase 10 adds a read-only inventory endpoint for files under `storage/jobs/{job_id}`.

```bash
curl -s http://localhost:4000/jobs/smoke-arabic-001/artifacts
```

The response reports known artifacts when present:

```text
job.json
status.json
events.ndjson
render-plan.json
preflight-report.json
adapter-health.short-video-maker.json
short-video-maker-payload.json
short-video-maker-request.dry-run.json
output/
output files
```

The endpoint does not change job status, append events, create files, call adapters, or generate video. Unknown jobs return `404`.

## Update Status Manually

Phase 3 adds controlled lifecycle transitions for internal testing before real rendering.

Allowed statuses:

```text
queued -> preparing
preparing -> rendering
rendering -> rendered
rendering -> failed
preparing -> failed
queued -> cancelled
preparing -> cancelled
rendering -> cancelled
```

Move a queued job to preparing:

```bash
curl -s \
  -X PATCH \
  -H "content-type: application/json" \
  --data '{"status":"preparing","metadata":{"step":"assets"}}' \
  http://localhost:4000/jobs/smoke-arabic-001/status
```

Move preparing to rendering:

```bash
curl -s \
  -X PATCH \
  -H "content-type: application/json" \
  --data '{"status":"rendering"}' \
  http://localhost:4000/jobs/smoke-arabic-001/status
```

Mark rendering as rendered:

```bash
curl -s \
  -X PATCH \
  -H "content-type: application/json" \
  --data '{"status":"rendered","output_path":"/storage/exports/smoke-arabic-001.mp4"}' \
  http://localhost:4000/jobs/smoke-arabic-001/status
```

Invalid transitions return `409 conflict`. Unknown jobs return `404`.

Each accepted transition appends a `job.status_changed` line to:

```text
storage/jobs/smoke-arabic-001/events.ndjson
```

## Duplicate Job IDs

Submitting the same sample twice returns `409 conflict`:

```bash
curl -i \
  -H "content-type: application/json" \
  --data @samples/valid-arabic-9x16-job.json \
  http://localhost:4000/jobs/render
```

Remove the local job folder before reusing the same sample ID:

```bash
rm -rf storage/jobs/smoke-arabic-001
```

## Invalid Jobs

Invalid payloads return `400` and do not create storage files.
