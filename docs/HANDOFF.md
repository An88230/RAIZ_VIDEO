# RAIZ Video Factory - Handoff

Date: 2026-06-21

## 1. Where the project is now

- Current branch: `main`
- Last implementation commit: `853ba16 chore: point n8n render exports at RAIZ intake`
- Previous implementation commit: `019e0a3 feat: add guarded n8n remotion render intake`
- Last stable tag: `v0.1.34`
- Tree state before this handoff update: clean
- Local branch state: ahead of `origin/main` by local commits unless pushed after this handoff.

The source of truth remains source files, not build output:

- `apps/orchestrator/src`
- `packages/`
- root schemas
- `samples/`
- `scripts/`
- `workflows/n8n/nabil8855-workflows/`

Do not use `apps/orchestrator/dist` as the design or implementation source. It
is build output only.

## 2. What was accomplished

- Near-term safety gaps were closed:
  - Orchestrator defaults to localhost.
  - Network bind requires explicit allow plus an API token.
  - API token auth is supported when configured.
  - n8n workflow exports are sanitized and tested.
  - Creative OS bridge carries Pexels b-roll search terms into RAIZ jobs.
  - Preflight warns truthfully for schema-supported local TTS providers that are
    not implemented in local render v1.
- RAIZ now has a guarded n8n Remotion intake endpoint:
  - `POST /integrations/n8n/render/remotion-direct`
  - Requires `RAIZ_ENABLE_REAL_RENDER=true`.
  - Returns `403` before creating job storage when real render is disabled.
  - Maps sanitized n8n `renderPayload` into a valid `remotion_direct` RAIZ Job.
  - Writes `n8n-render-payload.json`.
  - Runs create job -> prepare -> preflight -> Remotion direct render.
  - Writes local MP4 output and standard render/output manifests.
- Artifact inspection detects `n8n-render-payload.json`.
- The Shorts Factory n8n export now points its disabled `Send Render Job` node to:
  - `${RAIZ_RENDER_API_URL:-http://127.0.0.1:4000}/integrations/n8n/render/remotion-direct`
- The n8n render/download/YouTube nodes remain disabled in source control.
- Tests verify the n8n workflow export cannot drift back to the placeholder
  render API URL.

## 3. Current problem

The local bridge is prepared, but live n8n Cloud execution has not been tested in
this repository session.

Root cause:

- RAIZ intentionally does not start or control n8n.
- n8n Cloud cannot reach a developer machine at `127.0.0.1` unless the operator
  provides a reachable local tunnel or equivalent network path.
- Real Remotion rendering remains correctly guarded by `RAIZ_ENABLE_REAL_RENDER=true`.
- YouTube, Drive, analytics, and publishing remain outside this local bridge.

## 4. Next step

Next task:

`Manual n8n -> RAIZ render smoke test`

Required scope:

- Start RAIZ locally with `RAIZ_ENABLE_REAL_RENDER=true`.
- Set `RAIZ_RENDER_API_URL` in the n8n runtime to the reachable RAIZ base URL.
- Enable only the `Send Render Job` node for a manual test.
- Keep download, YouTube, Drive, and analytics nodes disabled.
- Submit one known `renderPayload`.
- Confirm RAIZ writes:
  - `storage/jobs/{job_id}/n8n-render-payload.json`
  - `storage/jobs/{job_id}/job.json`
  - `storage/jobs/{job_id}/render-plan.json`
  - `storage/jobs/{job_id}/preflight-report.json`
  - `storage/jobs/{job_id}/render-manifest.remotion-direct.json`
  - `storage/jobs/{job_id}/output-manifest.json`
  - `storage/jobs/{job_id}/output/{job_id}.mp4`
- Run `npm test`.
- Run `npm run build`.

## 5. What must not be touched

- Do not modify `vendor/`.
- Do not edit `apps/orchestrator/dist`.
- Do not enable YouTube upload from RAIZ.
- Do not add Google Drive execution from RAIZ.
- Do not call n8n from RAIZ.
- Do not add analytics execution.
- Do not store secrets in workflow JSON exports.
- Do not enable render or publish nodes in source-controlled n8n exports.
- Do not bypass `RAIZ_ENABLE_REAL_RENDER=true` for real rendering.

## 6. Lessons from this session

- The n8n workflow contract must match the RAIZ API contract, not an old
  placeholder URL.
- A guarded endpoint should fail before creating storage when execution is
  disabled.
- Source-controlled workflow exports should stay importable, sanitized, and
  disabled for execution-sensitive nodes.
- The safe bridge is local-first: n8n prepares and submits a payload; RAIZ owns
  validation, persistence, preflight, and local MP4 creation.
