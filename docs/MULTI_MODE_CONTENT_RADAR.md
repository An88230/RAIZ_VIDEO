# Multi-Mode Content Radar

Content Radar is the next intelligence layer for RAIZ. It helps Creative OS
monitor and classify content patterns across several safe default modes without
downloading, reposting, scraping, or publishing.

The principle is:

```text
Copy patterns, not videos.
```

RAIZ may analyze successful formats, hooks, problems, product angles, and remake
opportunities. It must generate original or licensed production ideas.

## Default Philosophy

The default philosophy is Useful Curiosity: content that triggers curiosity
because it is useful, surprising, practical, or solves a daily problem.

The radar must not bias the system toward disgusting, gross, shock-first, or
humiliation-first content. Those may be excluded even if they perform well.

## Architecture

```text
Creative OS UI
  -> Local Agent
  -> Content Radar Mode Registry
  -> Pattern Classifier
  -> Safety and Rights Filter
  -> Opportunity Generator
  -> Affiliate Angle Generator
  -> Audit Log
```

## Components

### Creative OS UI

Creative OS asks for a mode, a topic, or a read-only analysis. It does not send
secrets and does not issue terminal commands.

### Local Agent

The future Local Agent validates the requested action against the allowed action
registry. In this phase, there is no implementation server and no scraping
runtime.

### Content Radar Mode Registry

The registry defines available radar modes through
`content_radar_mode.schema.json`.

Default modes:

- Tech Discovery Mode
- Home & Maintenance Mode
- Daily Life Mode

### Pattern Classifier

The classifier turns an observed content reference into a structured
`content_pattern_report.schema.json` report. It extracts format and intent, not
source media.

### Safety and Rights Filter

The filter rejects or flags:

- video downloading
- reposting
- watermark removal
- copyright bypassing
- unsafe home repair instructions
- medical, financial, or hazardous claims without review
- deceptive affiliate claims

### Opportunity Generator

The generator creates `content_opportunity.schema.json` ideas that are original,
locally producible, and safe to remake.

### Affiliate Angle Generator

Affiliate angles are suggestions only. They must be truthful, disclose
commercial intent, and avoid unverified product claims.

## Local-Safe MVP

Phase 39 creates:

- mode documentation
- JSON contracts
- sample mode definitions
- sample pattern report
- read-only allowed action entries

It does not create:

- video downloaders
- scraping jobs
- reposting tools
- publishing automation
- YouTube, Google Drive, or n8n execution
- arbitrary shell execution
- ElevenLabs dependency

Gemini TTS remains the official future voice layer for RAIZ production.
