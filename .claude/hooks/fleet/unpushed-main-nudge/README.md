# unpushed-main-nudge

Stop hook. Nags at turn-end when the checkout is on the default branch
(main / master) and local HEAD is ahead of its origin counterpart.

## Why

A commit fast-forwarded to local `main` but left unpushed is fragile. A
parallel Claude session that runs `git reset --hard origin/main` (cascade and
repair flows do this) discards every local-only commit ahead of origin, and the
work vanishes with no trace on the branch. "Landing" a commit means it reached
**origin**, not only local main. This reminder surfaces the at-risk gap at the
turn that created it, so the push happens before the next reset.

## When it fires

- Current branch is the repo's default branch (resolved via
  `git symbolic-ref refs/remotes/origin/HEAD`, falling back main → master).
- `git rev-list --count origin/<branch>..HEAD` is greater than zero.

It does NOT fire on a feature branch (an unpushed feature branch is normal) or
when nothing is ahead of origin.

## What to do

Push: `git push origin <branch>`. Then the work survives a reset.

## Not a guard

This is a `-nudge`, not a `-guard`: a Stop hook fires after the turn, so it
cannot block. It makes the unpushed state visible. There is no bypass. Pushing
(or accepting the risk) is the only resolution.
