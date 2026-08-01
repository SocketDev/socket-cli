# no-wheelhouse-pr-guard

Blocks `gh pr create` / `gh pr new` when the target repo is **socket-wheelhouse**.

The wheelhouse has never used pull requests: work lands by committing and
pushing to local `main`, which is canonical and fast-moving. Parallel sessions
land constantly and an auto-committing cascade gate flattens in-flight drift,
so a PR against that trunk goes stale within minutes — it collects unrelated
cascade commits, fails checks purely from staleness, and needs rebuilding
against a moving target. All of that is work the PR itself created.

## Target detection

Two independent signals; either one fires:

1. An explicit `--repo <owner/repo>` / `-R <owner/repo>` (or a URL) on the
   `gh pr create` command that resolves to `SocketDev/socket-wheelhouse`.
2. Otherwise, the origin remote of the directory the command runs in (a
   leading `cd <dir>`, else the hook cwd — resolved via the shared
   `extractGitCwd`) resolving to `SocketDev/socket-wheelhouse` via
   `git remote get-url origin`.

Both `git@github.com:…` and `https://github.com/…` remote spellings are
handled; comparison is case-insensitive and `.git`-suffix tolerant.

## What it allows

- `gh pr create` against any **non-wheelhouse** repo — most fleet members and
  every external repo are PR-based, and this must not touch them.
- `gh pr view|list|checks|comment|edit|close|merge` — a bot or an outside
  contributor can still open a PR against the mirror, and refusing to read or
  answer it would be worse than the problem.
- `git push`, `gh release`, and any non-`pr create` command.

Fails **open** on git / parse errors.

## Relation to no-pr-in-squash-repo-guard

`no-pr-in-squash-repo-guard` is the fleet-wide trunk-repo version (fires in any
squash-history repo, detected from the repo's own config). This guard is
wheelhouse-targeted and resolves the repo from the command's cwd / `--repo`, so
it fires from any session regardless of which repo the session is anchored in.

## Bypass

`Allow wheelhouse PR`, typed by the human in a genuine user turn.
