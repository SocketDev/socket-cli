# dirty-worktree-stop-reminder

Stop hook that emits a stderr reminder at turn-end if `git status
--porcelain` shows any modified, untracked, or staged-uncommitted
files in the harness project dir.

## Why

CLAUDE.md "Don't leave the worktree dirty" already states the rule:
finish a code change → commit it. The complementary
`no-orphaned-staging` hook catches only staged-but-uncommitted index
entries; this hook closes the broader gap — **unstaged modifications
and untracked files** that the agent left behind because they came
from a `pnpm run format` sweep, a script side-effect, or
"I'll get to it later."

Past failure: an agent committed surgical work (T1, T2) but left 28
formatter-touched files dirty because they came from an earlier
`pnpm run format` sweep. The agent announced "intentional pause"
in the turn summary instead of resolving the state. The next session
inherited a 28-file diff with no clear ownership.

## What it does

Runs `git status --porcelain` in `$CLAUDE_PROJECT_DIR`. Filters out
untracked-by-default trees (`vendor/`, `third_party/`, `upstream/`,
`additions/source-patched/`, `deps/`, `external/`, `pkg-node/`,
`*-bundled/`, `*-vendored/`) so vendor drops don't trip the reminder.
Reports the remaining dirty paths plus a 3-option remediation menu:
commit / revert / explicitly announce.

Never blocks. Informational stderr only — the Stop event has no tool
call to refuse.

## Related

- `no-orphaned-staging` — Stop hook for staged-but-uncommitted hunks
- `node-modules-staging-guard` — PreToolUse block for `git add -f` of
  `node_modules/` (bypass: `Allow node-modules-staging bypass`)
- `overeager-staging-guard` — PreToolUse block for `git add -A` /
  `git add .` (bypass: `Allow add-all bypass`)
- Fleet doc: [`docs/claude.md/fleet/worktree-hygiene.md`](../../docs/claude.md/fleet/worktree-hygiene.md)
