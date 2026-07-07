# parallel-agent-staging-guard

PreToolUse (Bash) hook. Blocks git operations that would sweep up, hide, or
destroy another agent's in-flight work — **only when foreign dirty paths are
present** in the checkout. Surgical ops and the all-clear case pass through.

## Gated operations (blocked only when foreign paths exist)

| Op                                              | Hazard                           |
| ----------------------------------------------- | -------------------------------- |
| `git add -A` / `.` / `--all` / `-u`             | stages their unstaged edits      |
| `git commit -a` / `--all`                       | stages + commits their edits     |
| `git stash` / `stash push`                      | hides their working-tree changes |
| `git reset --hard`                              | destroys their uncommitted work  |
| `git checkout <branch>` / `git switch <branch>` | may clobber on switch            |
| `git restore <path>`                            | reverts their changes            |

Detection runs through the shared shell AST parser
(`_shared/shell-command.mts`), so indirection can't dodge it
(`git $(echo add) -A`, `g=git; $g stash`). Broad-add detection reuses
`detectBroadGitAdd` so this hook and `overeager-staging-guard` agree.

## Relationship to overeager-staging-guard

`overeager-staging-guard` owns the **general** broad-add rule (blocks `git add -A`
regardless of parallel agents). This hook adds the parallel-agent-specific
**destructive-op** coverage (stash / reset --hard / checkout / restore) and fires
**only** when the parallel-agent signal is live. On plain `git add -A` both may
fire; messages complement (this one names the foreign paths).

## Foreign-path heuristic

Same as `parallel-agent-on-stop-nudge` — see `_shared/foreign-paths.mts`.

## Config / bypass

- `FLEET_SYNC=1` command prefix — cascade worktrees off origin/main have no
  parallel-session hazard.
- `Allow parallel-agent-staging bypass` in a recent user turn — one action.

Fails open on hook bugs (exit 0 + stderr log).

## Why

When two sessions share one `.git/` checkout, a broad-stage or destructive git
op sweeps up the other's in-flight work — see `parallel-agent-on-stop-nudge`.
The reminder surfaces the signal; this guard refuses the destructive action.
