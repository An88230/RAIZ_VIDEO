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
