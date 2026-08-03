# dated-citation-guard

PreToolUse guard (Edit / Write / MultiEdit). **Blocks** (exit 2) with a stderr
explanation.

## What it does

Blocks adding a dated-incident citation to a fleet-facing rule-prose surface:
`CLAUDE.md`, `docs/agents.md/fleet/**`, `.claude/skills/**/SKILL.md`,
`.claude/hooks/fleet/**/README.md`.

The fleet rule ("Compound lessons into rules"): cite the case that motivated a
rule GENERICALLY, as a timeless example, not a dated log. Dates, version
deltas, percentages, and commit SHAs age into a changelog and leak detail.

```
✗ "**Why:** 2026-06-07 pnpm 11.0.0 vs 11.5.1 broke the cascade"
✓ "**Why:** a stale pnpm on PATH fails the version check and aborts the install"
```

## DRY

Detection (`findDatedCitations`) and surface scoping (`isRuleProseSurface`) live
in `_shared/dated-citation.mts` — the same module that backs the commit-time
`check/rule-citations-are-generic.mts`. One matcher, two enforcement points,
no drift.

## Why a guard (was a reminder)

The reminder nudged at exit 0 and, in practice, was never wired into
`settings.json` — so it never fired. The commit-time check still hard-blocks,
but a green edit-time experience let dated citations land and only fail later.
This guard blocks at edit time, the fast-feedback half of the defense-in-depth
pair.

## Bypass

Type `Allow dated-citation bypass` in a recent user turn — for the rare case
where a date is genuinely load-bearing in the prose.
