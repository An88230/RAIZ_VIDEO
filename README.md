# RAIZ Video Factory

RAIZ Video Factory is a local-first control layer for Arabic 9:16 short-video production.

Phase 21 is intentionally small:

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
packages/job-schema            RAIZ Job validation package
packages/render-adapters       Generic adapter contract and phase 1 stub
packages/remotion-templates    Arabic RTL template placeholder and rules
workflows/n8n                  Reserved for future n8n workflows
docs                           Implementation and local run notes
samples                        Valid sample jobs
vendor                         Reference-only upstream repositories
```

## Phase 21 Commands

```bash
npm install
npm test
npm run build
npm run dev:orchestrator
```

The orchestrator listens on port `4000` by default.

Current endpoints:

- `GET /adapters/short-video-maker/health`
- `POST /jobs/validate`
- `POST /jobs/render`
- `POST /jobs/:id/prepare`
- `POST /jobs/:id/preflight`
- `POST /jobs/:id/mock-render`
- `POST /jobs/:id/adapter-health`
- `POST /jobs/:id/adapter-payload/short-video-maker`
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
- `GET /jobs/:id/artifacts`
- `GET /jobs/:id/status`
- `PATCH /jobs/:id/status`

`POST /jobs/render` validates the payload and returns a queued mock status. It does not render video yet.

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

`GET /adapters/short-video-maker/health` inspects `vendor/short-video-maker` for expected reference files. It does not install dependencies, start Docker, call short-video-maker, or render anything.

`POST /jobs/:id/adapter-health` writes `storage/jobs/{job_id}/adapter-health.short-video-maker.json` and appends `job.adapter_health_checked` without changing job status.

`POST /jobs/:id/adapter-payload/short-video-maker` requires `status: preparing` and `preflight_status: passed`, writes `storage/jobs/{job_id}/short-video-maker-payload.json`, appends `job.adapter_payload_created`, and leaves job status unchanged.

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
