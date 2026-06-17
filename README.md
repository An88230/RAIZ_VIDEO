# RAIZ Video Factory

RAIZ Video Factory is a local-first control layer for Arabic 9:16 short-video production.

Phase 7 is intentionally small:

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

## Phase 7 Commands

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

`POST /jobs/:id/mock-render` requires `preflight_status: passed`, moves the job through `rendering -> rendered`, and writes a text artifact at `storage/jobs/{job_id}/output/{job_id}.mock-render.txt`. It does not call a render engine and does not generate video.

`GET /adapters/short-video-maker/health` inspects `vendor/short-video-maker` for expected reference files. It does not install dependencies, start Docker, call short-video-maker, or render anything.

`POST /jobs/:id/adapter-health` writes `storage/jobs/{job_id}/adapter-health.short-video-maker.json` and appends `job.adapter_health_checked` without changing job status.

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
