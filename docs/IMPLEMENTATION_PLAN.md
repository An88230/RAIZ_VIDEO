# RAIZ Video Factory Implementation Plan

## Phase 1: Executable Skeleton

Goal: validate RAIZ Job JSON and prepare the orchestration boundary without real rendering or publishing.

Completed scope for this phase:

- Root npm workspace.
- `@raiz/job-schema` package using the root `raiz-job.schema.json`.
- Valid Arabic 9:16 sample job.
- `@raiz/render-adapters` package with a generic `RenderAdapter` contract.
- `short_video_maker` adapter stub that prepares a payload and returns mock queued status.
- `@raiz/orchestrator` Fastify API skeleton.
- Arabic RTL Remotion template placeholder.

## Phase 2: Local Job Persistence

Goal: store queued render requests on disk before real rendering.

Completed scope:

- `POST /jobs/render` writes `storage/jobs/{job_id}/job.json`.
- `POST /jobs/render` writes `storage/jobs/{job_id}/status.json`.
- `POST /jobs/render` appends `job.queued` to `storage/jobs/{job_id}/events.ndjson`.
- `GET /jobs/:id/status` can recover status after process restart.
- Duplicate `job_id` values return `409 conflict`.
- No render engine is called.

## Phase 3: Lifecycle Control

Goal: add a safe internal state machine before real render execution.

Completed scope:

- Allowed statuses: `queued`, `preparing`, `rendering`, `rendered`, `failed`, `cancelled`.
- Valid status transitions are enforced.
- `PATCH /jobs/:id/status` updates `status.json`.
- Accepted transitions append `job.status_changed` events to `events.ndjson`.
- Invalid transitions return `409 conflict`.
- Unknown jobs return `404`.

One clear next task:

Add internal preparation steps that move jobs from `queued` to `preparing` without calling a render engine.

## Later Phases

- Add voice and caption services.
- Add real short-video-maker adapter HTTP call.
- Add FFmpeg final pass for ASS/libass burn-in.
- Add Remotion direct renderer.
- Add n8n workflow JSON.
- Add Google Drive review upload.
- Add YouTube publishing only after approval.

## Current Non-Goals

- No YouTube upload.
- No Google Drive integration.
- No n8n workflow implementation.
- No vendor repository modifications.
- No production UI dashboard.
