# no-force-push-guard

PreToolUse(Bash) hook that blocks a `git push` carrying any force flag unless the user has authorized it with the canonical phrase `Allow force-push bypass` (or a legacy alias) in a recent user turn.

## What it blocks

| Pattern                                          | Bypass phrase             |
| ------------------------------------------------- | -------------------------- |
| `git push --force` / `-f`                         | `Allow force-push bypass` |
| `git push --force-with-lease[=<branch>:<sha>]`    | `Allow force-push bypass` |
| `git push --force-if-includes`                    | `Allow force-push bypass` |

One phrase authorizes BOTH the bare form and the lease form. The split that used to live in `no-revert-guard` (a separate high-friction phrase for bare `--force`) is gone. Typing `Allow force-push bypass` unlocks whichever form the command actually uses. Two legacy aliases are still accepted so existing docs/habits keep working:

- `Allow force-with-lease bypass`
- `Allow force-push-hard bypass`

## The fleet default

The block message always teaches the same canonical shape:

```sh
git fetch origin && git push --force-with-lease=<branch>:$(git rev-parse origin/<branch>) origin <branch>
```

Pinning `--force-with-lease` to the exact expected remote sha, rather than leaving it bare, is the safest form. Git refuses the push outright when `origin/<branch>` doesn't match what was last seen, instead of trusting a fetch that may already be stale.

## Inline sentinel: `SQUASH_HISTORY=1`

The `squashing-history` skill force-pushes the collapsed default branch as an intrinsic part of the squash (the tree is byte-verified identical to a backup branch first). A command prefixed with `SQUASH_HISTORY=1` is checked against `_shared/squash-sentinel.mts`'s hardened shape (exactly one un-chained `git push --force`/`--force-with-lease`/`-f` to a bare remote plus at most one plain branch ref, no refspec, `--mirror`, `--all`, `--delete`, or `--no-verify`) and, when it matches, passes without the typed phrase. Any deviation falls back to needing the phrase.

## How the bypass works

Same transcript scan every fleet guard uses (`_shared/transcript.mts`): the hook reads the conversation transcript and searches recent user-turn text for one of the accepted phrases. The match is case-insensitive; hyphens/spaces/dashes fold together, but every word must appear in order. A phrase from a previous session does not carry over.

## Why split out of no-revert-guard

One surface per concern. `no-revert-guard` now only blocks destructive git (checkout/restore/reset/stash/clean/rm) and the fleet-convention hook bypasses (`--no-verify`, `--no-gpg-sign`, asset-download, stash, bash-write). Force-push detection and the canonical-lease teaching is its own concern with its own phrase.

## Universal, not fleet-only

Clobbering remote work is hazardous in any repo. Unlike the fleet-convention checks that stand down outside a fleet member (`isFleetTarget`), this guard fires everywhere.

## Failing open

Fails open on its own bugs (exit 0 + stderr log): the same trade-off every fleet guard makes. A buggy hook silently allowing the destructive push beats one that crashes and wedges the session.

## Companion files

- `index.mts` — the hook itself
- `package.json` — declares the hook as a workspace package
- `tsconfig.json` — fleet-canonical TS config for hooks

## Test

```sh
pnpm test test/repo/unit/hooks/no-force-push-guard.test.mts
```
