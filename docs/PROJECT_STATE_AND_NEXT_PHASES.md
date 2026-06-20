# RAIZ Video Factory - Project State and Next Phases

Last stable tag: `v0.1.34`

## Current Stable Point

`v0.1.34` is the first stable checkpoint for RAIZ Video Factory. It represents a
truthful local Arabic video-rendering foundation, not a complete automated
publishing factory.

At this point, Video Factory Core is stable as a local Arabic production base
with the Pexels pipeline available inside the local render lifecycle.

This stable base includes:

- RAIZ Job schema validation.
- Creative brief to job conversion.
- `remotion_direct` as the Arabic local render engine path.
- Local Arabic Remotion render flow.
- Pexels b-roll fetching and validation pipeline.
- Media search terms in the job schema.
- Testable Pexels b-roll fetcher.
- Metadata merge behavior for job status updates.
- Explicit warnings for schema-supported fields that are reserved or not
  implemented in local render v1.
- Explicit warning when unsupported voice providers fall back to local macOS
  narration.

## Current Architecture Layers

### 1. Video Factory Core

Status: stable at `v0.1.34`.

This is the current local production foundation. It owns the concrete path from
RAIZ job data to a local Arabic render output and related artifacts.

It includes:

- Job schema.
- Sample Arabic jobs.
- Local render scripts.
- Remotion direct rendering.
- Pexels b-roll preparation.
- Output artifacts and render manifests.
- Tests and build verification.

### 2. Orchestrator API

Status: functional, but needs Phase 35 hardening.

The orchestrator API already exposes the main workflow surface for:

- Job validation.
- Queued render intake.
- Prepare.
- Preflight.
- Remotion direct render.
- Job status.
- Artifact inspection.
- Review package creation.
- Publish and platform planning artifacts.
- Short-video-maker compatibility artifacts.

Known hardening needs:

- Controlled retry path from `failed` back to `preparing`.
- Atomic writes for `status.json`.
- Per-job lock or queue to prevent concurrent write collisions.
- Safe `GET /jobs` listing.
- Predictable handling for corrupted job status files.

The orchestrator must be hardened before building a full UI or production local
agent runner on top of it.

### 3. Creative OS / Show Mode / Local Agent Bridge

Status: contracts, documentation, and samples only; this is not a full
production Local Agent Runner.

Current assets define the contract boundary for future Creative OS and Show Mode
work. They describe commands, action results, allowed actions, security rules,
Gemini TTS boundaries, and status Q&A behavior.

Important boundary:

- Creative OS is not an arbitrary command executor.
- Show Mode wake triggers are UI/listening state only.
- The Local Agent is planned as the future safety boundary between natural
  language and side effects.
- Gemini TTS is the official RAIZ voice layer, but render-ready Gemini voice
  generation remains a future local-agent production path.

There is no complete production Local Agent Runner yet.

## Source of Truth

Do not depend on `apps/orchestrator/dist` when evaluating current behavior.

The source of truth is:

- `apps/orchestrator/src`
- package source files under `packages/`
- root schemas and samples
- scripts under `scripts/`

`apps/orchestrator/dist` is build output only. It may be useful for confirming a
build artifact, but it must not be treated as the design source, reviewed as the
primary implementation, or edited directly.

## Do Not Build Yet

Do not build the full UI before Orchestrator hardening.

Do not build a large dashboard yet.

Do not wire arbitrary local agent execution yet.

Do not add new publishing automation before the orchestrator is hardened.

The correct order is:

1. Harden the orchestrator.
2. Improve render quality.
3. Add the production voice layer.
4. Build a minimal control surface.
5. Implement the Local Agent runner.

## Next Steps

### Phase 35 — Orchestrator Hardening

Recommended next phase.

Scope:

- Add a controlled retry transition from `failed` to `preparing`.
- Make `status.json` writes atomic using temp file plus rename.
- Add a per-job lock or queue for updates to the same job.
- Add `GET /jobs` for safe job listing.
- Add tests for each behavior.
- Keep `vendor/` unchanged.
- Keep current render behavior working.
- Run `npm test`.
- Run `npm run build`.

Exit criteria:

- Failed jobs can be retried safely.
- Concurrent status updates cannot corrupt job state.
- Job listing is available without manual filesystem inspection.
- Broken or corrupted status files are handled predictably.
- All tests pass.
- Build passes.

### Phase 36 — Caption Readability

Scope:

- Minimum cue duration.
- Better Arabic cue splitting.
- Maximum characters per cue.
- Prevent short Arabic captions from flashing too quickly.
- Later: Whisper word-level timing.

### Phase 37 — Arabic Voice Layer

Scope:

- Add a real Arabic voice provider.
- Add cross-platform TTS.
- Add voice caching and provider support rules.
- Reduce dependence on macOS `say`.

### Phase 38 — Minimal Control Surface

Scope:

- Job list.
- Job status.
- Warnings.
- Render trigger.
- Output preview.
- Retry failed job after Phase 35 makes retry safe.

### Phase 39 — Local Agent Runner

Scope:

- Validate `creative_os_command.json`.
- Resolve actions through the allowed action registry.
- Execute allowed actions only.
- Return `creative_os_action_result.json`.
- Write audit logs.
- Reject unregistered or unsafe actions.

## Current Rule

The project must stay truthful.

If a field exists but is not implemented, it must warn or be documented as
reserved.

If an action is planned but not executable, it must remain a contract, not a
hidden side effect.

If a feature requires external services, it must be guarded, configured, and
testable without network access.
