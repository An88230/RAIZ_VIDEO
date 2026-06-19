# Creative OS Allowed Actions

Creative OS commands must resolve to one registered action. Model output cannot
invent commands, shell snippets, paths, or side effects.

## V1 Registry

| action_id | Purpose | Allowed paths | Side effects | Confirmation |
| --- | --- | --- | --- | --- |
| `create_creative_brief` | Create a structured creative brief artifact. | `storage/jobs/{job_id}/creative_brief.json` | Writes local JSON only. | Required before overwrite. |
| `convert_brief_to_job` | Convert a creative brief into RAIZ `job.json` and `editing_plan.json`. | `storage/jobs/{job_id}/` | Writes local JSON only. | Required before overwrite. |
| `generate_gemini_voice` | Generate render-ready Gemini TTS voice asset. | `storage/jobs/{job_id}/assets/voice/` | Calls Gemini TTS in future implementation, writes voice file and manifest. | Required. |
| `run_local_render` | Run the guarded local RAIZ render workflow. | `storage/jobs/{job_id}/`, `storage/renders/` | Generates local MP4 only. | Required. |
| `inspect_job_artifacts` | Read job artifacts inventory. | `storage/jobs/{job_id}/` | Read-only. | Not required. |
| `create_review_package` | Create a local review package after render. | `storage/jobs/{job_id}/review-package.json`, `storage/jobs/{job_id}/review/` | Writes local review artifacts. | Not required if job is rendered. |
| `git_status` | Show repository status. | RAIZ_VIDEO repository root. | Read-only. | Not required. |
| `git_log` | Show recent repository commits. | RAIZ_VIDEO repository root. | Read-only. | Not required. |
| `open_project_folder` | Open RAIZ project folder in the OS. | RAIZ_VIDEO repository root. | Opens local folder in future UI shell. | Required. |
| `open_render_output` | Open produced render output folder or file. | `storage/jobs/{job_id}/output/`, `storage/renders/` | Opens local file/folder in future UI shell. | Required. |

## Required Action Definition

Each action must be registered with:

```json
{
  "action_id": "run_local_render",
  "input_schema": "schema-id-or-path",
  "output_schema": "creative_os_action_result.schema.json",
  "allowed_paths": ["storage/jobs/{job_id}/"],
  "side_effects": ["write_local_files", "generate_local_video"],
  "confirmation_required": true,
  "audit_log": true
}
```

## Excluded From V1

- Arbitrary terminal commands.
- Free-form shell scripts.
- Package installation.
- Dependency updates.
- `vendor/` mutation.
- Docker start/stop.
- Browser-stored production API keys.
- YouTube upload.
- Google Drive upload.
- n8n workflow execution.
- Publishing.
- Desktop automation beyond explicit open-folder/open-file actions.

## Action Results

Every action returns `creative_os_action_result.schema.json`. Results summarize
what happened, list artifacts, include logs/errors, and name the next safe
recommended action.
