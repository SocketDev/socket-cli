# Parallel Claude sessions

Companion to the `### Parallel Claude sessions` rule in `template/CLAUDE.md`. The inline section gives the headline plus the worktree recipe. This file holds the full prohibition list, the worktree recipe broken down, and the umbrella rule.

## The problem

A single socket-\* checkout often has multiple Claude sessions running concurrently: parallel agents, parallel terminals, or git worktrees mapped onto the same `.git/`. Your session is not the only writer. Several common git operations assume otherwise.

## Forbidden in the primary checkout

These commands mutate state that belongs to other sessions:

- **`git stash`**. The stash is a shared store. Another session can `git stash pop` yours.
- **`git add -A` / `git add .`**. Sweeps in files that belong to another session's in-progress work. The `overeager-staging-guard` hook blocks these in real time (bypass: `Allow add-all bypass`).
- **`git checkout <branch>` / `git switch <branch>`**. Yanks the working tree out from under another session editing a file on the current branch.
- **`git reset --hard` against a non-HEAD ref**. Discards another session's commits.
- **bare `git commit` (no pathspec) when the index holds files you didn't touch**. A bare commit commits the ENTIRE index, so another session's staged work lands under your authorship. The `overeager-staging-guard` hook blocks this and steers to `git commit -o <your-files>` (bypass: `Allow index-sweep bypass`).

If a hook flags one of these, the hook is doing its job. Don't bypass.

## Required for branch work: spawn a worktree

```bash
BASE=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null \
       | sed 's@^refs/remotes/origin/@@' || echo main)
git worktree add -b <task-branch> ../<repo>-<task> "$BASE"
cd ../<repo>-<task>
# edit / commit / push from here; primary checkout is untouched
git worktree remove ../<repo>-<task>
```

The `BASE` lookup resolves the remote's default branch. Usually `main`, but legacy repos still use `master`. Never hard-code one; see [Default branch fallback](../../../CLAUDE.md#default-branch-fallback).

After `git worktree remove`, the branch lives in the primary repo's `.git/refs/heads/`. Push it from there if you still need it.

## Required for staging AND commits: surgical, smallest explicit set

Parallel-session-cautious is the **default**, not a special mode. Tread, touch, and commit only the smallest set needed:

1. **Stage surgically.** `git add <specific-file>`. Never `-A` / `.` — that sweeps another session's unstaged edits into your index. The `overeager-staging-guard` hook blocks broad adds at edit time.
2. **Commit surgically.** `git commit -o <your-file> [<your-file> …]` (or `git commit … -- <paths>`). The `-o` / pathspec form commits **only** the named paths regardless of what else is staged — so even if a parallel session staged files into the shared index, they can't ride into your commit. A bare `git commit` whose index holds files this session didn't touch is **blocked** (steered to `-o`); bypass `Allow index-sweep bypass` only when you genuinely mean to commit the whole index.

Both halves matter: surgical `git add` keeps your index clean, surgical `git commit -o` is the backstop for when the index is already polluted (another agent staged concurrently, a hook auto-staged, a prior sweep). Under heavy contention the index is rarely yours alone — naming paths at commit time is the only reliable isolation.

The wheelhouse cascade is the documented exception: it commits the whole index in a fresh worktree off `origin/main`, opted in via the `FLEET_SYNC=1` sentinel.

## Never revert files you didn't touch

`git status` shows unfamiliar changes? Leave them. They belong to:

- Another concurrent session
- An upstream pull that's still settling
- A hook side-effect (formatter, linter, sync-scaffolding)

`git checkout -- <file>` against work you didn't produce destroys the other session's progress.

## Never reach into a sibling fleet repo's path

Cross-repo imports go through `@socketsecurity/lib/...` and `@socketregistry/...` (workspace exports). Path-based imports (`../<sibling-repo>/...`) break in CI, in fresh clones, and on CI agents without the sibling checked out. The `cross-repo-guard` hook blocks these at edit time.

## Never overwrite a file another session is editing

A plain `Edit` / `Write` to a file another session has dirty silently clobbers their uncommitted work — and they may clobber yours right back, edit-for-edit, until one of you stops. (When two sessions share one checkout and both keep re-writing the same source + test files, each pass reverts the other's fixes and neither change ever lands.) The `parallel-agent-edit-guard` hook blocks an Edit/Write/NotebookEdit whose target is **foreign** — dirty, not authored by this session, changed within 30 min — so the clobber is refused before it lands. Companion to `parallel-agent-staging-guard` (git-op version) + `parallel-agent-on-stop-reminder` (turn-end signal); all share `_shared/foreign-paths.mts`. When it fires: let the other session commit first, work on a different file, or use a `git worktree` for an isolated edit. Bypass (only if the other edit is abandoned): `Allow parallel-agent-edit bypass`.

## The umbrella rule

> Never run a git command that mutates state belonging to a path other than the file you just edited.

Stash, add-all, checkout-branch, reset-hard, and revert-other-session's-file are the common shapes. The rule is general. If you can't explain why the command only affects files your session owns, don't run it.

## Pre-commit index races — retry, don't `--no-verify`

When two sessions share one `.git/`, a `git commit` can fail in pre-commit because the *other* session's git op holds the index lock or left a half-written object. The signatures:

- `Unable to create '.git/index.lock': File exists` / `another git process seems to be running`
- `error: bad object` / `fatal: unable to read tree`
- `fatal: cannot lock ref` / `unable to write new index file`

This is **not** a failure in your change — it's contention on the shared `.git/`. When another session's pre-commit holds the index lock on a half-written object, your commit fails reproducibly even though your tree is clean. The wrong reflex is `git commit --no-verify`: it skips the **entire** validation chain (format, lint, tests, signing), so a real defect in your own change ships unseen too.

The right recovery, in order:

1. **Retry.** The lock clears the moment the other session's git op finishes. A second attempt usually succeeds.
2. **Commit from an isolated index** so the two sessions don't share the staging area:
   ```bash
   TMP_IDX=$(mktemp)
   GIT_INDEX_FILE="$TMP_IDX" git add -- path/to/your/file
   GIT_INDEX_FILE="$TMP_IDX" git commit -o path/to/your/file -m "type(scope): …"
   rm -f "$TMP_IDX"
   ```
3. **Only then**, if pre-commit is genuinely broken (not racing) AND you've verified the tree green independently (`git write-tree` clean, tests pass, oxfmt clean), `--no-verify` is the last resort — and it still needs the `Allow no-verify bypass` phrase.

Nudged by `.claude/hooks/fleet/pre-commit-race-reminder/` on any `git commit --no-verify` (cascade `FLEET_SYNC=1` commits exempt).
