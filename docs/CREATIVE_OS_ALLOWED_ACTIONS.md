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
| `show_mode_wake` | Switch Creative OS into Show Mode / Listen Mode after a double clap, wake phrase, or manual trigger. | None. | UI state only; no workflow execution. | Not required. |
| `get_system_status` | Report local RAIZ system state. | RAIZ_VIDEO repository root, `storage/jobs/`, `storage/renders/` | Read-only. | Not required. |
| `get_git_status` | Report local git status summary. | RAIZ_VIDEO repository root. | Read-only. | Not required. |
| `get_latest_job_status` | Report the latest local job status if available. | `storage/jobs/` | Read-only. | Not required. |
| `get_latest_render_status` | Report the latest local render output if available. | `storage/jobs/`, `storage/renders/` | Read-only. | Not required. |
| `get_review_package_status` | Report whether a review package exists. | `storage/jobs/` | Read-only. | Not required. |
| `get_publish_package_status` | Report publishing readiness/status only. | `storage/jobs/` | Read-only; publishing is never executed. | Not required. |
| `get_next_recommended_action` | Suggest the next safe local action from current artifacts. | `storage/jobs/` | Read-only. | Not required. |

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

## Show Mode Status Semantics

Show Mode wake triggers are not workflow commands. They only switch Creative OS
into a listening UI state.

Status questions are read-only. "حالة النشر" means report publishing
readiness/status only. It must not publish, upload, call YouTube, call Google
Drive, call n8n, push git, run render, or execute shell.

If no publish package exists, the response should say:

```text
النشر لم يبدأ. الموجود حاليًا خطة/حزمة مراجعة فقط.
```

If a publish package exists, the response should say:

```text
جاهز للمراجعة قبل النشر.
```

## Action Results

Every action returns `creative_os_action_result.schema.json`. Results summarize
what happened, list artifacts, include logs/errors, and name the next safe
recommended action.
