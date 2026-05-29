# overeager-staging-guard

**Lifecycle**: PreToolUse (Bash)

**Purpose**: catch the failure mode where an agent's `git commit` sweeps in files it didn't author — usually another Claude session's work that was already staged when this session opened the repo.

## Two enforcement layers

### Layer 1: BLOCK broad-stage commands

The hook blocks any of:

- `git add -A`
- `git add .`
- `git add --all`
- `git add -u`
- `git add --update`

These sweep everything in the working tree into the index, which is hostile to parallel-session repos. Per the fleet CLAUDE.md rule: **surgical `git add <specific-file>` only — never `-A` / `.`**.

### Layer 2: WARN on commit with unfamiliar staged files

On `git commit`, if the index contains files the agent has NOT touched this session (via `Edit` / `Write` / `git add <path>` / `git rm <path>`), the hook emits a stderr summary listing every unfamiliar staged file. **Exit 0 — informational, not a block.** The point is to give the agent a chance to spot parallel-session work before the commit goes through.

The detection heuristic walks the transcript's tool-use history; files staged but never touched this session surface as suspicious entries.

## Bypass

Type `Allow add-all bypass` verbatim in a recent user turn to permit `-A` / `.` / `-u` for one operation. The bypass is single-use and not persisted across sessions.

## Why this hook exists

Past incident: a session's own `pnpm check` surfaced another agent's migration files; the session nearly committed them. The block-broad-stage + warn-on-unfamiliar pair is defense-in-depth for the parallel-Claude-session model.
