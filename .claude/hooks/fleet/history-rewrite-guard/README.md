# history-rewrite-guard

PreToolUse Bash hook that blocks a raw history rewrite in a fleet repo and points at the sanctioned path.

## What it blocks

| Pattern                                                     | Why                                                                                          |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `git filter-branch …`                                       | Re-mints every commit unsigned AND restores the original `GIT_COMMITTER_*`                   |
| `git filter-repo …` / `git-filter-repo …`                   | Re-mints every commit unsigned                                                               |
| `git commit-tree …` with no `-S` / `--gpg-sign`             | Mints an unsigned commit object                                                              |

`--help` / `-h` pass through. Detection is tokenized through `_shared/shell-command.mts`, so chains, `$(…)` substitution, and quoting are handled, `git -C <dir> filter-branch` resolves its subcommand correctly, and a `filter-branch` mention inside a grep pattern or a commit message never fires.

Bypass slug: `history-rewrite`.

## The incident

socket-mcp, 2026-07-28. One commit needed a `Co-authored-by:` trailer stripped before a force-push, and a hand-rolled `git filter-branch --msg-filter` was used instead of the script that already owns the operation. Two defects followed, each caught only by a later gate:

1. `filter-branch` re-created 26 commits **unsigned**. `pnpm run check` went red on `commits-are-signed`; without that gate they would have landed on a branch whose ruleset requires signing.
2. Re-signing with `--commit-filter 'git commit-tree -S "$@"'` still failed GitHub verification on two commits, because `filter-branch` **restores** the original `GIT_COMMITTER_*`. The signer disagreed with the restored committer field and the push was rejected: _"Commits must have verified signatures. Found 2 violations."_

`scripts/fleet/strip-ai-attribution.mts` already did it correctly — it sets only `GIT_AUTHOR_NAME` / `GIT_AUTHOR_EMAIL` / `GIT_AUTHOR_DATE` and passes `-S`, deliberately never touching `GIT_COMMITTER_*`. Nothing stopped the hand-roll. This guard is that missing stop.

## What it deliberately does not catch

One surface per concern, and a guard that fires on ordinary work gets disabled.

- **An ordinary `git rebase`.** The most common git command in the fleet; it signs through the repo's normal config. Blocking it broadly would be intolerable.
- **`--no-gpg-sign` / `commit.gpgsign=false`.** Owned by `no-revert-guard` under `Allow gpg …`. A `git commit-tree --no-gpg-sign` falls through to that guard rather than double-blocking here.
- **A scripted-editor rebase reword** (`GIT_SEQUENCE_EDITOR=…` + `git rebase`). Owned by the sibling `attribution-rewrite-nudge`, which NUDGES — a scripted-editor rebase has legitimate non-rewrite uses (todo reordering, autosquash). This hook BLOCKS because `filter-branch` / `filter-repo` have no safe fleet use.
- **Force-push shape.** `no-force-push-guard` (any force push) and `no-total-squash-guard` (many→1 replacement).

## Fail-open

Outside a fleet repo (`isFleetTarget`), on an unparseable command line, or on a payload with no Bash command, the hook returns `undefined`. A guard bug must not wedge every Bash call.
