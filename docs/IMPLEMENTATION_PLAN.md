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

## Phase 4: Render Preparation

Goal: convert a saved RAIZ job into a deterministic render plan before calling any render engine.

Completed scope:

- `prepareRenderPlan(job)` creates a 1080x1920 plan for Arabic 9:16 jobs.
- `POST /jobs/:id/prepare` reads `storage/jobs/{job_id}/job.json`.
- Preparation requires current status `queued`.
- Preparation writes `storage/jobs/{job_id}/render-plan.json`.
- Preparation creates `storage/jobs/{job_id}/output/.gitkeep`.
- Preparation moves status from `queued` to `preparing`.
- Preparation appends `job.render_plan_created` to `events.ndjson`.
- Preparation does not call a render adapter and does not generate video.

One clear next task:

Add asset and voice preflight checks inside the preparation layer without rendering.

## Phase 5: Render Preflight

Goal: validate that a prepared job has enough information to be rendered later, without calling any render engine.

Completed scope:

- `POST /jobs/:id/preflight` reads `job.json`, `status.json`, and `render-plan.json`.
- Preflight requires current status `preparing`.
- Preflight writes `storage/jobs/{job_id}/preflight-report.json`.
- Passing preflight keeps status `preparing`.
- Passing preflight updates status metadata with `preflight_report_path` and `preflight_status`.
- Passing preflight appends `job.preflight_passed`.
- Failed error checks move status from `preparing` to `failed`.
- Failed preflight appends `job.preflight_failed`.
- Preflight does not require real media files and does not generate video.

## Phase 6: Mock Render Worker

Goal: prove the full local lifecycle from queued to rendered using a mock renderer before integrating a real render engine.

Completed scope:

- `POST /jobs/:id/mock-render` reads `job.json`, `status.json`, `render-plan.json`, and `preflight-report.json`.
- Mock render requires current status `preparing`.
- Mock render requires `metadata.preflight_status: passed`.
- Mock render transitions `preparing -> rendering -> rendered`.
- Mock render writes `storage/jobs/{job_id}/output/{job_id}.mock-render.txt`.
- Mock render updates `status.json` with `output_path`, `metadata.mock_render`, and `metadata.render_completed_at`.
- Mock render appends `job.mock_render_started` and `job.mock_render_completed`.
- Mock render does not call a render engine and does not generate video.

One clear next task:

Add local voice and asset path validation as warnings first, still without rendering.

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
