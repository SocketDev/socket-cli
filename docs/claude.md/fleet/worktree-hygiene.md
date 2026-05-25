# Worktree hygiene

When you finish a code change, **commit it**. Don't end a turn with uncommitted edits, untracked new files, or staged-but-uncommitted hunks lingering in the working tree. A dirty worktree is a half-finished job: another session, another agent, or a future `git checkout` will trip over it, and the user has to clean up after you.

## Rules

- **After finishing a logical unit of work, commit it.** Use a Conventional Commits message per the _Commits & PRs_ rule. Never leave the working tree dirty between turns.
- **Surgical staging only** — `git add <specific-file>`, never `-A` / `.` (per the _Parallel Claude sessions_ rule). The dirty-worktree rule is no excuse to sweep in files you didn't touch. `git add -f` is forbidden for paths containing `/node_modules/` or `package-lock.json` under `.claude/hooks/*/` or `.claude/skills/*/` — past incident: cascading agent ran `git add -f` of node_modules into 6 fleet repos, force-push-only to recover (enforced by `.claude/hooks/node-modules-staging-guard/`; bypass: `Allow node-modules-staging bypass`).
- **Stage only when you're about to commit.** `git add` and `git commit` belong on the same line (chained with `&&`) OR in the same Bash call. Don't stage as a side-effect of "preparing" — staging is a commit-time action. A turn that ends with staged-but-uncommitted hunks is the failure mode the previous bullet warns against (enforced by `.claude/hooks/no-orphaned-staging/`).
- **If you genuinely can't commit yet** (the change is mid-refactor, tests are failing, you're waiting on user input), say so explicitly in the turn summary so the user knows the dirty state is intentional. Silent dirty worktrees are the failure mode.
- **Worktrees from `git worktree add`** — same rule, sharper: a transient task-worktree must be left clean (committed + pushed) before `git worktree remove`, or the removal refuses and you've stranded the work.

## The principle

The working tree at end-of-turn should match the user's mental model of where the work is. "Done" means committed; anything else is paused, and pause states need to be announced.

## Why this matters in a parallel-session world

Multiple Claude sessions targeting the same checkout (parallel agents, terminals, or worktrees on the same `.git/`) compound the cost of dirty state. A `git add -A` from session A sweeps session B's in-flight edits into session A's commit. The surgical-staging + same-call commit rules eliminate that race entirely.
