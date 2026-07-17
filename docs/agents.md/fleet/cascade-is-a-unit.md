# A cascade is a single-unit update, not churn

A fleet cascade propagates ONE logical change across every member. The N
resulting commits — `chore(wheelhouse): cascade template@<sha>` in each repo —
are that single change viewed across N repos, not N separate edits. Treat a
cascade as atomic: one unit in, one unit out.

## Why the framing matters

Calling a cascade "churn" or "noise" invites two failure modes:

1. **Half-applying it.** If the cascade is "a bunch of commits", it feels fine
   to land some members and skip others, or to pause midway. It is not: a
   partially-applied cascade leaves the fleet in a state no member was designed
   for (some on the new template SHA, some on the old). The atomic framing is
   the discipline that keeps the wave whole.
2. **Warning about its size.** A wide cascade touching many repos + hundreds of
   files is the expected shape — see [`drift-watch.md`](drift-watch.md) (§
   "Cascade scope is never a hazard"). The size measures how far the fleet had
   drifted, not a risk to flag.

## What "atomic" requires in practice

- **All-or-nothing per logical change.** The template edit, its dogfood
  cascade, and the fleet propagation are one unit. Land the template edit, then
  cascade — never ship the template edit without cascading (the live copy goes
  stale), and never cascade a half-saved template (the dirty-source guard skips
  a dirty source for this reason).
- **A multi-layer change collapses to one composite BEFORE any mutation.** When
  a single update spans layers (base + kind + per-repo override in the archetype
  template), resolve the full composite first, then commit it in one indivisible
  step — never leave a member half-merged. The layered resolver materializes the
  whole composite into a staging tree, then swaps it in with one rename.
- **A breaking value change is one wave, not a drip.** Renaming a fleet-wide
  enum (`repo.type`) means the schema + every member's config + every consumer
  move together, so no member is invalid mid-flight. Pick one atomic wave over a
  transition window when the values can't legally coexist.

## Related

- [`drift-watch.md`](drift-watch.md) — drift is a defect; cascade scope is safe.
- [`stranded-cascades.md`](stranded-cascades.md) — interrupted waves leave
  stranded local commits/worktrees; the cleanup that keeps the unit whole.
- [`shared-workflow-cascade.md`](shared-workflow-cascade.md) — the gh-aw
  `.md`/`.lock.yml`/`actions-lock.json` trio, a companion atomic-unit example.
