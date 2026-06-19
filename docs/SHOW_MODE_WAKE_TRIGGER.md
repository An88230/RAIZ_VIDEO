# Show Mode Wake Trigger

Show Mode is a safe listening state for Creative OS. A double clap or wake
trigger may activate Show Mode / Listen Mode, but it must not run work by
itself.

## Trigger Semantics

A trigger may only:

- switch the UI state to `show_mode`
- start listening
- show a visible listening indicator
- optionally play live UI speech through Gemini TTS

A trigger must not:

- run render
- publish
- push git
- execute shell
- run model-generated terminal commands
- upload to YouTube, Google Drive, or n8n
- mutate `vendor/`

## Trigger Contract

The trigger payload is validated by `show_mode_trigger.schema.json`.

Key fields:

- `trigger_id`
- `trigger_type`
- `source`
- `detected_at`
- `ui_state_before`
- `ui_state_after`
- `listen_mode`
- `safety`

The only valid state transition for v1 is:

```text
idle -> show_mode
```

`listen_mode` must be `true`.

## Allowed Trigger Types

- `double_clap`
- `wake_phrase`
- `manual_button`

## Safety Requirements

The trigger safety block must state:

```json
{
  "will_execute_action": false,
  "will_run_render": false,
  "will_publish": false,
  "will_push_git": false,
  "will_execute_shell": false
}
```

If any of those values are true, the Local Agent must reject the trigger.

## Interaction Flow

1. User double-claps or uses a wake phrase.
2. Creative OS validates a trigger event.
3. UI enters Show Mode.
4. UI starts listening for a separate command or question.
5. The next utterance is routed through allowed action contracts.

## Gemini TTS

Gemini TTS may be used for live UI speech such as:

```text
أنا سامعك.
```

This is not render voice. Render voice remains a saved asset generated through
the future `generate_gemini_voice` action.
