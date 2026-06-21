# RAIZ Video Factory - Handoff

Date: 2026-06-20

## 1. Where the project is now

- Current branch: `main`
- Last reviewed commit: `6677535 docs: track Gemini TTS native audio as GAP-09`
- Remote state at review time: `main` was clean and synced with `origin/main`
- Last stable tag: `v0.1.34`
- Tree state before this handoff document: clean

The source of truth remains source files, not build output:

- `apps/orchestrator/src`
- `packages/`
- root schemas
- `samples/`
- `scripts/`

Do not use `apps/orchestrator/dist` as the design or implementation source. It
is build output only.

## 2. What was accomplished

The current stable foundation is documented and reviewed:

- Video Factory Core is stable as a local Arabic rendering base at `v0.1.34`.
- `remotion_direct` is the Arabic local render path.
- Pexels b-roll exists as part of the local media pipeline.
- Unsupported local render fields are documented or warned about.
- Creative OS, Show Mode, and Local Agent work currently exists as contracts,
  docs, schemas, and samples only.
- No production Local Agent Runner exists yet.
- The project state and next phases are documented in
  [PROJECT_STATE_AND_NEXT_PHASES.md](PROJECT_STATE_AND_NEXT_PHASES.md).
- Known open risks are tracked in [OPEN_GAPS.md](OPEN_GAPS.md).
- Near-term safety work closed the local bind/auth exposure, sanitized n8n
  workflow exports, restored Creative OS b-roll search terms, and made voice
  preflight warnings truthful for unsupported local TTS providers.

## 3. Current problem

The main blocker is still Orchestrator hardening.

Root cause:

- The Orchestrator API is functional, but it is not yet hardened enough to safely
  support a full UI or Local Agent runner.
- Status persistence needs safer write behavior.
- Job updates need a per-job locking or queueing strategy.
- Failed jobs do not yet have a controlled retry path.
- Job listing is not available through a safe API.
- Corrupted status files need predictable handling.
- The orchestrator currently has additional open gaps, especially local exposure
  and truthful preflight behavior, recorded in `OPEN_GAPS.md`.

## 4. Next step

Next task:

`Phase 35 — Orchestrator Hardening`

Required scope:

- Add controlled `failed -> preparing` retry.
- Make `status.json` writes atomic.
- Add a per-job lock or queue.
- Add `GET /jobs`.
- Handle corrupted status files predictably.
- Keep `vendor/` untouched.
- Keep current render behavior working.
- Run `npm test`.
- Run `npm run build`.

Recommended first fix inside Phase 35:

- Default Orchestrator host to `127.0.0.1` or add an explicit local-only safety
  gate before any UI or agent work.

## 5. What must not be touched

- Do not modify `vendor/`.
- Do not treat `apps/orchestrator/dist` as editable source.
- Do not build a full UI before Orchestrator hardening.
- Do not implement arbitrary shell execution.
- Do not turn Creative OS into a free-form command runner.
- Do not add YouTube, Google Drive, n8n, or publishing execution before the
  local gates are hardened.
- Do not add new render features while doing Phase 35 hardening unless they are
  explicitly requested.

## 6. Lessons from this session

- Keep the project truthful: supported fields must either work, warn, or be
  documented as reserved.
- Review `src`, not `dist`.
- The stable render core and the orchestrator are separate layers; do not let UI
  or agent work depend on an unhardened orchestrator.
- Gemini TTS is the intended official voice direction, but it is still contract
  work in RAIZ until a local, testable voice asset path exists.
- Pexels is part of the local media pipeline, but Creative OS-to-Pexels mapping
  still needs a documented fix from `OPEN_GAPS.md`.
- Keep changes small, tested, committed, and clean.
