# parallel-agent-on-stop-nudge

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

When two sessions share one `.git/` checkout, a session running `pnpm run check`
can see dirty files it never touched (a parallel agent's in-flight migration) and
mistake them for its own regression — then commit them. Nothing warns it. This
hook makes the signal visible at the turn that surfaces it.

In a repo opted into `squash-history`, the reminder is stronger: disjoint work
continues immediately because intermediate commit boundaries are ephemeral.
Coordination follows path ownership; only a same-path live collision or the
final repo-wide squash/push warrants pausing.

## Bypass

No bypass — it's a reminder (exit 0), not a block.

## Related

- `parallel-agent-staging-guard` — PreToolUse block on destructive git ops while
  foreign paths exist (the enforcement half).
- `dirty-worktree-stop-guard` — the broader "you left the worktree dirty"
  Stop-time block this is modeled on.
- `overeager-staging-guard` — commit-time block on staging unfamiliar files.
- CLAUDE.md → "Parallel Claude sessions".
