# claude-md-rule-add-guard

PreToolUse(Edit|Write|MultiEdit) hook that keeps a hand-added `CLAUDE.md`
**rule** in the terse-index shape: CLAUDE.md is a list of one-liners that point
to `docs/agents.md/{fleet,repo}/<topic>.md`, where the detail lives. A new rule
must link its detail doc; the meat belongs in the doc, not inline.

## Fires when

An Edit/Write to a `CLAUDE.md` adds a rule surface — a new `### ` (or `#### `)
section, OR a marked `- ` bullet (carries 🚨 / `.claude/hooks/` / `socket/<rule>`
/ `scripts/fleet/check/`) — whose added text does **not** link a
`docs/agents.md/{fleet,repo}/<topic>.md` doc.

## Does NOT fire

- A new section, or a marked bullet, that **does** link a detail doc (the
  canonical shape). A whole section pasted with its `Detail:` link passes; a
  lone marked bullet must carry the link itself.
- **Plain** (unmarked) `- ` bullets — prose list items, not rules. Runaway
  section size is capped by `claude-md-section-size-guard`.
- Rewording an existing line (no new rule surface).
- Edits to non-`CLAUDE.md` files.
- The sanctioned writers: `FLEET_SYNC=1` (the cascade copies CLAUDE.md verbatim)
  and `SOCKET_CODIFY_RULE=1` (the codify-rule agent's own write).

## How to land a new rule

Write it terse and link its doc — fleet-block rules link
`docs/agents.md/fleet/<topic>.md`, per-repo rules (the `🏗️ …-Specific`
postamble) link `docs/agents.md/repo/<topic>.md` — then put the detail in that
doc. Or let `codify-rule.mts` author both from a recorded memory:

```
node scripts/fleet/codify-rule.mts --memory <path> --apply
```

## Bypass

`Allow claude-md-rule-add bypass` (verbatim, recent user turn) — for the rare
self-contained section that genuinely needs no detail doc. Fails open on a
malformed payload.
