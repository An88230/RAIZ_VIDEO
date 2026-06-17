# RAIZ Video Factory — Architecture Blueprint / System Design

**Owner:** Nabil88 / nabil88.art  
**Target:** Local-first automated 9:16 Arabic short-video factory  
**Daily Output:** 3 videos/day  
**Primary Platforms:** YouTube Shorts now; Instagram/TikTok later  
**Core Decision:** Hybrid factory architecture, not a single-project dependency

---

## 1. Executive Decision

RAIZ Video Factory must be built as a **control layer above video engines**, not as a direct fork of one project.

The final v1 architecture is:

```text
Google Sheets Queue
  → n8n Orchestration
  → RAIZ Job Schema JSON
  → RAIZ Orchestrator API
  → Render Adapter Layer
      → Primary: short-video-maker + Remotion
      → Arabic Fast/Fallback: MoneyPrinterTurbo
      → Pipeline Reference: Verticals v3 / AutoTube
      → Technical Fallback: editly / VidAPI
      → Final Assembly: FFmpeg + ASS/libass
  → Google Drive Review Folder
  → Human Approval
  → YouTube API Publish
  → Google Sheets Status Update
```

The correct implementation is **adapter-based**:

- RAIZ owns the `job schema`, `queue`, `status lifecycle`, `asset rules`, `Arabic RTL rules`, and `publishing gates`.
- External open-source projects are used as replaceable engines.
- No render engine should own the business logic.

---

## 2. Primary GitHub Repositories

### 2.1 Core / Primary

| Role | Repository | URL | Use |
|---|---|---|---|
| Primary render server | gyoridavid/short-video-maker | https://github.com/gyoridavid/short-video-maker | REST/MCP server, Remotion-based rendering, captions, b-roll, Docker baseline |
| Visual template engine | remotion-dev/remotion | https://github.com/remotion-dev/remotion | Arabic RTL templates, brand identity, typography, motion system |
| Final assembly | FFmpeg | https://github.com/FFmpeg/FFmpeg | final encoding, ASS subtitle burn-in, audio muxing, normalization |

### 2.2 Supporting / Reference Engines

| Role | Repository | URL | Use |
|---|---|---|---|
| Arabic fast/fallback factory | harry0703/MoneyPrinterTurbo | https://github.com/harry0703/MoneyPrinterTurbo | Arabic-friendly reference, FastAPI flow, batch generation, Edge TTS/Whisper ideas |
| End-to-end shorts pipeline | rushindrasinha/youtube-shorts-pipeline | https://github.com/rushindrasinha/youtube-shorts-pipeline | topic → script → visuals → VO → captions → assembly → YouTube upload reference |
| n8n-based YouTube automation reference | Hritikraj8804/Autotube | https://github.com/Hritikraj8804/Autotube | n8n workflow, Docker orchestration, publishing pattern |
| Fallback render engine | mifi/editly | https://github.com/mifi/editly | JSON/JSON5 declarative FFmpeg video rendering fallback |
| Editly API wrapper | moshehbenavraham/vidapi | https://github.com/moshehbenavraham/vidapi | FastAPI wrapper around Editly/FFmpeg |

### 2.3 Reference Only — Do Not Use as v1 Core

| Repository | URL | Reason |
|---|---|---|
| mutonby/openshorts | https://github.com/mutonby/openshorts | useful full-stack reference, but too heavy for v1 |
| calesthio/OpenMontage | https://github.com/calesthio/OpenMontage | agentic video production reference; too broad for the first build |
| FujiwaraChoki/MoneyPrinterV2 | https://github.com/FujiwaraChoki/MoneyPrinterV2 | AGPL risk; study only, do not build commercial core on it |

---

## 3. Non-Negotiable Product Requirements

RAIZ v1 must support:

1. Vertical video: `1080x1920`, `9:16`.
2. Arabic RTL on-screen text and captions.
3. External Arabic VO or Arabic TTS.
4. Captions generated from VO or script, exported as `.srt` and `.ass`.
5. ASS/libass burn-in for Arabic captions.
6. b-roll from Google Drive first; Pexels/Pixabay only as optional fallback.
7. Google Sheets as the production queue.
8. n8n as the automation/orchestration layer.
9. Google Drive as review/export storage.
10. YouTube API publishing only after approval.
11. 3 videos/day minimum, without manual rendering.
12. Local-first development on macOS.
13. Adapter architecture so render engines are replaceable.

---

## 4. System Components

### 4.1 Google Sheets Queue

Google Sheets is the source of jobs.

Required columns:

| Column | Example | Purpose |
|---|---|---|
| job_id | raiz-2026-001 | unique job identifier |
| status | pending | lifecycle state |
| platform | youtube_shorts | target platform |
| title | إنت مش تعبان… إنت مُفرطن | YouTube title/internal title |
| hook | إنت مش تعبان… | opening text |
| script | full Arabic script | VO/caption source |
| template_id | raiz_dark_hook_01 | Remotion composition ID |
| voice_provider | edge / external / elevenlabs | VO source |
| voice_name | ar-SA-HamedNeural | TTS voice |
| broll_folder | drive://RAIZ/assets/overhuman | local/Drive folder mapping |
| music_file | drive://RAIZ/audio/pulse-low.mp3 | optional music |
| caption_style | raiz_ass_bold_center | caption preset |
| scheduled_time | 19:00 | publish time |
| drive_output_url | generated | review file link |
| youtube_url | generated | published link |
| error_log | generated | failure reason |
| locked_at | generated | prevents duplicate processing |

Lifecycle:

```text
pending → locked → processing → rendered → ready_for_review → approved → published
                                      ↘ error
```

Rules:

- n8n must only pick `pending` rows.
- Before render, n8n must set `status=locked` and `locked_at=<timestamp>`.
- Failed jobs go to `error` with clear log.
- Publishing requires `approved=true` or `status=approved`.

---

### 4.2 n8n Orchestration

n8n owns scheduling and cross-service automation.

Main workflow:

```text
Cron Trigger
  → Google Sheets: Read pending rows, limit 3/day
  → Function: Validate required fields
  → Google Sheets: Lock row
  → Function: Build RAIZ Job JSON
  → HTTP Request: POST /jobs to RAIZ Orchestrator
  → Wait/Poll: GET /jobs/{job_id}
  → Google Drive: Upload MP4 to review folder
  → Google Sheets: Update row status=ready_for_review
  → Telegram/Email: Notify for review
```

Publishing workflow:

```text
Manual/Approval Trigger
  → Google Sheets: Read approved rows
  → YouTube API: Upload video as private/unlisted first
  → Google Sheets: Update youtube_url + status=published
```

Required n8n integrations:

- Google Sheets
- Google Drive
- HTTP Request
- YouTube Data API
- Telegram or Gmail notification
- Cron
- Function / Code node

---

### 4.3 RAIZ Orchestrator API

RAIZ Orchestrator is a local API that normalizes jobs and routes them to render adapters.

Recommended implementation:

- Node.js/TypeScript or Python/FastAPI.
- Keep it thin.
- It should not become a heavy studio UI in v1.

Required endpoints:

```http
POST /jobs
GET /jobs/{job_id}
POST /jobs/{job_id}/cancel
GET /health
GET /engines
```

`POST /jobs` behavior:

1. Validate payload against `raiz-job.schema.json`.
2. Create job folder.
3. Resolve assets.
4. Generate or import VO.
5. Generate captions.
6. Route to selected render adapter.
7. Run FFmpeg final pass if required.
8. Return output path and status.

Internal folder per job:

```text
/raiz-factory/jobs/{job_id}/
  job.json
  script.txt
  assets/
  voice/voice.wav
  captions/captions.srt
  captions/captions.ass
  render/raw.mp4
  output/final.mp4
  logs/render.log
```

---

### 4.4 Render Adapter Layer

Every engine receives the same RAIZ Job object but converts it to its native format.

Required interface:

```ts
export interface RenderAdapter {
  id: string;
  canRender(job: RaizJob): Promise<boolean>;
  prepare(job: RaizJob): Promise<PreparedRenderJob>;
  render(prepared: PreparedRenderJob): Promise<RenderResult>;
  cleanup?(jobId: string): Promise<void>;
}
```

Adapters to implement:

```text
adapters/
  shortVideoMaker.adapter.ts
  remotionDirect.adapter.ts
  moneyPrinterTurbo.adapter.ts
  editly.adapter.ts
  ffmpegFinalPass.adapter.ts
```

Adapter priority:

1. `short_video_maker` — default v1 render route.
2. `remotion_direct` — for premium RAIZ templates.
3. `money_printer_turbo` — fallback and Arabic benchmark.
4. `editly` — low-level emergency fallback.
5. `ffmpeg_final_pass` — always available for subtitle burn-in and compression.

---

## 5. Arabic RTL Rendering Strategy

Arabic must be handled as a first-class rendering requirement.

### 5.1 Remotion Text Rules

Use Arabic-capable fonts stored locally:

```text
/apps/render-remotion/public/fonts/
  Cairo-Regular.woff2
  Cairo-Bold.woff2
  IBM-Plex-Sans-Arabic-Regular.woff2
  NotoSansArabic-Regular.woff2
```

Required CSS baseline:

```css
.arabicText {
  direction: rtl;
  unicode-bidi: plaintext;
  text-align: right;
  font-family: "Cairo", "IBM Plex Sans Arabic", "Noto Sans Arabic", sans-serif;
  line-height: 1.25;
  white-space: pre-wrap;
}
```

Avoid:

```css
letter-spacing: 2px;
text-transform: uppercase;
word-break: break-all;
```

These often damage Arabic shaping and readability.

### 5.2 Captions Strategy

Do not rely on FFmpeg `drawtext` for primary Arabic captions.

Use:

```text
SRT → ASS → FFmpeg libass burn-in
```

Final pass example:

```bash
ffmpeg -i raw.mp4 -vf "ass=captions.ass" -c:a copy final.mp4
```

Caption preset example:

```text
Font: Cairo Bold
Alignment: center/bottom or center/mid depending template
Outline: 2-4 px
Safe margins: 90 px horizontal, 160 px vertical
Max line length: 18-24 Arabic characters for hook cards
```

---

## 6. Voice / TTS Strategy

### MVP

Use one of:

- external recorded Arabic VO file, preferred for brand quality.
- Edge TTS for automation tests.

Suggested Edge voices:

```text
ar-SA-HamedNeural
ar-SA-ZariyahNeural
```

### Production

Use:

- ElevenLabs Arabic voice if voice quality is more important than cost.
- Azure Speech if reliability and Arabic support are more important.
- Human VO for premium branded videos.

RAIZ must allow `voice.type`:

```text
external_file
edge_tts
elevenlabs
azure
```

---

## 7. Template Library v1

Start with 3 templates only.

### Template 1 — `raiz_dark_hook_01`

Use for philosophical hook videos.

Visual logic:

- Black background.
- Large Arabic hook.
- Subtle grain/glitch.
- One b-roll layer or abstract motion.
- Captions large and slow.

### Template 2 — `raiz_broll_essay_01`

Use for VO essay shorts.

Visual logic:

- Fullscreen b-roll.
- Warm/cold contrast grade.
- Large word-level captions.
- Low pulse music.
- Hard cuts every 2–4 seconds.

### Template 3 — `raiz_lexicon_card_01`

Use for “قاموس مشاعر العصر الجديد”.

Visual logic:

- Term reveal.
- Definition line.
- Micro-contrast animation.
- Minimal icon/shape layer.
- Strong ending card.

---

## 8. Repository Structure for RAIZ v1

Create a new RAIZ repository with this structure:

```text
raiz-video-factory/
  README.md
  docker-compose.yml
  .env.example

  docs/
    ARCHITECTURE.md
    API.md
    RTL_ARABIC_RULES.md
    N8N_WORKFLOW.md
    RISK_REGISTER.md

  schemas/
    raiz-job.schema.json

  apps/
    orchestrator/
      src/
        index.ts
        routes/jobs.ts
        services/jobStore.ts
        services/assetResolver.ts
        services/voiceService.ts
        services/captionService.ts
        adapters/
          shortVideoMaker.adapter.ts
          remotionDirect.adapter.ts
          moneyPrinterTurbo.adapter.ts
          editly.adapter.ts
          ffmpegFinalPass.adapter.ts
      package.json
      tsconfig.json

    render-remotion/
      src/
        Root.tsx
        templates/
          raiz_dark_hook_01.tsx
          raiz_broll_essay_01.tsx
          raiz_lexicon_card_01.tsx
        components/
          ArabicText.tsx
          CaptionLayer.tsx
          SafeFrame.tsx
      public/fonts/
      remotion.config.ts
      package.json

  workflows/
    n8n/
      raiz-daily-render.workflow.json
      raiz-approval-publish.workflow.json

  scripts/
    clone_upstream_repos.sh
    verify_environment.sh
    smoke_test_arabic_render.sh

  storage/
    jobs/.gitkeep
    exports/.gitkeep
    assets/.gitkeep
    audio/.gitkeep
```

---

## 9. Docker Compose v1

Initial services:

```yaml
services:
  n8n:
    image: n8nio/n8n:latest
    ports:
      - "5678:5678"
    volumes:
      - ./storage/n8n:/home/node/.n8n
    env_file:
      - .env

  short-video-maker:
    image: gyoridavid/short-video-maker:latest-tiny
    ports:
      - "3123:3123"
    volumes:
      - ./storage/short-video-maker:/app/data
    environment:
      - LOG_LEVEL=debug
      - PEXELS_API_KEY=${PEXELS_API_KEY}

  orchestrator:
    build: ./apps/orchestrator
    ports:
      - "4000:4000"
    volumes:
      - ./storage:/storage
      - ./schemas:/schemas
    env_file:
      - .env
    depends_on:
      - short-video-maker
```

Do not add too many services in phase 1. Keep the MVP lean.

---

## 10. API Contract

### 10.1 Create Job

```http
POST /jobs
Content-Type: application/json
```

Body:

```json
{
  "job_id": "raiz-2026-001",
  "platform": "youtube_shorts",
  "aspect_ratio": "9:16",
  "resolution": { "width": 1080, "height": 1920 },
  "language": "ar",
  "direction": "rtl",
  "title": "إنت مش تعبان… إنت مُفرطن",
  "hook": "إنت مش تعبان… إنت مُفرطن.",
  "script": "النص الكامل هنا.",
  "template": {
    "engine": "short_video_maker",
    "template_id": "raiz_dark_hook_01"
  },
  "voice": {
    "type": "edge_tts",
    "provider": "edge",
    "voice_name": "ar-SA-HamedNeural"
  },
  "assets": {
    "broll_source": "google_drive",
    "broll_folder": "drive://RAIZ/assets/overhuman",
    "music": "drive://RAIZ/audio/pulse-low.mp3"
  },
  "captions": {
    "enabled": true,
    "format": "ass",
    "font": "Cairo-Bold",
    "burn_in": true,
    "position": "center"
  },
  "output": {
    "drive_folder": "drive://RAIZ/exports/review",
    "filename": "raiz-2026-001.mp4"
  },
  "publish": {
    "youtube": true,
    "mode": "review_first",
    "scheduled_time": "19:00"
  }
}
```

Response:

```json
{
  "job_id": "raiz-2026-001",
  "status": "processing",
  "engine": "short_video_maker",
  "created_at": "2026-06-17T19:00:00+03:00"
}
```

### 10.2 Job Status

```http
GET /jobs/raiz-2026-001
```

Response:

```json
{
  "job_id": "raiz-2026-001",
  "status": "ready_for_review",
  "output_path": "/storage/exports/raiz-2026-001.mp4",
  "duration_seconds": 42,
  "logs": ["voice generated", "captions generated", "render complete"]
}
```

---

## 11. Implementation Plan for Codex

### Sprint 0 — Repo Bootstrap

Tasks:

1. Create `raiz-video-factory/` repo structure.
2. Add `.env.example`.
3. Add `docker-compose.yml` with n8n + short-video-maker + orchestrator.
4. Add `schemas/raiz-job.schema.json`.
5. Add `scripts/verify_environment.sh`.

Acceptance:

- `docker-compose up -d` starts n8n and short-video-maker.
- `/health` returns OK from orchestrator.

---

### Sprint 1 — RAIZ Orchestrator API

Tasks:

1. Build `/health` endpoint.
2. Build `/jobs` POST endpoint.
3. Validate jobs against schema.
4. Store job files under `/storage/jobs/{job_id}`.
5. Implement a mock render adapter returning a fake output path.

Acceptance:

- Can POST a valid Arabic RAIZ job.
- Invalid payload returns useful validation errors.
- Job folder is created.

---

### Sprint 2 — short-video-maker Adapter

Tasks:

1. Add adapter that converts RAIZ Job to short-video-maker payload.
2. Send HTTP request to local short-video-maker on port 3123.
3. Poll or capture output result.
4. Copy generated MP4 to `/storage/exports`.
5. Log all adapter actions.

Acceptance:

- One Arabic test job renders or reaches the known limitation cleanly.
- If Kokoro English limitation blocks Arabic TTS, adapter must support external VO file path.

---

### Sprint 3 — Arabic VO + Captions

Tasks:

1. Add Edge TTS service for Arabic voice generation.
2. Save VO to `/voice/voice.wav` or `.mp3`.
3. Add caption service that can produce `.srt` from script or Whisper output.
4. Add `.ass` conversion preset for Arabic.
5. Add FFmpeg final pass with ASS burn-in.

Acceptance:

- A 9:16 video is exported with readable Arabic captions.
- Captions do not break Arabic shaping.

---

### Sprint 4 — Remotion Arabic Templates

Tasks:

1. Create Remotion app under `apps/render-remotion`.
2. Add fonts under `public/fonts`.
3. Build `ArabicText` component.
4. Build the 3 starter templates.
5. Add direct Remotion render command.

Acceptance:

- Render `raiz_dark_hook_01` from JSON props.
- Arabic text appears RTL and visually correct.

---

### Sprint 5 — n8n Workflow

Tasks:

1. Create n8n workflow JSON for daily render.
2. Read rows from Google Sheets.
3. Lock selected rows.
4. Send RAIZ Job payload to orchestrator.
5. Upload output to Drive.
6. Update row status.
7. Send notification.

Acceptance:

- Workflow can process 3 jobs in sequence.
- Failed jobs do not block the entire batch.

---

### Sprint 6 — Approval + YouTube Publish

Tasks:

1. Add approval column in Google Sheets.
2. Create second n8n workflow for approved rows.
3. Upload approved MP4 to YouTube as private or scheduled.
4. Update `youtube_url` and `status=published`.

Acceptance:

- No video is published without approval.
- YouTube URL is written back to the row.

---

## 12. Minimum Smoke Test

Codex should create one sample job:

```json
{
  "job_id": "smoke-arabic-001",
  "platform": "youtube_shorts",
  "aspect_ratio": "9:16",
  "resolution": { "width": 1080, "height": 1920 },
  "language": "ar",
  "direction": "rtl",
  "title": "اختبار عربي",
  "hook": "إنت مش تعبان… إنت مُفرطن.",
  "script": "أحيانًا لا يكون التعب من كثرة العمل، بل من كثرة الأشياء التي تطلب منك أن تكون أكثر من إنسان.",
  "template": {
    "engine": "remotion_direct",
    "template_id": "raiz_dark_hook_01"
  },
  "voice": {
    "type": "edge_tts",
    "provider": "edge",
    "voice_name": "ar-SA-HamedNeural"
  },
  "assets": {
    "broll_source": "local",
    "broll_folder": "/storage/assets/smoke",
    "music": "/storage/audio/pulse-low.mp3"
  },
  "captions": {
    "enabled": true,
    "format": "ass",
    "font": "Cairo-Bold",
    "burn_in": true,
    "position": "center"
  },
  "output": {
    "drive_folder": "local",
    "filename": "smoke-arabic-001.mp4"
  },
  "publish": {
    "youtube": false,
    "mode": "review_first"
  }
}
```

Smoke test passes only if:

- MP4 is 1080x1920.
- Arabic text is readable and RTL.
- VO exists.
- Captions are burned in.
- Output is saved under `/storage/exports`.

---

## 13. Key Engineering Rules

1. Do not hard-code one engine into RAIZ.
2. Do not publish automatically in v1.
3. Do not use Pexels as the default brand asset source.
4. Do not rely on English-only Kokoro for Arabic.
5. Do not use MoviePy-only rendering as RAIZ visual core.
6. Do not start with a full UI dashboard.
7. Do not overbuild agentic video production in v1.
8. Keep all job state visible in Google Sheets.
9. Store every job artifact in a deterministic folder.
10. Make every render reproducible from `job.json`.

---

## 14. Final v1 Definition of Done

RAIZ Video Factory v1 is done when:

- It reads 3 pending rows from Google Sheets.
- It creates 3 RAIZ job JSON files.
- It renders 3 Arabic 9:16 videos.
- It writes all outputs to Google Drive review folder.
- It updates statuses in Google Sheets.
- It notifies for approval.
- It publishes only approved videos to YouTube.
- It can rerun a failed job from the saved `job.json`.

---

## 15. Codex First Command

Codex should start by creating the repo skeleton and not touching upstream code yet.

Recommended first task:

```text
Create a new repository named raiz-video-factory with the folder structure described in this blueprint. Add docker-compose.yml, .env.example, schemas/raiz-job.schema.json, apps/orchestrator with a minimal TypeScript Express API, and scripts/clone_upstream_repos.sh. Do not implement rendering yet. First commit should only establish the architecture skeleton and validation-ready job schema.
```

---

© 2025 Nabil88 | nabil88.art
