# claude-md-defer-detail-reminder

PreToolUse(Edit|Write|MultiEdit) reminder that fires when a new `###` section is added to CLAUDE.md's fleet block whose body looks like detail (≥3 non-blank lines) but contains no link to `docs/agents.md/{fleet,repo,wheelhouse}/<topic>.md`.

## Why

CLAUDE.md is the fleet rulebook — terse rule + one-line "Why" + link to a docs/ companion file is the canonical shape. Long-form expansions belong externally. Without this nudge, the failure mode is "I'll just inline 6 lines because the byte budget tolerates it" — until the next edit hits the 40 KB whole-file cap or the 8-line per-section cap and the author has to scramble to outsource detail under deadline.

Soft signal: only `PreToolUse(Edit|Write|MultiEdit)` reminders, never blocks. The companion `claude-md-section-size-guard` hard-caps each section at 8 lines (exit 2). This one fires earlier.

## When it fires

ALL of:

1. The edit targets a `CLAUDE.md` (root or repo-specific).
2. The new content adds at least one NEW `###` section inside the fleet block (BEGIN/END markers).
3. The new section's body has ≥3 non-blank lines.
4. The new section's body has NO `docs/agents.md/{fleet,repo,wheelhouse}/` link.

Growing an existing section, adding a short one-liner, or adding a long section that already cites a docs/ companion all pass silently.

## What the reminder says

```
[claude-md-defer-detail-reminder] CLAUDE.md is gaining detail without an external doc:

  File: …/CLAUDE.md

  ### <heading> — N body lines, no docs/ link

  CLAUDE.md is the fleet rulebook; long-form expansion goes in
  `docs/agents.md/fleet/<topic>.md` (or `docs/agents.md/repo/<topic>.md`
  for repo-specific detail). Keep the rule + one-line "Why:" inline,
  link to the expansion. Example:

    🚨 Rule statement. **Why:** one-line incident. Bypass: `Allow X bypass`.
    Spec: [`docs/agents.md/fleet/<topic>.md`](docs/agents.md/fleet/<topic>.md)
    (enforced by `.claude/hooks/fleet/<name>/`).

  This is a soft reminder — the edit proceeds. (The hard 8-line cap
  per section is enforced by `claude-md-section-size-guard`.)
```

## Bypass

No bypass — the reminder never blocks; the edit proceeds.

## Test

```sh
pnpm test
```
