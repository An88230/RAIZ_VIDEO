# short-video-maker Real Sender Plan

Phase 14 is documentation-only. It defines how a future real sender should be built without adding execution code now.

## 1. Current Safe Pipeline Recap

The current RAIZ pipeline is local-only:

```text
POST /jobs/render
POST /jobs/:id/prepare
POST /jobs/:id/preflight
GET /adapters/short-video-maker/health
POST /jobs/:id/adapter-health
POST /jobs/:id/adapter-payload/short-video-maker
POST /jobs/:id/readiness-review
POST /jobs/:id/adapter-dry-run/short-video-maker
POST /jobs/:id/http-send-plan/short-video-maker
GET /system/execution-guard
GET /system/config
POST /jobs/:id/send-to-short-video-maker
```

The sender currently returns:

- `403` by default.
- `501` when `RAIZ_ENABLE_REAL_RENDER=true`.
- No execution in both cases.

The existing sender stub does not call `short-video-maker`, does not call any external render endpoint, does not start a process, does not start Docker, does not modify `vendor/`, and does not generate video.

Phase 16 also creates `short-video-maker-http-send.plan.json`, a planned-only HTTP sender artifact. It records method, URL, timeout, headers, body artifact, expected response artifact, and safety flags, but it does not make a network request.

## 2. Execution Safety Gates

Every future real sender implementation must pass all gates before any real execution:

- `RAIZ_ENABLE_REAL_RENDER=true`.
- Job status must be `preparing`.
- `metadata.preflight_status` must be `passed`.
- `metadata.readiness_status` must be `passed`.
- `metadata.ready_for_dry_run` must be `true`.
- `metadata.dry_run_request_created` must be `true`.
- `storage/jobs/{job_id}/short-video-maker-request.dry-run.json` must exist.
- `storage/jobs/{job_id}/short-video-maker-http-send.plan.json` should exist for audited HTTP execution planning.
- Adapter health must be `healthy` or `degraded`.
- `vendor/` must remain read-only.
- No `npm install` inside `vendor/`.
- No mutation of vendor source.

If any gate fails, the sender must refuse execution before contacting any upstream service or process.

## 3. Real Sender Design Options

### Mode A: HTTP API Mode

RAIZ sends a request to a running `short-video-maker` server.

Pros:

- Clean isolation.
- No direct process control from RAIZ.
- Easier timeout and response handling.
- Fits the existing adapter boundary.

Cons:

- Server lifecycle must be managed separately.
- Requires stable base URL, port, and health checks.
- Requires clear response contract from upstream.

### Mode B: Docker Service Mode

RAIZ calls an already-running Docker service.

Pros:

- Reproducible runtime.
- Strong isolation from RAIZ code.
- Easier to align with upstream deployment examples.

Cons:

- Docker dependency.
- Port, volume, and environment configuration must be managed.
- Higher local setup burden.

### Mode C: Local Process Mode

RAIZ starts a local command.

Pros:

- Simple proof of concept.
- Minimal separate service setup.

Cons:

- Highest operational risk.
- Harder cleanup and timeout handling.
- Greater chance of local machine drift.
- Should not be the first choice.

Recommendation:

- Start with Mode A only.
- Do not implement Mode B or C until Mode A is stable.

## 4. Required Environment Variables

Phase 15 introduced a centralized config loader for these environment variables:

```text
RAIZ_ENABLE_REAL_RENDER=false
RAIZ_SHORT_VIDEO_MAKER_MODE=http
RAIZ_SHORT_VIDEO_MAKER_BASE_URL=http://localhost:3123
RAIZ_SHORT_VIDEO_MAKER_TIMEOUT_MS=120000
RAIZ_SHORT_VIDEO_MAKER_VENDOR_PATH=vendor/short-video-maker
RAIZ_STORAGE_DIR=storage/jobs
```

Defaults and safety behavior:

- `RAIZ_ENABLE_REAL_RENDER=false` keeps real execution blocked.
- `RAIZ_ENABLE_REAL_RENDER=true` is the only value that unlocks real execution gates.
- `RAIZ_SHORT_VIDEO_MAKER_MODE=http` selects Mode A.
- Any mode other than `http` should be rejected until explicitly implemented.
- `RAIZ_SHORT_VIDEO_MAKER_BASE_URL` must point to an already-running upstream service.
- `RAIZ_SHORT_VIDEO_MAKER_TIMEOUT_MS` must bound every network request.
- `RAIZ_SHORT_VIDEO_MAKER_VENDOR_PATH` is for read-only health and provenance checks only.
- `RAIZ_STORAGE_DIR` must resolve to the local jobs storage root used for artifacts.

`.env.example` contains the safe defaults. Loading config must not start processes, call the network, or enable execution unless `RAIZ_ENABLE_REAL_RENDER=true`.

## 5. Sender Contract

Future sender input:

- `jobId`.
- Dry-run request artifact path.
- Execution guard state.
- Adapter health report.
- Payload.

Future sender output:

```json
{
  "job_id": "...",
  "adapter": "short_video_maker",
  "mode": "http",
  "status": "submitted",
  "external_job_id": null,
  "request_path": "...",
  "response_path": "...",
  "submitted_at": "...",
  "message": "..."
}
```

Allowed `status` values:

```text
submitted
failed
```

The sender must persist the exact request and response used for execution.

## 6. Future Artifacts

Future sender files:

```text
storage/jobs/{job_id}/short-video-maker-http-send.plan.json
storage/jobs/{job_id}/short-video-maker-request.sent.json
storage/jobs/{job_id}/short-video-maker-response.json
storage/jobs/{job_id}/short-video-maker-error.json
```

Rules:

- `short-video-maker-http-send.plan.json` records the planned HTTP request only and must set `will_make_network_request: false`.
- `short-video-maker-request.sent.json` records the exact outbound request.
- `short-video-maker-response.json` records a successful upstream response.
- `short-video-maker-error.json` records a failed attempt, timeout, invalid response, or upstream error.
- Artifacts must be written under `storage/jobs/{job_id}/`.
- Artifacts must not be written into `vendor/`.

## 7. Future Status Transitions

Intended future transitions:

```text
preparing -> rendering
rendering -> rendered
rendering -> failed
```

Rules:

- Submit starts `rendering`.
- A successful upstream response may not mean rendered output exists yet unless the response includes a verified output path.
- If upstream is asynchronous, a polling phase will be required later.
- `rendered` should only be used when the output artifact exists and has been verified locally.
- `failed` should include a clear error summary and link to the stored error artifact.

## 8. Failure Model

Known failure classes:

- Execution guard disabled.
- Missing dry-run request.
- Adapter health missing.
- Upstream server unavailable.
- Timeout.
- Invalid response.
- No output path returned.
- Arabic/RTL render issues.
- Upstream returns success but no file generated.

Expected handling:

- Gate failures must not call upstream.
- Network failures must write `short-video-maker-error.json`.
- Invalid responses must be treated as failures.
- Missing output must not be marked `rendered`.
- Arabic/RTL problems must preserve enough artifacts for diagnosis.

## 9. Non-Goals

Phase 14 does not implement:

- Real sender.
- Docker.
- YouTube upload.
- Google Drive.
- n8n.
- Actual video generation.
- Vendor modification.

## 10. Next Phase Proposal

Phase 15:
Implemented environment config loader and `.env.example`.

Phase 16:
Implemented HTTP sender plan artifact that validates config and writes `short-video-maker-http-send.plan.json` without network calls.

Phase 17:
Implement real HTTP sender behind `RAIZ_ENABLE_REAL_RENDER=true`.
