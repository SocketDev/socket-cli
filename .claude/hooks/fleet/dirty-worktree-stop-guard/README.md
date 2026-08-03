# dirty-worktree-stop-guard

Stop hook that BLOCKS ending a turn when `git status --porcelain` shows any modified, untracked, or staged-but-uncommitted files in the **primary** checkout. The block re-prompts the model to resolve the dirty state before stopping.

## Why

CLAUDE.md "Don't leave the worktree dirty" states the rule: finish a code change → commit it; "done" means committed. The complementary `no-orphaned-staging` hook catches only staged-but-uncommitted index entries; this hook closes the broader gap — **unstaged modifications and untracked files** the agent left behind from a `pnpm run format` sweep, a script side-effect, or "I'll get to it later."

A turn-end stderr reminder proved too easy to scroll past — dirty worktrees still leaked into the next session, which inherited an unexplained multi-file diff with no clear ownership. A blocking Stop decision makes the model finish the job (commit / revert / announce) before it can end the turn.

## What it does

Reads the Stop payload, then runs `git status --porcelain` in `$CLAUDE_PROJECT_DIR`. Filters out untracked-by-default trees (`vendor/`, `third_party/`, `upstream/`, `additions/source-patched/`, `deps/`, `external/`, `pkg-node/`, `*-bundled/`, `*-vendored/`) so vendor drops don't trip it.

On a dirty primary checkout it emits a Stop-hook `{decision:'block'}` with the dirty paths plus the remediation menu (commit / revert / announce-or-bypass). The block is suppressed when Claude Code reports `stop_hook_active: true`, so it fires at most once per turn and can't loop. Fail-open: any error in the hook exits 0 — a guard bug must not wedge every Stop.

## Escapes (any one allows the stop)

- **Clean worktree** — nothing to resolve.
- **A linked git worktree** — a worktree is a staging area for a push to main; you may stack WIP there and defer the commit-discipline gates to the end via `git commit --no-verify`. The guard only blocks in the primary checkout (detected via `git rev-parse --git-dir` resolving under `.git/worktrees/`). In a worktree it emits an informational note, not a block.
- **`Allow dirty-worktree bypass`** — for the rare legit can't-commit-yet case in the primary checkout. One phrase, this turn.

## Related

- `no-orphaned-staging` — Stop hook for staged-but-uncommitted hunks
- `node-modules-staging-guard` — PreToolUse block for `git add -f` of `node_modules/` (bypass: `Allow node-modules-staging bypass`)
- `overeager-staging-guard` — PreToolUse block for `git add -A` / `git add .` (bypass: `Allow add-all bypass`)
- Fleet doc: [`docs/agents.md/fleet/worktree-hygiene.md`](../../docs/agents.md/fleet/worktree-hygiene.md)
