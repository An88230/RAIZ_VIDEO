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
