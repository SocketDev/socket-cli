# parallel-agent-on-stop-reminder

Stop hook. At turn-end, lists dirty paths this session did **not** author and
that changed recently — the fingerprint of another Claude session sharing the
same `.git/`. Informational (exit 0, never blocks).

## Heuristic

A path is **foreign** when all hold (see `_shared/foreign-paths.mts`):

- it's dirty in `git status --porcelain` (minus untracked-by-default trees:
  `vendor/`, `third_party/`, `upstream/`, `*-bundled`, …),
- its resolved absolute path is not in this session's transcript touched-set
  (Edit / Write / NotebookEdit `file_path` + `git add|mv|rm <path>` from Bash),
- its on-disk mtime is within `maxAgeMs` (default 30 min) of now — so stale
  pre-session dirt doesn't false-fire. Deleted / renamed entries count without a
  mtime check.

## Why

Incident 2026-05-27, socket-lib: a session running `pnpm run check` saw ~6 dirty
files it never touched (a parallel agent's esbuild→rolldown migration) and nearly
investigated them as its own regression, then nearly committed them. Nothing
warned it. This hook makes the signal visible at the turn that surfaces it.

## Config

- Disable: `SOCKET_PARALLEL_AGENT_REMINDER_DISABLED=1`.

## Related

- `parallel-agent-staging-guard` — PreToolUse block on destructive git ops while
  foreign paths exist (the enforcement half).
- `dirty-worktree-on-stop-reminder` — the broader "you left the worktree dirty"
  reminder this is modeled on.
- `overeager-staging-guard` — commit-time block on staging unfamiliar files.
- CLAUDE.md → "Parallel Claude sessions".
