# memory-codify-nudge

**Type:** PostToolUse hook on Edit/MultiEdit/Write (NUDGE — informational,
never blocks).

## Trigger

Fires when the written `file_path` is a Claude memory-store file:

- `…/.claude/projects/<slug>/memory/<file>.md` — a per-cwd store entry
- `…/memory/MEMORY.md` — a store's index

Silent on every other write.

## What it says

The reminder that lands in the same turn as the save: a memory steers ONE
agent on ONE machine, a guard steers them all. When the memory encodes a rule,
correction, or convention, ALSO codify it as an enforceable artifact — a hook
guard/nudge, a `socket/*` lint rule, a `scripts/fleet/check/*` check, or a
`docs/agents.md` rule — then stamp the memory with an `enforcement:` line. It
points at `/codifying-disciplines` and `scripts/fleet/codify-rule.mts` for the
mechanics. Reference/user memories need no enforcer.

## Division of labor

- **This hook** is immediate and unconditional on a memory write — the
  cheapest moment to codify, while the context is loaded.
- **`uncodified-lesson-nudge`** (Stop) is shape-gated: it re-raises at turn end
  when the written lesson is enforceable AND cites no enforcer, escalating
  across sessions via the learning ledger.
- **`scripts/fleet/check/memories-are-codified.mts`** audits the whole store.

Detail: [`memory-codification`](../../../../docs/agents.md/fleet/memory-codification.md)

## Bypass

None — it only prints informational text and cannot block or mutate anything.
