# no-duplicate-pr-guard

PreToolUse Bash hook (blocking, exit 2) that HARD-BLOCKS `gh pr create` /
`gh pr new` when an **OPEN pull request already exists for the same head branch
against the same base**.

## What it catches

- `gh pr create` from a branch that already has an open PR (no `--head` flag →
  head is the current branch).
- `gh pr create --head <owner>:my-branch` where `my-branch` already has an open
  PR, because the owner prefix is stripped before the lookup.
- `gh pr create --draft` - a draft duplicate is still a duplicate.
- `gh pr create --repo <owner>/<repo>` - the lookup is re-pointed at the same
  explicit repo, so a cross-repo create is checked against the right PR list.

The head is the explicit `--head` / `-H` value when present, otherwise the
current branch of the command's effective directory (a leading `cd` / `git -C`
is honored via the shared `git-cwd.mts` resolver). The base is the explicit
`--base` / `-B` value, otherwise the repo's resolved default branch - so a
genuinely different base is **not** treated as a duplicate.

## Why

There is never a legitimate reason to open a second PR for the same head branch
against the same base. The work belongs on the PR that already exists: push to
its branch, or `gh pr edit <n>` to rewrite its title and body. A duplicate
splits the review across two threads, orphans the CI history on the loser, and
wastes a reviewer's attention.

The tail risk is what makes this a block rather than a nudge. Once two PRs exist
for one branch, the natural cleanup is to close one - and **closing a PR is not
reliably reversible**. GitHub can refuse the undo outright:

```
GraphQL: Could not open the pull request (reopenPullRequest)
```

That happened on a live incident: an agent was told to *rework* an existing PR,
closed a different PR instead, could not reopen it, and then started opening a
fourth PR from a branch that already had an open one - all while a colleague was
blocked. The second half of that is mechanically checkable, so it is checked
here. The first half, a close you cannot take back, is not something a hook can
verify after the fact; treat "close" as a one-way door and prefer `gh pr edit`.

## False positives and hangs

Both failure modes were designed against explicitly:

- **Detection is AST-based**, via the shared `_shared/gh-pr-command.mts` parser
  (which rides `shell-command.mts`), never a regex over the command string. A
  `--body` containing the literal text `gh pr create`, or flag-like strings
  inside a quoted body or heredoc, cannot fool it. `&&` chains, quoting, and
  `$(…)` substitution are all handled.
- **The network probe runs last.** `gh pr list` is shelled out to only after the
  parse has confirmed a real `gh pr create` and a head branch has resolved. Every
  other Bash command costs a substring pre-flight (`triggers: ['gh']`) and, at
  most, one local parse.
- **One probe, bounded, fail-open.** The `gh pr list` call carries a fixed 10s
  network timeout and is *not* run through `spawnTimeoutMs` (that helper scales
  LOCAL spawns for win32 and its own doc bars wrapping network calls). Any
  failure - `gh` missing, unauthenticated, not a git repo, DNS blackout, timeout,
  unparseable JSON - returns "no duplicate found" and the command proceeds. A
  guard that blocks work because GitHub was slow is worse than the churn it
  prevents.

## Skipped scenarios

- No open PR for that head/base pair (the normal case).
- An open PR for the same head but a **different** base.
- Any non-`gh` Bash command, or a `gh` subcommand other than `pr create` /
  `pr new` (`gh pr view`/`list`/`edit`/`comment`/… all pass).
- A detached HEAD or non-repo directory, where no head branch resolves.
- Any `gh` / auth / network / parse failure (fails open).

## Bypass

Type `Allow duplicate-pr bypass` (or the short `Allow duplicate-pr`) in a recent
message.

## Exit codes

- `2` - blocked: an open PR already exists for this head and base.
- `0` - allowed (no duplicate, not a `gh pr create`, unresolvable state, a
  failed lookup, or the bypass phrase is present).
