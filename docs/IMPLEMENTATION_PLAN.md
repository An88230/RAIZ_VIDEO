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

## Next Phase: Real Job Persistence

One clear next task:

Add deterministic job folders under `storage/jobs/{job_id}` and persist the accepted `job.json` plus a minimal status file.

Acceptance:

- `POST /jobs/render` writes `storage/jobs/{job_id}/job.json`.
- `GET /jobs/:id/status` can recover status after process restart.
- No render engine is called.

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
