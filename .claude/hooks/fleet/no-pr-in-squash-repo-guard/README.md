# no-pr-in-squash-repo-guard

Blocks `gh pr create` in a squash-history repo.

These repos land work by pushing to `main`. They do not review through
pull requests, and a PR here is not merely redundant — it is costly.
`main` moves constantly and the cascade gate auto-commits, so a feature
branch goes stale within minutes: it collects unrelated cascade commits,
fails checks purely from staleness, and needs rebuilding against a
moving target. All of that is work the PR itself created.

## Why it exists

An agent spent a long session treating this repo as PR-based: opened a
PR, split the cascade commits it accumulated back out onto `main`,
rebuilt the branch twice against a moving target, and chased two failing
checks (`wheelhouse-controlled-files-are-classified`, `bootstrap`) that
turned out to be staleness and passed the moment the branch was current.

The convention was already visible in the tooling — the pre-push gate
auto-commits cascades, refuses a push that "would publish a stale live
tree to the whole fleet", and teaches `git push --no-verify origin
HEAD:main` as the way through in-flight drift. That is a trunk-based
repo describing itself. This guard makes the convention refuse instead
of leaving it to be inferred.

## Scope

Denies `gh pr create` **only when `isSquashHistoryRepo()` is true**, so
PR-based fleet members and every external repo are untouched.

Always allowed: `gh pr view|list|checks|comment|edit|close|merge` — a bot
or an outside contributor can still open a PR here, and refusing to read
or answer it would be worse than the problem.

## Bypass

`Allow pr in squash repo`, typed by the human in a genuine user turn.
