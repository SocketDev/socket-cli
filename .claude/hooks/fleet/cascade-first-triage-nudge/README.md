# cascade-first-triage-nudge

**Type:** Stop hook (soft reminder — never blocks).

## Trigger

Fires when the last assistant turn shows all of:

1. a "not found" / "missing" / "unregistered" error shape, AND
2. mention of a fleet-canonical artifact kind (`socket/*` rule, oxlint plugin,
   `.config/fleet/`, `scripts/fleet/`, `.claude/hooks/fleet/`, `_shared/`, a
   `check-*.mts`), AND
3. evidence the assistant patched the **member** repo's copy (edit verbs aimed
   at a `socket-*` path, "fixed the cascaded/live copy", `git apply`),

without acknowledging the cascade-first path (re-cascade / "check the
wheelhouse" / "incomplete cascade").

## Why

Member repos hold byte-copies of wheelhouse-canonical content. A missing or
unregistered canonical artifact in a member is almost always an **incomplete
cascade** (the cascade skips a fleet dir whose template source is git-dirty),
not a real bug. Debugging or hand-patching the member's copy wastes cycles on
code you don't own there — the fix lives upstream in the wheelhouse template,
and re-cascading propagates it.

## Bypass

None — it's a non-blocking reminder. Acknowledge the cascade-first path (or
genuinely confirm the artifact is absent from the wheelhouse too) and it stays
quiet.

See CLAUDE.md "Never fork fleet-canonical files locally" (cascade-first triage).
