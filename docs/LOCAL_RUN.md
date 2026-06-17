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
  "engine": "short_video_maker"
}
```

## Check Status

```bash
curl -s http://localhost:4000/jobs/smoke-arabic-001/status
```

The phase 1 status store is in memory. Restarting the orchestrator clears queued mock jobs.
