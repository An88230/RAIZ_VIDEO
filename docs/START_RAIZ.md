# Start RAIZ Locally

Use the runtime connect script to start only the RAIZ orchestrator:

```bash
./scripts/start-raiz.sh
```

The script reads `.env` if present, defaults `PORT=4000`, prints the local health URLs, prints the local pipeline command, then starts:

```bash
npm run dev --workspace @raiz/orchestrator
```

It does not start `vendor/short-video-maker`, does not start Docker, and does not make external network calls.

Health URLs:

```text
http://127.0.0.1:4000/system/config
http://127.0.0.1:4000/system/execution-guard
http://127.0.0.1:4000/adapters/short-video-maker/health
```

Next local pipeline command:

```bash
RAIZ_API_URL=http://127.0.0.1:4000 ./scripts/run-local-pipeline.sh
```

The script also prints the configured short-video-maker base URL and the read-only discovery command:

```bash
./scripts/discover-short-video-maker.sh
```
