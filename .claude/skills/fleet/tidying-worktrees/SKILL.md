---
name: tidying-worktrees
description: Sweep spent clean worktrees whose branches merged or disappeared, while preserving dirty or unpushed work.
user-invocable: true
allowed-tools: Bash(node:*), Bash(git worktree:*), Bash(git branch:*), Bash(git fetch:*), Bash(pnpm i:*), Read
model: claude-haiku-4-5
context: fork
---

# tidying-worktrees

Interrupted cascade waves and finished tasks leave spent worktrees scattered
across the fleet (`chore/wheelhouse-<sha>` leftovers, merged feature branches,
abandoned `ci-cascade-layer` trees). Cleaning each by hand is friction. This
skill is the fleet-wide, conservative, no-prompt sweep — safe to run unattended.

It is the fleet-wide sibling of `managing-worktrees` (which prunes the *current*
repo). Both share one removability predicate (`decideWorktree` in
`lib/tidy-worktrees.mts`); this engine iterates the canonical roster.

## When to use

- **Periodic care.** Run on a `/loop` so worktree clutter never accumulates.
- **Before a cascade wave.** Clear interrupted-wave leftovers so a fresh wave
  starts from a clean fleet.
- **After a batch of merges.** Reclaim the merged-but-not-deleted branches.

## Run it

```bash
# Dry-run (default): report what WOULD be removed, mutate nothing.
node .claude/skills/fleet/tidying-worktrees/lib/tidy-worktrees.mts

# Act: remove spent worktrees fleet-wide.
node .claude/skills/fleet/tidying-worktrees/lib/tidy-worktrees.mts --fix

# Restrict to one repo.
node .claude/skills/fleet/tidying-worktrees/lib/tidy-worktrees.mts --fix --repo socket-cli
```

The engine reads the canonical roster from
`cascading-fleet/lib/fleet-repos.txt` (1 path, 1 reference — never a second
roster) and resolves sibling repos under `$PROJECTS` (default `~/projects`).

## Periodic, no-prompt operation

For background care, drive it with `/loop`:

```
/loop 6h /fleet:tidying-worktrees --fix
```

Every 6 hours it sweeps the fleet and removes only provably-spent worktrees.
Nothing to remove → it says so and exits. It never prompts: the conservative
predicate means an unattended `--fix` can only ever remove worktrees with no
work to lose.

## Removability contract (conservative by construction)

A non-primary worktree is removed ONLY when its tree is **clean** AND it has
**nothing left to land**, where "nothing to land" means EITHER:

1. its branch is **fully merged** into `origin/<base>` (every commit is already
   an ancestor — spent), OR
2. its branch is **gone from the remote** AND the worktree is **not ahead** of
   the base (a never-shared local branch with no unpushed commits).

Everything else is **kept**:

- **dirty** → may be live work, never auto-removed;
- **ahead of base** → carries unpushed commits (this guard is load-bearing: a
  workflow's local-only isolation worktree reads as "branch gone from remote"
  yet may hold unpushed work — removing it would lose that work);
- **on remote with unlanded commits** → a real open branch.

## Gotchas the engine handles

- **Submodule worktrees.** `git worktree remove` refuses a worktree containing
  submodules even when clean. The engine passes `--force` only after the
  clean-tree check, so it clears the submodule guard without discarding work.
- **Relink after removal.** A `git worktree remove` can dangle the primary
  checkout's `node_modules` symlinks. After a `--fix` that removed anything, run
  `pnpm i` in each affected repo's primary checkout (the engine names them).
- **Default branch fallback.** Base resolves via
  `git symbolic-ref refs/remotes/origin/HEAD` → `main` → `master`. Never
  hard-coded.

## Safety contract

1. **Parallel Claude sessions / Don't leave the worktree dirty**: never removes
   a dirty or ahead-of-base worktree — only provably-spent ones.
2. **Default branch fallback**: every base lookup follows `main → master`.
3. **1 path, 1 reference**: the roster + the removability predicate each live in
   exactly one place; `managing-worktrees` and this skill share them.
