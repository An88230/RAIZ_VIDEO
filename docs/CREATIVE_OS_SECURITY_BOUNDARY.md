# Creative OS Security Boundary

Creative OS is allowed to ask for work. It is not allowed to execute arbitrary
work. The Local Agent is the safety boundary between language and side effects.

## Hard Rules

- No arbitrary shell execution.
- No free-form terminal commands from model output.
- Only explicitly registered actions can run.
- Dangerous actions are excluded from v1.
- Browser UI sends commands, not secrets.
- Production API keys are loaded by Local Agent from local `.env`.
- `vendor/` remains reference-only.
- YouTube, Google Drive, n8n, publishing, Docker, and install actions are out of
  scope for v1.

## Request Boundary

Creative OS sends:

```json
{
  "command_id": "cmd_...",
  "requested_action": "run_local_render",
  "natural_language_command": "...",
  "payload": {}
}
```

Creative OS does not send:

- API keys.
- Raw shell commands.
- System prompts as executable text.
- Unbounded filesystem paths.

## Path Boundary

Allowed writes must stay under known RAIZ paths:

- `storage/jobs/{job_id}/`
- `storage/renders/`

Allowed reads must be action-specific and documented in the registry. `vendor/`
may be read by specific inspection actions only; it must not be modified.

## Confirmation Boundary

Actions with meaningful side effects require explicit confirmation. Examples:

- `generate_gemini_voice`
- `run_local_render`
- `open_project_folder`
- `open_render_output`
- overwriting generated files

Read-only inspection can run without confirmation.

## Show Mode Boundary

Show Mode wake triggers are UI-state events only. A double clap, wake phrase, or
manual trigger may switch Creative OS into Show Mode / Listen Mode, but it must
not run render, publish, push git, execute shell, upload, or mutate files.

Show Mode status Q&A actions are read-only. They may report local RAIZ status,
latest git state, latest job status, render output paths, review package state,
publish package state, and the next recommended safe action.

"حالة النشر" means report publishing readiness/status only. It must never
publish. If a separate future publish action is introduced, it must be explicit,
registered, confirmed, and outside this read-only status boundary.

## Content Radar Boundary

Content Radar is an analysis boundary, not a scraping or copying boundary. It may
list modes, inspect local contracts, analyze user-supplied references, classify
patterns, and generate original remake or affiliate angle ideas.

Content Radar must not download videos, repost videos, remove watermarks, bypass
copyright, scrape platforms, upload, publish, call YouTube, call Google Drive,
call n8n, execute shell commands, or run model-generated terminal commands.

The Local Agent must preserve the policy:

```text
Copy patterns, not videos.
```

Generated ideas must use original or licensed assets and must avoid unverified
affiliate claims.

## Audit Boundary

Every action writes an audit log entry in the future Local Agent production path.
The audit entry should include:

- command ID
- action ID
- user-facing summary
- confirmed or not
- allowed paths touched
- artifacts created
- errors
- timestamps

## Model Output Boundary

The model may propose a structured action, but the registry decides whether it is
valid. If an action is not registered, the Local Agent must reject it and return
a structured result with `status: "rejected"`.

## Gemini Key Boundary

`GEMINI_API_KEY` must live in local `.env` for the Local Agent production path.
It must not be stored in browser `localStorage`, committed files, or command
payloads.
