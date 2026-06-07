# Worktree hygiene

Finish a code change → **commit it**. Don't end a turn with uncommitted edits, untracked files, or staged-but-uncommitted hunks. A dirty worktree is a half-finished job. The next session, the next agent, or your own future `git checkout` trips over it, and the user cleans up after you.

## Rules

- **After finishing a logical unit of work, commit it.** Use a Conventional Commits message per the _Commits & PRs_ rule. Never leave the working tree dirty between turns.
- **Surgical staging only.** `git add <specific-file>`, never `-A` / `.` (per the _Parallel Claude sessions_ rule). The dirty-worktree rule is no excuse to sweep in files you didn't touch. `git add -f` is forbidden for paths containing `/node_modules/` or `package-lock.json` under `.claude/hooks/*/` or `.claude/skills/*/`. Past incident: a cascading agent ran `git add -f` on node_modules across 6 fleet repos; recovery needed a force-push (enforced by `.claude/hooks/fleet/node-modules-staging-guard/`; bypass: `Allow node-modules-staging bypass`).
- **Stage only when you're about to commit.** Put `git add` and `git commit` on the same line (chained with `&&`) or in the same Bash call. Don't stage as a side-effect of "preparing". Staging belongs at commit time. A turn that ends with staged-but-uncommitted hunks is the failure mode the previous bullet warns against (enforced by `.claude/hooks/fleet/no-orphaned-staging/`).
- **If you can't commit yet** (mid-refactor, tests failing, waiting on the user), say so in the turn summary. The user needs to know the dirty state is intentional. Silent dirty worktrees are the failure mode.
- **`git worktree add` worktrees.** Same rule, sharper. Leave the task-worktree clean (committed + pushed) before `git worktree remove`. Otherwise the removal refuses and the work strands.

## Branch discipline (and the checkout trap)

"Smallest chunks" governs the *commit*, not the *branch*. A fresh branch holds a whole queue of related commits — **one logical change does not mean one commit, and one branch is not one commit.** The `no-branch-reuse-guard` enforces this: it fires only when you commit onto a branch that already has a **remote upstream** (a shared branch others may have pushed to). It stays silent on the default branch and on a fresh local branch with no upstream. So:

- **Stack related commits on one fresh local branch.** Building a multi-fix queue? Commit each fix onto the same branch, in order. That is correct and expected, not "branch reuse."
- **"Shared" = has a remote upstream.** Only then cut a new branch. A local-only branch is yours to keep committing to.
- **Never `git checkout` / `git switch` to another branch to "start the next chunk."** Switching branches:
  - discards uncommitted working-tree edits (they don't follow you if they conflict), and
  - **reverts commits that live only on the branch you left** — the new branch doesn't have them, so your files snap back to that branch's state.
- **To move a commit between branches, `git cherry-pick` it** — never switch away from work in progress and hope it follows.

Example: mid-queue on a multi-fix branch, `git checkout <default>` to "branch the next fix off the default" reverts the first fix's already-committed source changes (that fix lives only on the abandoned branch) and leaves the working tree on a branch missing it. To move a commit, `cherry-pick` it onto the target — never leave the branch holding the queue.

## The principle

The working tree at end-of-turn should match where the user thinks the work is. "Done" means committed. Anything else is paused, and you announce pauses.

## Parallel sessions amplify the cost

Multiple Claude sessions can target the same checkout: parallel agents, terminals, worktrees on the same `.git/`. Dirty state compounds across them. A `git add -A` from session A sweeps session B's in-flight edits into session A's commit. Surgical staging plus same-call commits removes the race.
