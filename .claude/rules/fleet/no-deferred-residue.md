# Name it, then fix it or record it

If you can describe leftover work precisely enough to write it in a reply, you
have already done the expensive part. **Do it, or leave an explicit follow-up.**
Never both name it and drop it.

## The rule

- **Naming residue is the expensive half.** Finding a stale header, a dangling
  reference, a half-applied rename - that is the work. Writing "there is a stale
  header here" and stopping throws that away: the next session re-derives the
  same finding from a cold start, without the context that made it cheap.

- **The next session is almost always this one.** The work gets done anyway. The
  only question is whether it gets done now, with the file open and the reason
  fresh, or later at full price. That asymmetry is the whole argument - the
  deferral does not save the work, it only makes it cost more.

- **Prefer doing it.** A named residue is usually smaller than the sentence
  describing it. If it is a one-line comment fix, the fix is cheaper than the
  paragraph explaining why you skipped it.

- **When you cannot, leave a handle.** An explicit `Follow-up:` / `Next:` line,
  or a `- [ ]` task item, naming the file and the change. "Worth looking at
  sometime" is not a handle; `- [ ] rewrite preflight.mts's @file header for
  --tests` is. Prose buried mid-paragraph gets skimmed past, which is the same
  as dropping it.

- **A blocker is not a deferral.** "I cannot land this because the cascade
  refuses on a dirty template" states a concrete obstacle, names what clears it,
  and is fine. "I am not starting another cycle for this" is a choice, and needs
  a handle.

## Enforcement

- `deferred-residue-guard` (Stop hook) blocks a turn-end reply that names
  leftover work with neither a fix nor a follow-up marker. It reads the reply
  text only, so adding the `Follow-up:` line satisfies it in-turn and it cannot
  deadlock against a guard waiting on the tree. Its escape phrase is listed with
  the hook in
  [`hook-registry`](../../../docs/agents.md/fleet/hook-registry.md).

## Why

A turn ended with: "One known residue I'm not starting another cycle for: the
`@file` header is stale." Accurate, specific, and gone. It took an extra round
trip - "do it or we will forget" - to spend thirty seconds on a comment. The
sentence announcing the deferral was longer than the fix.

Related: [`preflight-before-the-gate`](preflight-before-the-gate.md) is the same
economics one step earlier - pay the cheap local pass instead of discovering the
same set at the expensive boundary.
