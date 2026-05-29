# parallel-agent-edit-guard

PreToolUse (Edit / Write / NotebookEdit) hook. Blocks a write whose target
file is **another agent's in-flight work** — dirty in this checkout, not
authored by this session, and changed recently. Writing it would silently
clobber the other agent's uncommitted edits.

## When it fires

Only when the **edit target** is foreign (see `_shared/foreign-paths.mts`):

- the target path is dirty in `git status --porcelain` (minus
  untracked-by-default trees: `vendor/`, `third_party/`, `upstream/`, …),
- its resolved absolute path is not in this session's transcript
  touched-set (Edit / Write / NotebookEdit `file_path` + `git add|mv|rm`),
- its on-disk mtime is within 30 min of now (stale pre-session dirt is
  ignored).

Editing your own files, a fresh file nobody has touched, or any file when
no parallel agent is active — all pass through.

## Why

Incident 2026-05-27: two Claude sessions plus a Codex companion shared one
`socket-wheelhouse` checkout. One session repeatedly re-cascaded
`shell-command.mts` + test files, silently reverting the other session's
type-error fixes one Edit at a time. The four-times-clobbered fixes only
stuck once both sessions stopped touching the same files.

`parallel-agent-staging-guard` catches the _git-op_ version of this hazard
(`git add -A` / `stash` / `reset --hard`); it can't see a plain `Write`
that overwrites a file. This hook closes that gap at the write itself.

## Companion hooks

- `parallel-agent-staging-guard` — refuses git ops that sweep/destroy
  foreign work.
- `parallel-agent-on-stop-reminder` — surfaces the foreign-path signal at
  turn end (informational).

All three share the `_shared/foreign-paths.mts` heuristic.

## Bypass

- User types `Allow parallel-agent-edit bypass` in chat (case-sensitive),
  then retry — one action.
- `SOCKET_PARALLEL_AGENT_EDIT_GUARD_DISABLED=1` in env.
- `FLEET_SYNC=1` in env — cascade scripts run in a fresh worktree off
  `origin/main`, so there is no parallel-session hazard.

Fails open on hook bugs (exit 0 + stderr log).
