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

## Phase 7: short-video-maker Health Check

Goal: verify that RAIZ can inspect the upstream short-video-maker dependency before attempting a real integration.

Completed scope:

- `short_video_maker` adapter exposes `checkHealth({ vendorPath })`.
- Health check verifies vendor path existence.
- Health check reads `package.json` when present.
- Health check reports expected reference files such as `README.md`, Dockerfile variants, and compose files.
- `GET /adapters/short-video-maker/health` returns a structured health report.
- `POST /jobs/:id/adapter-health` writes `storage/jobs/{job_id}/adapter-health.short-video-maker.json`.
- Job adapter health appends `job.adapter_health_checked`.
- Job adapter health does not change job status.
- No install, Docker start, process start, render endpoint call, or real render occurs.

## Phase 8: short-video-maker Payload Artifact

Goal: convert a prepared RAIZ render plan into a deterministic short-video-maker payload artifact before any real adapter execution.

Completed scope:

- `mapToShortVideoMakerPayload(input)` creates a conservative internal adapter contract.
- `POST /jobs/:id/adapter-payload/short-video-maker` reads `job.json`, `status.json`, `render-plan.json`, and `preflight-report.json`.
- Payload creation requires current status `preparing`.
- Payload creation requires `metadata.preflight_status: passed`.
- Payload creation writes `storage/jobs/{job_id}/short-video-maker-payload.json`.
- Payload creation updates status metadata with `short_video_maker_payload_path`.
- Payload creation appends `job.adapter_payload_created`.
- Payload creation does not change job status.
- No short-video-maker call, render endpoint call, process start, Docker start, install, or video generation occurs.

## Phase 9: Local Voice And Asset Warnings

Goal: validate declared local voice and asset paths during preflight without making missing media fatal.

Completed scope:

- Preflight checks declared local external voice files.
- Preflight checks declared local b-roll folders.
- Preflight checks declared local music files.
- Preflight checks declared local logo files.
- Missing local media paths are warning-level checks only.
- Warning-only preflight reports still pass.
- Warning-only preflight keeps status `preparing`.
- Warning-only preflight keeps `metadata.preflight_status: passed`.
- Error-level preflight failures still move `preparing -> failed`.
- No external asset resolution, Google Drive, render engine, Docker, or video generation occurs.

## Phase 10: Read-Only Job Artifact Inspector

Goal: audit generated local job files before real render integration.

Completed scope:

- `inspectJobArtifacts(jobId)` reads `storage/jobs/{job_id}` without creating or changing files.
- `GET /jobs/:id/artifacts` returns a structured artifact inventory.
- The inventory detects `job.json`, `status.json`, `events.ndjson`, `render-plan.json`, `preflight-report.json`, adapter health reports, short-video-maker payloads, `output/`, and output files.
- Unknown jobs return `404`.
- Artifact inspection does not change `status.json`.
- Artifact inspection does not append events.
- Artifact inspection does not call adapters, render endpoints, Docker, or any external process.

## Phase 11: Local Readiness Review

Goal: decide whether a prepared job is ready for short-video-maker dry-run generation without executing any renderer.

Completed scope:

- `runReadinessReview(jobId)` reads the local job folder and required artifacts.
- `POST /jobs/:id/readiness-review` writes `storage/jobs/{job_id}/readiness-review.json`.
- Readiness requires status `preparing`.
- Readiness verifies preflight metadata and `preflight-report.json` status are `passed`.
- Readiness verifies adapter health is `healthy` or `degraded`; `missing` fails the gate.
- Readiness verifies the short-video-maker payload is 9:16, 1080x1920, Arabic, and RTL.
- Readiness verifies the payload output local path is declared and the output directory exists.
- Passing readiness keeps status `preparing`, records `ready_for_dry_run: true`, and appends `job.readiness_passed`.
- Failed readiness keeps status unchanged, records `ready_for_dry_run: false`, and appends `job.readiness_failed`.
- Readiness does not call short-video-maker, call render endpoints, start Docker, install dependencies, or generate video.

## Phase 12: short-video-maker Dry-Run Request Artifact

Goal: create a deterministic local dry-run request artifact without sending it anywhere.

Completed scope:

- `createShortVideoMakerDryRunRequest(jobId)` reads required local artifacts.
- `POST /jobs/:id/adapter-dry-run/short-video-maker` writes `storage/jobs/{job_id}/short-video-maker-request.dry-run.json`.
- Dry-run request creation requires status `preparing`.
- Dry-run request creation requires `metadata.preflight_status: passed`.
- Dry-run request creation requires `metadata.readiness_status: passed` and `metadata.ready_for_dry_run: true`.
- The request includes short-video-maker composition, script, voice, captions, assets, and output fields.
- The request records safety flags with execution, process start, video generation, and vendor modification disabled.
- Status remains unchanged.
- Status metadata records the dry-run request path and `dry_run_request_created: true`.
- The event log receives `job.adapter_dry_run_request_created`.
- Artifact inspection detects `short-video-maker-request.dry-run.json`.
- No request is sent, no short-video-maker process is called, no render endpoint is called, no Docker process is started, no dependencies are installed, and no video is generated.

## Phase 13: Execution Guard Safety Lock

Goal: prevent any real adapter execution unless explicitly enabled.

Completed scope:

- `getExecutionGuard()` reads `RAIZ_ENABLE_REAL_RENDER`.
- `assertRealRenderAllowed()` throws when real rendering is disabled.
- Real rendering is blocked by default.
- `RAIZ_ENABLE_REAL_RENDER=true` is the only value that allows the guard state.
- `GET /system/execution-guard` reports current guard policy.
- `POST /jobs/:id/send-to-short-video-maker` validates job state and dry-run request presence.
- With the default guard, sender returns `403` without changing status or appending events.
- With `RAIZ_ENABLE_REAL_RENDER=true`, sender returns `501 Not Implemented`.
- Even when enabled, Phase 13 does not call short-video-maker, start Docker, start a process, call a render endpoint, install dependencies, modify vendor files, or generate video.

## Phase 14: Real Sender Implementation Plan

Goal: document the future real short-video-maker sender before adding any execution code.

Completed scope:

- Added `docs/SHORT_VIDEO_MAKER_REAL_SENDER_PLAN.md`.
- Documented the current local-only safe pipeline.
- Documented execution safety gates.
- Compared HTTP API, Docker service, and local process integration modes.
- Recommended starting with HTTP API mode only.
- Documented proposed environment variables and default safety behavior.
- Defined the future sender input and output contract.
- Listed future request, response, and error artifacts.
- Documented future status transitions and failure model.
- Confirmed Phase 14 does not implement execution, Docker, upload, workflow integration, video generation, or vendor modification.

## Phase 15: Environment Config Loader

Goal: centralize runtime configuration before any real sender implementation.

Completed scope:

- Added `apps/orchestrator/src/envConfig.ts`.
- Added `.env.example`.
- `loadEnvConfig()` returns safe defaults for real render, short-video-maker mode, base URL, timeout, vendor path, and storage directory.
- `RAIZ_ENABLE_REAL_RENDER=true` is the only value that enables guard state.
- `RAIZ_SHORT_VIDEO_MAKER_MODE` supports only `http`.
- Invalid mode and invalid timeout values throw clear config errors.
- `GET /system/config` returns a safe config view.
- The execution guard now uses centralized config.
- The short-video-maker health endpoint reads `RAIZ_SHORT_VIDEO_MAKER_VENDOR_PATH` when no explicit server option is provided.
- Storage defaults remain `storage/jobs`.
- Phase 15 does not start processes, call the network, install dependencies, modify vendor files, or generate video.

## Phase 16: Planned HTTP Sender Artifact

Goal: describe how RAIZ would send the short-video-maker dry-run request over HTTP in a future phase, without sending it now.

Completed scope:

- Added `createShortVideoMakerHttpSendPlan(jobId)`.
- `POST /jobs/:id/http-send-plan/short-video-maker` reads local job artifacts and centralized config.
- HTTP send plan creation requires status `preparing`.
- HTTP send plan creation requires `metadata.ready_for_dry_run: true`.
- HTTP send plan creation requires `metadata.dry_run_request_created: true`.
- HTTP send plan creation requires `metadata.readiness_status: passed`.
- HTTP send plan creation writes `storage/jobs/{job_id}/short-video-maker-http-send.plan.json`.
- The plan records method, conservative `/render` URL, timeout, headers, dry-run request path, expected response artifact path, execution guard snapshot, and disabled safety flags.
- The plan marks `metadata.endpoint_unconfirmed: true` because the final upstream endpoint is not confirmed yet.
- Status remains unchanged.
- Status metadata records the plan path and `http_send_plan_created: true`.
- The event log receives `job.http_send_plan_created`.
- Artifact inspection detects `short-video-maker-http-send.plan.json`.
- No request is sent, no network call is made, no short-video-maker process is called, no render endpoint is called, no Docker process is started, no dependencies are installed, and no video is generated.

## Phase 17: Mocked HTTP Sender Contract

Goal: validate the future HTTP sender contract with an injectable mocked HTTP client only.

Completed scope:

- Added a small `HttpClient` interface with `post(url, body, options)`.
- Added `sendShortVideoMakerWithMockedHttp(jobId, httpClient)`.
- `POST /jobs/:id/http-send-mock/short-video-maker` uses an internal mocked HTTP client.
- Mocked HTTP send requires status `preparing`.
- Mocked HTTP send requires `metadata.ready_for_dry_run: true`.
- Mocked HTTP send requires `metadata.dry_run_request_created: true`.
- Mocked HTTP send requires `metadata.http_send_plan_created: true`.
- Mocked HTTP send requires `metadata.readiness_status: passed`.
- Mocked HTTP send requires `RAIZ_ENABLE_REAL_RENDER=true`.
- With the default guard, the endpoint returns `403` without changing status or events.
- With the guard enabled, it writes `storage/jobs/{job_id}/short-video-maker-response.mock.json`.
- The mock response records `mode: http_mock`, `status: submitted_mock`, HTTP status `202`, mock external id, response body, and mocked metadata.
- Status remains unchanged.
- Status metadata records the mock response path and `http_mock_send_completed: true`.
- The event log receives `job.http_mock_send_completed`.
- Artifact inspection detects `short-video-maker-response.mock.json`.
- Tests verify the injected mock client is called exactly once and global fetch is not used.
- No real network request is made, no short-video-maker process is called, no render endpoint is called, no Docker process is started, no dependencies are installed, and no video is generated.

## Phase 18: Real HTTP Sender Readiness Checklist

Goal: add a local readiness gate before any real HTTP sender implementation.

Completed scope:

- Added `runRealHttpSenderReadinessChecklist(jobId)`.
- `POST /jobs/:id/real-http-sender-readiness` reads required local artifacts through the mocked HTTP response.
- Real HTTP sender readiness requires status `preparing`; non-preparing jobs return `409 conflict`.
- The checklist validates required metadata: dry-run readiness, dry-run request creation, HTTP send plan creation, mocked HTTP send completion, and readiness status.
- The checklist validates config: mode `http`, base URL present, and positive timeout.
- The checklist validates HTTP plan safety: `planned_only`, network disabled, `POST`, URL present, and body source path exists.
- The checklist validates mocked response safety: `mode: http_mock` and `metadata.mocked: true`.
- Passing readiness writes `storage/jobs/{job_id}/real-http-sender-readiness.json`.
- Passing readiness keeps status unchanged, records `ready_for_real_http_sender: true`, and appends `job.real_http_sender_readiness_passed`.
- Failed readiness writes the same report path, keeps status unchanged, records `ready_for_real_http_sender: false`, and appends `job.real_http_sender_readiness_failed`.
- Artifact inspection detects `real-http-sender-readiness.json`.
- No real network request is made, no short-video-maker process is called, no render endpoint is called, no Docker process is started, no dependencies are installed, and no video is generated.

One clear next task:

Implement the real HTTP sender behind `RAIZ_ENABLE_REAL_RENDER=true`, using the readiness checklist as the final local gate.

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
