# Content Radar Modes

RAIZ Content Radar starts with three default modes. Each mode uses Useful
Curiosity and produces analysis that can become original RAIZ productions.

## Common Mode Contract

Each mode must define:

- `mode_id`
- `name`
- `description`
- `search_focus`
- `sample_keywords`
- `source_types`
- `exclude_patterns`
- `safety_rules`
- `scoring_rules`
- `output_format`
- `affiliate_angle_rules`

## Scoring Rules

Every mode scores:

- `curiosity_score`
- `usefulness_score`
- `originality_potential`
- `affiliate_potential`
- `production_difficulty`
- `rights_risk`
- `brand_fit`
- `remake_safety`

Scores use a 0-10 scale. Higher is better except `production_difficulty` and
`rights_risk`, where higher means more difficulty or risk.

## Tech Discovery Mode

Purpose: find modern tech content patterns suitable for short videos and
affiliate angles.

Examples:

- AI tools
- gadgets
- apps
- automation
- useful websites
- productivity tools
- mobile accessories
- desk setup tools

Analyze:

- hook style
- tool/product shown
- problem solved
- audience pain
- affiliate potential
- production difficulty
- safe original remake idea

## Home & Maintenance Mode

Purpose: find home, cleaning, repair, and maintenance video patterns.

Examples:

- cleaning hacks
- home repair
- small tools
- kitchen organization
- bathroom fixes
- before/after transformations
- storage and organization
- appliance maintenance

Analyze:

- visible problem
- before/after strength
- tool used
- usefulness score
- product opportunity
- safety risks
- original remake idea

## Daily Life Mode

Purpose: find everyday-life videos that can be converted into useful short
content.

Examples:

- daily hacks
- routines
- cheap solutions
- product use cases
- habit fixes
- surprising uses for ordinary things
- small lifestyle upgrades

Analyze:

- daily pain
- curiosity hook
- practical payoff
- repeatability
- affiliate fit
- original remake idea

## Samples

Mode samples live in:

- `samples/content-radar-mode-tech.json`
- `samples/content-radar-mode-home-maintenance.json`
- `samples/content-radar-mode-daily-life.json`

Pattern reports use:

- `content_pattern_report.schema.json`
- `content_opportunity.schema.json`
