# Contributing to RAIZ Video Factory

RAIZ is an Arabic-first local video production project. Small, focused fixes
to the job schema, orchestrator, render path, RTL captions, documentation, and
tests are welcome.

## Before you start

- Read the [project state and planned phases](docs/PROJECT_STATE_AND_NEXT_PHASES.md)
  so proposed work reflects what is implemented.
- Use Node.js 20+ and FFmpeg for the render path. The optional local narration
  fallback uses macOS `say -v Majed`.
- Open an issue for broad feature work or an architectural change. For a
  focused bug fix, a pull request with a clear reproduction is enough.
- Never commit API keys, credentials, personal data, generated render outputs,
  or media you cannot redistribute. Keep `vendor/` as reference-only.
- For new bundled media, document its source, author, and redistribution
  license; the repository's MIT license does not automatically cover it.

## Local checks

```bash
npm install
npm test
npm run build
npm run raiz:render-arabic -- --job=samples/valid-arabic-9x16-job.json --dry-check
```

The dry check is useful when FFmpeg, Chromium, or the macOS voice fallback is
not available. A full video render is only needed for changes that affect
the output.

## Pull requests

Describe the behavior, the affected path, and the checks you ran. Update
documentation when a field is reserved, a guard changes, or a feature is
added. Keep real rendering, uploads, and external services behind explicit
configuration and preserve the existing review gates.

By submitting a contribution, you agree to license your original
contribution under the project's MIT License. Do not submit third-party
code or media unless its license permits redistribution and you include
the required notices.

© 2026 nabilstudios | info@nabilstudios.com
