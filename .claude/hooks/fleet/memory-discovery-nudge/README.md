# memory-discovery-nudge

**Type:** SessionStart hook (NUDGE — informational, never blocks).

## Trigger

Fires once at session start when a discoverable memory store exists. It resolves:

1. **This repo's** store: `~/.claude/projects/<slug>/memory/`, where `<slug>` is
   the session cwd's absolute path with every `/` (including the leading one)
   replaced by `-`.
2. **The shared fleet (wheelhouse) store**: the same scheme applied to the
   sibling `socket-wheelhouse` checkout (`<parent-of-cwd>/socket-wheelhouse`).

If either has a `MEMORY.md` index, it prints — as SessionStart
`additionalContext` — where the store(s) are and the filing convention. Silent
when neither store has an index (new/empty projects add no noise). When the
session is already in the wheelhouse, the "fleet store" line is omitted (it would
point at itself).

## Why

Persistent memory lives in `~/.claude`, keyed to cwd — **not committed, not
shared across checkouts, not inherited by spawned subagents**. A session
therefore has no way to know its memory exists, nor that a *different* repo's
store (the fleet-wide wheelhouse one) is the correct home for a given fact. The
result, without this hook: fleet-wide lessons get siloed under whatever repo the
session happened to be standing in, invisible to a session in another fleet repo
doing the same fleet work.

This hook surfaces both stores and the rule: **remember a fact in the store of
the repo that OWNS it** — fleet/cross-repo facts → the wheelhouse store; this-repo
facts → here — resolving any repo's store generically as
`~/.claude/projects/<abs-path "/"→"-">/memory/`. So every fleet session (and any
agent reading this) knows where to look and where to file.

## Bypass

None — it only prints informational text and cannot block or mutate anything.
It stays silent on its own when no memory store with a `MEMORY.md` index exists.
