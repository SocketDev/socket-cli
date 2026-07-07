# CLAUDE.md is a bullet index

`CLAUDE.md` is a flat, scannable index of rules. **Every rule is its own `- `
bullet — never a prose paragraph.** This holds in the fleet block AND the
repo-specific (🏗️) section.

## The rule

- **One rule, one bullet.** Write `- <rule, one line>. (\`hook/path\`)
  [\`topic\`](docs/agents.md/<tier>/<topic>.md)`. Do not write a rule as a
  flowing sentence or paragraph — if it isn't a `- ` bullet, it isn't a rule
  entry.
- A `###` section may open with **at most one** short orienting sentence;
  everything actionable beneath it is bullets.
- **Detail lives in docs, not here.** The bullet states the rule in one line and
  links out to `docs/agents.md/{fleet,repo}/<topic>.md`. Never inline the
  explanation, the list of cases, or the rationale.
- Adjacent guards keep this honest: `claude-md-size-guard` (40 KB cap),
  `claude-md-section-size-guard` (≤8 lines/section), `claude-md-defer-detail-nudge`,
  `claude-md-rule-add-guard` (a new section / marked bullet must link a doc).

## Why

A paragraph buries the rule inside sentences; a bullet list is greppable and
lets a reader scan the entire contract in seconds. The index says *what* in one
line and points to *where* — the depth belongs in the topic doc, not the index.
This has been corrected repeatedly; it is now a standing rule, not a per-edit
reminder.
