# RAIZ Video Factory Release Checklist v0.1.0

Release tag: `v0.1.0`

Release scope:
- Local RAIZ job validation and persistence.
- Controlled job lifecycle through local status files.
- Deterministic render preparation, preflight, mock render, and artifact inspection.
- short-video-maker health, payload, dry-run, HTTP plan, mocked HTTP, readiness, guarded real HTTP sender, and output ingestion gates.
- Local review, manual approval, publish package, YouTube upload plan, Google Drive export plan, and n8n workflow plan artifacts.

Non-goals for this release:
- No n8n execution.
- No YouTube upload.
- No Google Drive upload.
- No Docker start.
- No vendor mutation.
- No automatic external rendering.

Pre-tag verification:
- [x] `npm test` passes.
- [x] `npm run build` passes.
- [x] `vendor/` is untouched.
- [x] `v0.1.0` tag did not exist before release tagging.
- [x] Release changes are documentation-only for Phase 27.

Safety gates:
- Real rendering remains guarded by `RAIZ_ENABLE_REAL_RENDER=true`.
- The default behavior remains local-first and blocked by default for real execution.
- Plan artifacts do not upload, execute workflows, start Docker, or make network calls.

Release commit before tagging:
- `49f4a01 feat: add n8n workflow plan artifact`

Tagging steps:
- Create annotated tag `v0.1.0`.
- Push tag `v0.1.0` to origin.
