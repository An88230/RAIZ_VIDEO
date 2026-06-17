# RAIZ Video Factory

RAIZ Video Factory is a local-first control layer for Arabic 9:16 short-video production.

Phase 2 is intentionally small:

- Validate RAIZ Job JSON using `raiz-job.schema.json`.
- Provide a thin orchestrator API for validation, mock render queueing, and file-backed job status.
- Define the render adapter contract without calling external render engines.
- Prepare Arabic RTL Remotion template rules.
- Persist accepted render requests under `storage/jobs/{job_id}`.

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

## Phase 2 Commands

```bash
npm install
npm test
npm run build
npm run dev:orchestrator
```

The orchestrator listens on port `4000` by default.

Current endpoints:

- `POST /jobs/validate`
- `POST /jobs/render`
- `GET /jobs/:id/status`

`POST /jobs/render` validates the payload and returns a queued mock status. It does not render video yet.

For each accepted render request, the orchestrator creates:

```text
storage/jobs/{job_id}/job.json
storage/jobs/{job_id}/status.json
storage/jobs/{job_id}/events.ndjson
```

Duplicate `job_id` values return `409 conflict` unless overwrite support is explicitly added later.
