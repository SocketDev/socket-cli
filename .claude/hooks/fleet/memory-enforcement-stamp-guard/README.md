# memory-enforcement-stamp-guard

PreToolUse guard. Blocks a Write / Edit / MultiEdit to a durable memory **entry**
whose frontmatter carries no `enforcement:` key.

## Why

A memory steers one agent; an enforcer steers them all. Every codifiable memory
must therefore declare how it is enforced, and
`scripts/fleet/check/memories-are-codified.mts` fails the commit-time gate when
one does not. That check detects the gap after the fact. This guard prevents it,
so a stamped store stays stamped. Full rationale:
[`memory-codification`](../../../../docs/agents.md/fleet/memory-codification.md).

## Scope

- Fires on `…/.claude/projects/<slug>/memory/<name>.md` only.
- Skips the store's `MEMORY.md` index — it carries no frontmatter and states no
  rule.
- Skips every markdown file outside a memory store.
- Fails open when the payload carries no readable written text.

## Purely mechanical, on purpose

The guard asks one decidable question: is there a non-empty `enforcement:` key?
It never judges whether the disposition names a real enforcer. That judgment is
`uncodified-lesson-nudge`'s job — a Stop hook, non-blocking, which fires when a
memory has an enforceable always/never/MUST shape but cites no enforcer. Two
concerns, two surfaces; keep them separate.

## Accepted dispositions

```yaml
enforcement: .claude/hooks/fleet/<name>     # a hook, lint rule, or check ref
enforcement: deferred #<task>               # a tracked follow-up
enforcement: n/a — <reason>                 # a pure-preference lesson
```

## Bypass

`Allow memory-enforcement-stamp bypass`
