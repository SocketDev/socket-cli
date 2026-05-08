---
name: worktree-management
description: Manages git worktrees per the fleet's parallel-Claude-sessions rule — creates new task-worktrees, fans out one worktree per open PR for parallel review, and prunes stale worktrees whose branches were deleted upstream. Use when starting a task that needs an isolated working tree, when reviewing every open PR locally without disturbing the primary checkout, or when cleaning up after merges.
user-invocable: true
allowed-tools: Bash(git worktree:*), Bash(git branch:*), Bash(git fetch:*), Bash(gh pr list:*), Bash(gh auth status), Bash(ls:*), Read
---

# worktree-management

The `Parallel Claude sessions` rule in CLAUDE.md mandates worktrees for branch work. This skill is the helper that makes that ergonomic — three modes, surgical, no auto-cleanup of work you didn't make.

## When to use

- **Starting a task that needs a branch.** Spawn a worktree instead of `git checkout`-ing in the primary checkout.
- **Reviewing all open PRs locally.** One worktree per PR, lined up under `../<repo>-pr-<num>/` so multiple Claude sessions can each take one.
- **Cleaning up stale worktrees** after PRs merge or branches get deleted upstream.

Never use this skill to remove a worktree that has uncommitted work — the _Don't leave the worktree dirty_ rule applies; the dirty worktree is held intentionally until its owner commits.

## Modes

### Mode 1 — `new <task-name>` (default)

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

If `$TASK_NAME` collides with an existing branch, fail with the conflict — never silently overwrite.

### Mode 2 — `pr-fanout`

For each open PR on the current GitHub repo, ensure a worktree exists at `../<repo>-pr-<num>/`. Idempotent — skip PRs whose worktree already exists.

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

This is the multi-Claude review setup — each open PR gets its own checkout so a parallel session can take one without contention.

### Mode 3 — `prune`

Remove worktrees whose **branch no longer exists** on the remote AND whose **working tree is clean**. Never auto-remove a dirty tree — that may be active work.

```bash
git worktree list --porcelain | awk '/^worktree /{path=$2} /^branch /{branch=$2; print path"\t"branch}' | while IFS=$'\t' read -r path branch; do
  # Skip the primary checkout
  if [ "$path" = "$(git rev-parse --show-toplevel)" ]; then continue; fi

  branch_short="${branch#refs/heads/}"

  # Skip if branch still exists on remote
  if git ls-remote --exit-code --heads origin "$branch_short" >/dev/null 2>&1; then
    echo "= keep $path (branch $branch_short still on remote)"
    continue
  fi

  # Skip if working tree is dirty
  if [ -n "$(git -C "$path" status --porcelain 2>/dev/null)" ]; then
    echo "! skip $path (dirty — has uncommitted changes; commit first per 'Don't leave the worktree dirty' rule)"
    continue
  fi

  echo "- prune $path (branch $branch_short gone from remote, tree clean)"
  git worktree remove "$path"
done
```

The `prune` mode never passes `--force` — if the user wants to discard dirty work, they do it deliberately, outside this skill.

## Safety contract

This skill respects four CLAUDE.md rules:

1. **Parallel Claude sessions** — only ever creates new worktrees; never `checkout`-s an existing one.
2. **Don't leave the worktree dirty** — refuses to `prune` a dirty tree.
3. **Public-surface hygiene** — task names must not contain customer / company / internal-tool names. The skill does no redaction; the user picks a clean name.
4. **Default branch fallback** — every base-branch lookup follows the `main → master → assume main` chain via `git symbolic-ref refs/remotes/origin/HEAD`. Never hard-code one or the other.

## Source

The pr-fanout pattern is borrowed from the `/create-worktrees` slash command in https://github.com/evmts/tevm-monorepo/blob/main/.claude/commands/create-worktrees.md, adapted to the fleet's `../<repo>-<task>/` layout convention and the parallel-Claude rule's safety contract.
