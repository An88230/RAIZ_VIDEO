# Show Mode Status Q&A

Show Mode status questions are read-only. They report RAIZ state without running
render, publishing, shell commands, uploads, or git mutation.

## Supported Questions

Examples:

- "الوضع إيه؟"
- "حالة النظام؟"
- "آخر رندر فين؟"
- "هل في حاجة جاهزة للنشر؟"
- "حالة النشر؟"
- "إيه المرحلة الجاية؟"

## Read-only Actions

Show Mode may route status questions to:

- `get_system_status`
- `get_git_status`
- `get_latest_job_status`
- `get_latest_render_status`
- `get_review_package_status`
- `get_publish_package_status`
- `get_next_recommended_action`

These actions read local state only.

## Response Contract

Responses use `show_mode_status_response.schema.json`.

A response may include:

- git status summary
- latest commit
- latest job ID
- latest render output path
- review package status
- publish package status
- whether publishing is planned only / not executed
- next recommended action

## Publishing Semantics

"حالة النشر" means report publishing readiness/status only.

It must not publish.

If no publish package exists, the response should say:

```text
النشر لم يبدأ. الموجود حاليًا خطة/حزمة مراجعة فقط.
```

If a publish package exists, the response should say:

```text
جاهز للمراجعة قبل النشر.
```

Actual publishing requires a separate explicit future action and confirmation.

## Safe Answer Policy

The answer should be short, operational, and local-state based. If state is
unknown, say that it is unknown and recommend the next safe inspection action.

The answer must not invent success, publish state, external upload state, or
remote platform status.
