# A peer's claim is a lead

A number or verdict from another agent, a task notification, or an earlier
context is **a lead, not a receipt**. Verify it from a source you can read, or
attribute it. Never restate it as your own finding.

## The rule

- **Relaying and asserting are different acts.** "The other agent reported the
  suite is green" is honest about its source and needs nothing further.
  "Full suite green — 18563 passed" is your finding, and a finding needs a
  command you ran.
- **A count is what makes a claim read as measured.** `18563 passed` looks like a
  receipt. If no run of yours produced it, the number is borrowed precision, and
  it is the most convincing part of a wrong statement.
- **A peer's claim can be true when made and false when you use it.** In a shared
  checkout the tree moves. "Everything is on origin" was accurate for the agent
  who said it and stale by the time it reached the next turn.
- **Re-run rather than reason about it.** The suite is one command. Deciding
  whether a peer's green still holds costs more thought than re-measuring, and
  gets it wrong more often.
- **Same discipline for git state.** "Nothing is left uncommitted" is a claim
  about a thing you can read in one command. Read it.

## Enforcement

- `CLAIM_RULES` in `_shared/unbacked-claims.mts` carries a `suite metric` rule (a
  count beside a pass/fail verdict, or a "full suite green" verdict) and a
  `git state` rule (everything-is-pushed / nothing-is-left shapes). Both demand a
  backing command from this session.
- `ATTRIBUTED_RE` exempts an attributed claim, scoped to the sentence the claim
  sits in — so a "they said" elsewhere in the reply cannot disarm a bare
  assertion here.
- Both surfaces that read the matcher gain the coverage:
  `stop-claim-verify-nudge` at turn-end, and `unbacked-claim-commit-guard` on
  `git commit` / `git push`.

## Why

A peer agent reported "full suite green — 18563 passed, 1339 files" and
"everything from this session is on origin". Running the suite showed 8 failures,
and the git read showed a local commit ahead of origin. Both statements had been
true for that agent at some earlier moment; neither was true when it arrived.

The existing matcher caught one of four relayed shapes when measured, which is
why this is a matcher change rather than a note: the gap was specific, and the
number-bearing shape — the most persuasive one — was the one it missed.

Related: `prose-style-and-doctrine` (every technical claim needs a receipt from
this session), `stop-claim-verify` (do not claim done without one).
