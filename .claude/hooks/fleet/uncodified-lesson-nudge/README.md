# uncodified-lesson-nudge

Stop hook (non-blocking, exit 0, fail-open) — the connector between recording a
lesson in memory and codifying it into enforcing code.

When this turn **wrote** a durable memory lesson (a `feedback`/`project` entry
with an enforceable "always / never / MUST / require / forbid" shape) that
carries **no enforcer citation** (no `socket/<rule>`, no `.claude/hooks/`, no
`scripts/fleet/check/`), it nudges: memory alone doesn't enforce — turn the
lesson into a hook / lint rule / check + `agents.md` doc.

## Fires when

A `Write`/`Edit`/`MultiEdit` in the turn targets a memory-store path
(`…/.claude/projects/<slug>/memory/*.md`) whose content is an enforceable
feedback/project lesson with no enforcer cited.

## Does NOT fire

- `reference` / `user` memories (pointers, who-the-user-is — not codifiable).
- A memory that already cites an enforcer (it's codified).
- Non-memory writes; a turn with no memory write.

## Why separate from compound-lessons-nudge

One surface per concern. `compound-lessons-nudge` fires on a **repeat
finding** made without rule-promotion. This one fires on a **memory write**
without an enforcer. They don't overlap.

## How to act on it

- `/codifying-disciplines` — scans memory, proposes the right surface + tests.
- `node scripts/fleet/codify-rule.mts --memory <path> --apply` — single rule →
  terse CLAUDE.md bullet + `docs/agents.md/{fleet,repo}/<topic>.md` via the AI
  helper.

No bypass phrase — it never blocks. Fails open on a malformed payload.
