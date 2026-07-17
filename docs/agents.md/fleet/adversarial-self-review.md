# Adversarial self-review

A clean automated review is one reviewer shape finding nothing. On a
substantive diff, treat it as absence of findings — not evidence of absence —
and run the adversarial loop before calling the change reviewed.
Enforcement: `.claude/hooks/fleet/adversarial-review-nudge` fires when a turn
reads a clean bot pass as a verdict with no adversarial evidence.

## When to run it

- A review bot (bugbot, auto-review, copilot) returns no findings on a diff
  that is more than mechanical.
- The user asks to "respond to bot feedback" and there is none — the absence
  IS the finding; supply the review yourself.
- Before merging anything whose failure mode is expensive (setup scripts,
  migrations, shared libraries, release tooling).

Skipping is legitimate for trivial diffs (docs-only, renames). Say so
explicitly; don't let bot silence stand in for review.

## The loop

1. **Independent reviewers, distinct lenses.** Spawn reviewer agents in
   parallel (security, correctness, quality — whatever fits the diff), each
   prompted to REFUTE the change, not appraise it. Diversity of lens catches
   failure modes redundancy cannot.
2. **Findings must be verified, not speculated.** Each claim is tested
   against live behavior: run the code path, reproduce the failure, read the
   dependency's actual source. A reviewer must also refute its own
   non-issues explicitly — refutations are as valuable as findings, and they
   stop the next round from re-litigating settled angles.
3. **Iterate rounds until one adds nothing load-bearing.** Re-review every
   revision: round N attacks what round N-1's fixes introduced. Fixes
   routinely carry their own defects; the loop only converges when a full
   round produces no finding that changes the design.
4. **Verify the revision yourself too.** The author's own test matrix runs
   alongside the reviewers — harness tests catch what prose review misses
   (shell-specific behavior, platform quirks, empty-input edges).
5. **One consolidated record at the end.** Hold outward comments until the
   loop converges, then post a single record: adopted (with what changed),
   accepted-but-not-fixed (with rationale), refuted (with evidence). The
   record is what stops the same angles from being re-argued later.

## Why

The loop's value is empirical: rounds against real diffs replace designs, not
just patch them — a fix that survives one review shape often falls to the
next lens, and the worst defects are frequently ones a previous fix
introduced. A single automated pass has one lens and no adversarial
incentive; the loop manufactures both.
