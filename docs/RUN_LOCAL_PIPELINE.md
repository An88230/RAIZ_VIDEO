# Run Local Pipeline

This runner exercises the RAIZ safe local pipeline through the orchestrator API. It does not call `short-video-maker`, start Docker, upload to YouTube or Drive, run n8n, make non-localhost network calls, or generate video.

Start the orchestrator:

```bash
npm run dev --workspace @raiz/orchestrator
```

For the full runner, the current mocked HTTP sender endpoint is still protected by the execution guard. Start the server with the guard enabled:

```bash
RAIZ_ENABLE_REAL_RENDER=true npm run dev --workspace @raiz/orchestrator
```

When using npm workspaces, relative config values are resolved from `apps/orchestrator`. This stable root-level command keeps storage and vendor paths anchored to the repository root:

```bash
RAIZ_ENABLE_REAL_RENDER=true \
RAIZ_SHORT_VIDEO_MAKER_VENDOR_PATH="$(pwd)/vendor/short-video-maker" \
RAIZ_STORAGE_DIR="$(pwd)/storage/jobs" \
npm run dev --workspace @raiz/orchestrator
```

Run the pipeline:

```bash
./scripts/run-local-pipeline.sh
```

Or through npm:

```bash
npm run raiz:local-pipeline
```

Defaults:

```text
API: http://127.0.0.1:4000
Sample job: samples/valid-arabic-9x16-job.json
Final job folder: storage/jobs/{job_id}/
```

Optional overrides:

```bash
RAIZ_API_URL=http://127.0.0.1:4000 ./scripts/run-local-pipeline.sh
RAIZ_SAMPLE_JOB=samples/valid-arabic-9x16-job.json ./scripts/run-local-pipeline.sh
```

The script stops on the first failed step and prints the response body. Duplicate `job_id` values still return `409 conflict`; use a clean job id or clear local storage intentionally before re-running.
