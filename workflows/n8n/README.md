# n8n Workflows

This folder stores source-controlled n8n workflow exports for RAIZ Video
Factory.

## Source of Truth

`workflows/n8n/nabil8855-workflows/` is the canonical location for the
`nabil8855` n8n workflow JSON exports in this repository.

Do not keep a second copy under `docs/`. Documentation may describe n8n behavior,
but importable workflow JSON belongs here.

## Safety Boundary

- These files are sanitized exported/reference workflow artifacts.
- Credential bindings are intentionally removed before committing exports.
- n8n Cloud or another n8n runtime must re-bind credentials after import.
- Never commit API keys, tokens, passwords, secrets, or credential references.
- RAIZ_VIDEO does not start n8n from this repository.
- Any real execution happens in n8n Cloud or another external n8n runtime.
- Workflow execution remains separate from local RAIZ tests and builds.

## Current Workflow Exports

- `RAIZ_Sheet_v2_Setup`
- `RAIZ_Shorts_Factory_YouTube_Shorts_Pipeline`
- `RAIZ_Render_Batch_v2`
- `RAIZ_Daily_Publisher_v2`
- `RAIZ_Analytics_Feedback_Loop_v2`
- `RAIZ_Weekly_Idea_Autopilot`
