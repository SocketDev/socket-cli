---
name: fleet-managing-worktrees
description: Manages git worktrees per the fleet's parallel-Claude-sessions rule. Creates new task-worktrees, fans out one worktree per open PR for parallel review, and prunes spent worktrees that have nothing left to land — clean trees whose branch was deleted upstream OR is fully merged into the remote default branch. Use when starting a task that needs an isolated working tree, when reviewing every open PR locally without disturbing the primary checkout, or when cleaning up after merges.
user-invocable: true
allowed-tools: Bash(node:*), Bash(git worktree:*), Bash(git branch:*), Bash(git fetch:*), Bash(gh pr list:*), Bash(gh auth status), Bash(ls:*), Read
model: claude-haiku-4-5
context: fork
---

# managing-worktrees

The `Parallel Claude sessions` rule in CLAUDE.md mandates worktrees for branch work. This skill is the helper that makes that ergonomic. Three modes, surgical, no auto-cleanup of work you didn't make.

## When to use

- **Starting a task that needs a branch.** Spawn a worktree instead of `git checkout`-ing in the primary checkout.
- **Reviewing all open PRs locally.** One worktree per PR, lined up under `../<repo>-pr-<num>/` so multiple Claude sessions can each take one.
- **Cleaning up stale worktrees** after PRs merge or branches get deleted upstream.

Never use this skill to remove a worktree that has uncommitted work. The _Don't leave the worktree dirty_ rule applies; the dirty worktree is held until its owner commits.

## Modes

### Mode 1: `new <task-name>` (default)

Spawn a new worktree at `../<repo>-<task-name>/` based on the remote's default branch.

```bash
TASK_NAME="$1"  # required
REPO_NAME=$(basename "$(git rev-parse --show-toplevel)")
WORKTREE_PATH="../${REPO_NAME}-${TASK_NAME}"
BRANCH="${TASK_NAME}"

# Default-branch fallback per CLAUDE.md: main → master → assume main.
BASE=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@')
if [ -z "$BASE" ] && git show-ref --verify --quiet refs/remotes/origin/main;   then BASE=main;   fi
if [ -z "$BASE" ] && git show-ref --verify --quiet refs/remotes/origin/master; then BASE=master; fi
BASE="${BASE:-main}"

git fetch origin "$BASE"
git worktree add -b "$BRANCH" "$WORKTREE_PATH" "origin/$BASE"
echo "✓ Worktree ready at $WORKTREE_PATH on branch $BRANCH (base: $BASE)"
echo "  cd $WORKTREE_PATH"
```

If `$TASK_NAME` collides with an existing branch, fail with the conflict. Never silently overwrite.

### Mode 2: `pr-fanout`

For each open PR on the current GitHub repo, ensure a worktree exists at `../<repo>-pr-<num>/`. Idempotent: skip PRs whose worktree already exists.

```bash
gh auth status >/dev/null  # fail loudly if not authenticated
REPO_NAME=$(basename "$(git rev-parse --show-toplevel)")

gh pr list --json number,headRefName --jq '.[]' | while read -r pr_json; do
  PR=$(echo "$pr_json" | jq -r '.number')
  BRANCH=$(echo "$pr_json" | jq -r '.headRefName')
  WORKTREE_PATH="../${REPO_NAME}-pr-${PR}"

  if [ -d "$WORKTREE_PATH" ]; then
    echo "= pr-${PR} already at $WORKTREE_PATH"
    continue
  fi

  git fetch origin "$BRANCH:refs/remotes/origin/$BRANCH" 2>/dev/null
  git worktree add "$WORKTREE_PATH" "origin/$BRANCH"
  echo "+ pr-${PR} (branch $BRANCH) → $WORKTREE_PATH"
done

git worktree list
```

This is the multi-Claude review setup: each open PR gets its own checkout so a parallel session can take one without contention.

### Mode 3: `prune`

Remove a worktree when its **working tree is clean** AND it has **nothing left to land**. "Nothing to land" means EITHER the branch is **fully merged into the remote's default branch** (every commit is already an ancestor of `origin/<base>`) OR the **branch no longer exists on the remote AND the worktree is not ahead of the base**. A worktree that is **ahead of the base** is ALWAYS kept — even when its branch is gone from the remote — because a local-only branch never pushed (e.g. an isolation worktree) reads as "branch gone from remote" yet carries unpushed commits that pruning would destroy.

This is the same removability predicate (`decideWorktree`) the fleet-wide `tidying-worktrees` sweep applies — Mode 3 is the single-repo entry to that one engine, so it inherits the load-bearing `aheadOfBase` guard rather than re-deriving a weaker check in shell.

```bash
# Dry-run (default): report what WOULD be pruned in the CURRENT checkout.
node .claude/skills/fleet/tidying-worktrees/lib/tidy-worktrees.mts --here

# Act: prune the spent worktrees of the current checkout.
node .claude/skills/fleet/tidying-worktrees/lib/tidy-worktrees.mts --here --fix
```

`--here` resolves the current checkout's git toplevel (not a `$PROJECTS` sibling) and runs the engine against only that repo. The engine never discards work: a dirty tree is kept, a worktree ahead of the base is kept, and removal uses the clean-tree-gated `--force` only to clear the submodule-worktree guard. After pruning, `pnpm i` in the primary checkout — a `git worktree remove` can dangle the main checkout's `node_modules` symlinks (per the _Don't leave the worktree dirty_ rule); the engine prints that reminder.

### Mode 4: `land`

Move already-verified commits onto `origin/<default>` with the least ceremony that's still safe — the fast path for when the primary checkout's branch has **diverged** from origin (a parallel session squashed your commits onto origin via PR, leaving your local with unsquashable duplicates) or is **actively churned** by another session, so a direct `git push` would be rejected and a `reset --hard` would discard that session's work.

The fleet **lints as it edits**, so a commit's diff already passed the gates the pre-commit / pre-push hooks re-run. Re-running them on land is ceremony that can wedge (a pre-commit staged-test run hung 55 min in practice) or crash (a fresh worktree has no `node_modules`, so the lib-importing pre-push hooks throw `ERR_MODULE_NOT_FOUND`). Mode 4 replaces the manual cherry-pick → fast-forward dance with one command: it re-asserts the lint gate on the landing diff (fast, deterministic — NOT a heavy test re-run), cherry-picks the commits onto a throwaway worktree branched off `origin/<base>` (a clean tree), confirms a clean fast-forward, then fast-forwards `origin/<base>`. NEVER force-pushes; if origin moved since, it aborts and tells you to re-run.

```bash
# Dry-run (default): plan + re-assert the lint gate, don't push.
node .claude/skills/fleet/managing-worktrees/lib/land.mts --last 2

# Act: fast-forward origin/<base> to the last 2 commits of HEAD.
node .claude/skills/fleet/managing-worktrees/lib/land.mts --last 2 --push

# Land explicit SHAs (oldest-first cherry-pick order).
node .claude/skills/fleet/managing-worktrees/lib/land.mts <sha-a> <sha-b> --push
```

The lint re-assert is the contract: a clean diff lands instantly; a lint failure ABORTS (the lint-as-edit contract was bypassed → `pnpm run fix` + re-commit). Only pass `--no-verify-lint` when the checkout genuinely can't run oxlint (no `node_modules`) AND you know the diff was lint-clean at edit time. The throwaway worktree + branch are cleaned up automatically; the `git push --no-verify` is deliberate (the diff is lint-verified above, and a fresh worktree's hooks can't load the lib).

## Safety contract

This skill respects four CLAUDE.md rules:

1. **Parallel Claude sessions**: only ever creates new worktrees; never `checkout`-s an existing one.
2. **Don't leave the worktree dirty**: refuses to `prune` a dirty tree OR one ahead of the base with unpushed commits — Mode 3 delegates the decision to the shared `decideWorktree` predicate, so the guard can't drift.
3. **Public-surface hygiene**: task names must not contain customer / company / internal-tool names. The skill does no redaction; the user picks a clean name.
4. **Default branch fallback**: every base-branch lookup follows the `main → master → assume main` chain via `git symbolic-ref refs/remotes/origin/HEAD`. Never hard-code one or the other.

## Source

The pr-fanout pattern is borrowed from the `/create-worktrees` slash command in https://github.com/evmts/tevm-monorepo/blob/main/.claude/commands/create-worktrees.md, adapted to the fleet's `../<repo>-<task>/` layout convention and the parallel-Claude rule's safety contract.
