# RAIZ Video Factory - Open Gaps Register

Discovered: 2026-06-20 (against `v0.1.34`).

This register lists gaps found during code review that are **not** already
recorded in [PROJECT_STATE_AND_NEXT_PHASES.md](PROJECT_STATE_AND_NEXT_PHASES.md)
or other docs. It exists to keep the project truthful: a gap that is known but
undocumented is a hidden risk.

Source of truth for every reference below is `apps/orchestrator/src`,
`packages/`, root schemas, `samples/`, and `scripts/` — never `dist/`.

Severity: **High** = fix before building anything on top · **Medium** = fix
inside the next phase · **Low** = polish / hardening backlog.

| ID | Severity | Gap | Status |
|----|----------|-----|--------|
| GAP-01 | High | Orchestrator binds `0.0.0.0` with no authentication | Fixed |
| GAP-02 | Medium | Creative OS → Pexels seam is broken (bridge drops `search_terms`) | Fixed |
| GAP-03 | Medium | No CI gate (build/test run manually only) | Open |
| GAP-04 | Medium | Preflight reports `passed` for unimplemented voice providers | Fixed |
| GAP-05 | Low | HTTP client has no response size cap and an optional timeout | Open |
| GAP-06 | Low | `PATCH /jobs/:id/status` allows manual state hops past guarded flows | Open |
| GAP-07 | Low | Job schema has no upper bounds on `broll_count` / `search_terms` | Open |
| GAP-08 | Low | Brief→job bridge defaults to an unimplemented `edge_tts` voice | Open |
| GAP-09 | Medium | Gemini TTS native audio (official render voice) is contract-only and unwired | In progress |
| GAP-10 | High | n8n workflow exports include credential references | Fixed |
| GAP-11 | High | Remotion direct render can output black/empty visual frames while reporting rendered | In progress |
| GAP-12 | High | External/Gemini TTS audio URL consumption is unverified or broken | In progress |

---

## GAP-01 (High) — Orchestrator binds `0.0.0.0` with no authentication

- **Where:** [apps/orchestrator/src/index.ts](../apps/orchestrator/src/index.ts) →
  `const host = process.env.HOST ?? "0.0.0.0";`. No auth hook / token check exists
  anywhere in [apps/orchestrator/src/server.ts](../apps/orchestrator/src/server.ts).
- **Why it is undocumented:** every doc example uses `127.0.0.1` (START_RAIZ,
  RUN_LOCAL_PIPELINE, README), but no doc states the actual bind host or the
  absence of authentication. Docs and code disagree, silently.
- **Impact:** on any shared network, an unauthenticated client can create jobs
  (writes to disk), drive the status machine via `PATCH /jobs/:id/status`, read
  job artifacts and paths (`GET /jobs/:id/artifacts`), and fill storage (DoS). If
  `RAIZ_ENABLE_REAL_RENDER=true`, guarded real-execution routes are exposed too.
  This is the executor beneath the (not-yet-built) Local Agent security boundary,
  so it must be safe on its own.
- **Suggested fix:** default `HOST` to `127.0.0.1`; require explicit opt-in for
  `0.0.0.0`. Optionally add a local shared-secret header check. Add a test.
- **Closure:** Fixed. The orchestrator now defaults to `127.0.0.1`, rejects
  non-loopback bind unless `RAIZ_ALLOW_NETWORK_BIND=true` and `RAIZ_API_TOKEN`
  are set, and requires `x-raiz-api-token` on all routes except `GET /health`
  when auth is enabled.

## GAP-02 (Medium) — Creative OS → Pexels seam is broken

- **Where:** [scripts/creative-brief-to-job.mjs](../scripts/creative-brief-to-job.mjs)
  (the `assets` block) sets `broll_source: "pexels"` when beats carry
  `broll_search_terms`, but **never writes `assets.search_terms`**. Confirmed in
  the produced artifact `storage/jobs/creative-arabic-lexicon-001/job.json`
  (`"assets": { "broll_source": "pexels" }`).
- **Why it is undocumented:** this is a contradiction *between* two truthful docs.
  [CREATIVE_OS_BRIDGE.md](CREATIVE_OS_BRIDGE.md) maps `beats[].broll_search_terms`
  to "editing plan search terms and publish tags" (not `assets.search_terms`),
  while [README.md](../README.md) states `assets.search_terms` is what drives the
  Pexels fetch. No doc records that the combination makes the feature unreachable.
- **Impact:** a brief → job → render flow declares `pexels` but `resolveBrollPlan`
  finds no `search_terms`, warns "no usable assets.search_terms", and never
  fetches. The Pexels pipeline marked "stable" in PROJECT_STATE is effectively
  disabled on the canonical Creative OS pipeline. The bridge test
  ([scripts/creative-brief-to-job.test.mjs](../scripts/creative-brief-to-job.test.mjs))
  only asserts `broll_source` and `publish.tags`, so it does not catch this.
- **Suggested fix:** in `convertCreativeBriefToJob`, write
  `search_terms: brollSearchTerms` (and a bounded `broll_count`) into `assets`
  when terms exist; add a bridge-test assertion on `assets.search_terms`.
- **Closure:** Fixed. Creative OS bridge output now carries b-roll terms into
  `assets.search_terms`, writes a capped `assets.broll_count`, and keeps
  `broll_source: "none"` when no terms exist.

## GAP-03 (Medium) — No CI gate

- **Where:** no `.github/workflows` (or any CI config) in the repo.
- **Why it is undocumented:** no doc mentions continuous integration; "workflow"
  appears only in the n8n sense.
- **Impact:** the project commits directly to `main`, yet `npm run build` and
  `npm test` run only manually. A regression can land on the trunk unguarded.
- **Suggested fix:** add a minimal GitHub Actions workflow running
  `npm ci && npm run build && npm test` on push and pull request.

## GAP-04 (Medium) — Preflight passes unimplemented voice providers

- **Where:** [apps/orchestrator/src/preflight.ts](../apps/orchestrator/src/preflight.ts)
  `buildVoiceChecks` — for `edge_tts` / `elevenlabs` / `azure` it only requires a
  provider and voice name, then reports `passed`.
- **Why it is undocumented:** README documents these providers as reserved and the
  render driver warns at render time, but no doc notes that the **preflight
  readiness gate itself** reports the job ready while the render silently falls
  back to macOS `say`.
- **Impact:** the readiness gate is not truthful about the actual narration path,
  which conflicts with the project's "must stay truthful" rule.
- **Suggested fix:** add a warning-level preflight check when the requested voice
  provider is not implemented in local render v1.
- **Closure:** Fixed. Preflight now emits a warning for `edge_tts`, `elevenlabs`,
  and `azure` when required fields are present, while preserving existing failure
  behavior for missing provider or voice name.

## GAP-05 (Low) — HTTP client: no response size cap, optional timeout

- **Where:** [apps/orchestrator/src/httpClient.ts](../apps/orchestrator/src/httpClient.ts)
  reads `response.text()` with no size limit; the timeout is applied only when
  `timeoutMs` is provided.
- **Why it is undocumented:** no doc discusses response limits or client timeouts.
- **Impact:** a very large or hung upstream response could exhaust memory or block
  indefinitely. Low risk today (upstream is a configured localhost service), but
  relevant to orchestrator hardening.
- **Suggested fix:** cap response bytes and apply a sane default timeout.

## GAP-06 (Low) — `PATCH /jobs/:id/status` allows manual state hops

- **Where:** [apps/orchestrator/src/server.ts](../apps/orchestrator/src/server.ts)
  PATCH handler + [apps/orchestrator/src/statusTransitions.ts](../apps/orchestrator/src/statusTransitions.ts)
  (`preparing -> rendering` is a valid transition).
- **Why it is undocumented:** no doc notes that a client can advance status
  manually, bypassing the guarded render / real-send paths.
- **Impact:** acceptable on loopback for manual control, but a real integrity hole
  if the orchestrator is ever exposed (see GAP-01). A client could move a job to
  `rendering` without rendering, then ingest output.
- **Suggested fix:** tie to GAP-01 (loopback + auth); optionally restrict which
  transitions the public PATCH may perform versus internal transitions.

## GAP-07 (Low) — Schema has no upper bounds on b-roll fields

- **Where:** [raiz-job.schema.json](../raiz-job.schema.json) — `assets.broll_count`
  has no `maximum`; `assets.search_terms` has no `maxItems`.
- **Why it is undocumented:** not mentioned anywhere.
- **Impact:** the Pexels fetcher silently caps the count at 5, so out-of-range
  values pass validation but behave unexpectedly.
- **Suggested fix:** add `maximum` to `broll_count` and `maxItems` to
  `search_terms` (aligned with the fetcher cap).

## GAP-08 (Low) — Bridge defaults to an unimplemented `edge_tts` voice

- **Where:** [scripts/creative-brief-to-job.mjs](../scripts/creative-brief-to-job.mjs)
  `defaultVoice = { type: "edge_tts", ... }`.
- **Why it is undocumented:** not mentioned anywhere.
- **Impact:** every bridge-produced job without an explicit voice defaults to a
  provider that the render does not implement (compounds GAP-04: it preflights as
  ready, then renders with `say`).
- **Suggested fix:** default to a voice the render actually supports, or document
  the fallback explicitly on the bridge.

## GAP-09 (Medium) — Gemini TTS native audio is the official render voice but unwired

- **Where:** [GEMINI_TTS_VOICE_LAYER.md](GEMINI_TTS_VOICE_LAYER.md) defines the
  Gemini TTS voice layer as contract-only (Phase 37, "does not implement Gemini
  calls"). The job schema `voice.type` enum
  ([raiz-job.schema.json](../raiz-job.schema.json)) is
  `["external_file", "edge_tts", "elevenlabs", "azure", "none"]` — there is no
  `gemini` value. No Gemini code exists under `apps/` or `scripts/` (only a
  `voice_provider: "gemini_tts"` field in a Creative OS command sample).
- **In-progress source:** the **Gemini TTS native audio** prototype was being
  built (2026-06-19) inside the external Creative OS concept repo
  `https://github.com/An88230/visual-intelligence-system/tree/main/07-creative-os`
  — the same `visual-intelligence-system/07-creative-os` that
  [CREATIVE_OS_BRIDGE.md](CREATIVE_OS_BRIDGE.md) connects to. It is not yet
  integrated into RAIZ_VIDEO.
- **Why it is undocumented (here):** the voice-layer contract exists, but RAIZ has
  no recorded link between the "official voice layer" and the actual render path,
  the schema cannot even express a Gemini/native-audio voice, and the native-audio
  work is tracked nowhere in this repo.
- **Impact:** the intended Arabic production voice does not exist in RAIZ yet, so
  renders fall back to macOS `say` (compounds GAP-04 and GAP-08). The official
  voice layer stays aspirational until it is wired and testable.
- **Suggested fix:** per GEMINI_TTS_VOICE_LAYER.md, have the future Local Agent
  generate `storage/jobs/{job_id}/assets/voice/voice.wav` plus a manifest, then let
  the render consume it as a local asset — either via `voice.type: "external_file"`
  or by adding a `gemini` voice type to the schema. Build it as a guarded, testable
  adapter using the Pexels-fetcher pattern (injectable client, `GEMINI_API_KEY`
  from local `.env`, `npm test` off the network), and honor the no-fake-voice /
  no-silent-provider fallback rule. Use the native-audio prototype above as the
  design input.
- **Status:** In progress (external prototype); not integrated in RAIZ.

## GAP-10 (High) — n8n workflow exports include credential references

- **Where:** `workflows/n8n/nabil8855-workflows/*.json` contained n8n
  `credentials` blocks and credential ids/names from the source n8n runtime.
- **Why it is undocumented:** the n8n exports were organized into the repository
  after this gap register was first written, and the README policy said exports
  must not contain credentials.
- **Impact:** these were not raw API keys, but source-controlled credential
  bindings are still unsafe reference metadata and can create confusion about
  what is portable or secret-bearing.
- **Suggested fix:** remove credential bindings from repository exports and add a
  guard test that fails on `credentials`, `apiKey`, `secret`, `password`, or
  `token` inside workflow JSON files.
- **Closure:** Fixed. n8n workflow exports are sanitized, runtime credential
  binding is documented as an n8n Cloud/runtime responsibility, and a workflow
  export safety test is part of `npm test`.

## GAP-11 (High) — Remotion direct render outputs black/empty visual frame

- **Where:** the `remotion_direct` render path, especially n8n render intake
  (`POST /integrations/n8n/render/remotion-direct`), render-plan generation,
  `render-manifest.remotion-direct.json`, and the Remotion composition under
  [apps/render-remotion](../apps/render-remotion).
- **Observed state:** a job can technically render an MP4 and move to
  `status=rendered`, while the visual result is black, nearly empty, or too weak
  to be considered a valid publishable video. This can happen even when the
  incoming payload contains `topic`, `angle`, `captions`, or `scenes`.
- **Impact:** false success. A job can look complete in storage and API state
  while the produced MP4 is not usable for review or publishing.
- **Required fix:** when a payload contains `angle`, `captions`, or `scenes`, the
  Remotion props and composition must create visible Arabic RTL text layers,
  simple scene cards, and footer text. The render manifest must record the visual
  layer summary. A render must not silently succeed as visually empty.
- **Current closure note:** In progress. The render driver now refuses fully empty
  visual plans, passes scene-card/footer props into Remotion, and writes visual
  diagnostics for the orchestrator manifest.

## GAP-12 (High) — External/Gemini TTS audio URL consumption is unverified or broken

- **Where:** n8n render intake, RAIZ job voice mapping, render-plan generation,
  `scripts/render-arabic-local.mjs`, and `render-manifest.remotion-direct.json`.
- **Relationship to existing gaps:** this is related to GAP-04 and GAP-09, but it
  is not the same gap. GAP-09 means Gemini TTS is not integrated as an official
  RAIZ voice layer. GAP-12 means that even when a ready audio URL exists, the
  render path did not prove it consumed that URL correctly.
- **Observed state:** users may believe Gemini TTS was used, while the render
  actually falls back to local placeholder/fallback audio or produces distorted
  narration. Existing manifests only showed a local `voice.aiff` path and did not
  state whether the audio came from an external URL, fallback, or no external
  source.
- **Required fix:** support ready external audio URL fields only:
  `audio_url`, `voiceover_url`, `tts_url`, `voice.audio_url`, `audio.src`, and
  `audio.url`. If an external URL is found, render-plan/manifest must record a
  masked `external_url` without query secrets. If no URL exists, the manifest
  must say `no_external_audio` and `silent_render` or another explicitly soft
  fallback. The system must not claim Gemini TTS was used without a real audio
  URL, and must not ship noisy robotic fallback audio as a final result.
- **Current closure note:** In progress. n8n intake maps external audio URLs into
  RAIZ jobs, render-plan masks URLs, local render attaches verified external
  audio when possible, and otherwise produces an explicitly silent render.

---

## Already tracked elsewhere (intentionally not repeated here)

These are real, but already recorded in
[PROJECT_STATE_AND_NEXT_PHASES.md](PROJECT_STATE_AND_NEXT_PHASES.md):

- Controlled retry transition from `failed` to `preparing`.
- Atomic `status.json` writes (temp file + rename).
- Per-job lock or queue to prevent concurrent write collisions.
- `GET /jobs` listing.
- Predictable handling of corrupted job status files.
- Caption readability improvements; Arabic voice layer hardening (Later Direction).
- No production Local Agent Runner yet.

## Recommended order

1. GAP-03 (add the CI gate so build/test stop being manual-only).
2. GAP-09 (production Gemini native-audio voice layer) — the real fix behind
   GAP-04 and GAP-08; sequence it with the "production voice layer" step in
   PROJECT_STATE.
3. GAP-05 through GAP-08 (hardening backlog).
