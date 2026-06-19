# Creative OS Bridge

This bridge connects the `visual-intelligence-system/07-creative-os` concept to
RAIZ_VIDEO without merging the HTML app, moving API keys, or changing render
behavior.

## Contract

The bridge input is `creative_brief.schema.json`. It is a structured local JSON
brief with:

- `project`, `objective`, `tone`, `platform`
- `visual_code`
- `template_intent`
- `beats[].text`
- `beats[].visual_intent`
- `beats[].broll_search_terms`

The bridge does not call external APIs. B-roll search terms are preserved as an
editing plan and as publish tags, but no Pexels, YouTube, Drive, or n8n call is
made.

## Conversion

Run:

```bash
node scripts/creative-brief-to-job.mjs --brief=samples/creative-brief-arabic-lexicon.json
```

The converter writes:

```text
storage/jobs/{job_id}/creative_brief.json
storage/jobs/{job_id}/editing_plan.json
storage/jobs/{job_id}/job.json
```

`job.json` is a valid RAIZ Job JSON. `editing_plan.json` keeps Creative OS details
that RAIZ Job Schema does not directly model, such as per-beat visual intent and
b-roll search terms.

Use a temporary storage root for tests or experiments:

```bash
node scripts/creative-brief-to-job.mjs \
  --brief=samples/creative-brief-arabic-lexicon.json \
  --storage=/tmp/raiz-creative-bridge
```

Use `--overwrite` only when replacing a generated local bridge folder is intended.

## Mapping

| Creative brief field | RAIZ output |
| --- | --- |
| `job_id` | `job.job_id`, storage folder |
| `project` | `job.title` |
| `objective` | `job.publish.description` and editing plan objective |
| `tone` | `job.template.style_preset`, editing plan tone |
| `platform` | `job.platform` |
| `visual_code` | editing plan visual code and publish description summary |
| `template_intent.engine` | `job.template.engine` |
| `template_intent.template_id` | `job.template.template_id` |
| `template_intent.caption_position` | `job.captions.position` |
| `beats[0].text` | `job.hook` |
| `beats[].text` | `job.script` |
| `beats[].visual_intent` | editing plan beats |
| `beats[].broll_search_terms` | editing plan search terms and publish tags |

## Non-goals

- No HTML app merge.
- No API key movement.
- No render execution.
- No YouTube upload.
- No Google Drive export.
- No n8n workflow call.
- No `vendor/` change.
