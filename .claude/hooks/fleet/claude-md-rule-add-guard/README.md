# claude-md-rule-add-guard

PreToolUse(Edit|Write|MultiEdit) hook that blocks **hand-adding a new rule** to a
`CLAUDE.md` and routes it through `scripts/fleet/codify-rule.mts` instead.

Adding a rule by hand means re-fighting the 40KB whole-file cap, the per-`###`
section ≤8-line cap, and the defer-to-`docs/agents.md/<scope>/` split every time.
`codify-rule.mts` owns that: given a recorded memory file it uses the socket-lib
AI helper (`spawnAiAgent`) to write the terse CLAUDE.md bullet within budget AND
author the matching detail doc. This guard makes the script the path.

## Fires when

An Edit/Write to a `CLAUDE.md` whose added content introduces a new rule surface:

- a new `### ` (or `#### `) section heading, or
- a new `- ` bullet carrying a 🚨 hard-rule marker or an enforcer citation
  (`.claude/hooks/`, `socket/<rule>`, `scripts/fleet/check/`).

## Does NOT fire

- Rewording an existing line (no new heading / marked bullet in the added text).
- Edits to non-`CLAUDE.md` files.
- The sanctioned writers: `FLEET_SYNC=1` (the cascade copies CLAUDE.md verbatim)
  and `SOCKET_CODIFY_RULE=1` (the codify-rule agent's own write).

## How to add a rule (the routed path)

1. Record the lesson as a memory file (frontmatter + the *why*).
2. `node scripts/fleet/codify-rule.mts --memory <path> --apply`

It writes the terse CLAUDE.md bullet in the right section (fleet block for a
fleet-wide invariant, the `🏗️ …-Specific` postamble for a repo rule) + the
`docs/agents.md/{fleet,repo}/<topic>.md` detail doc, all within budget.

## Bypass

`Allow claude-md-rule-add bypass` (verbatim, recent user turn) — for the rare
genuine one-off manual edit. Fails open on a malformed payload.
