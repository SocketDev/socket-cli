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

### Layer 2: BLOCK a bare commit that sweeps unfamiliar staged files

A bare `git commit` (no pathspec) commits the **entire** index — so a parallel session's staged work rides in under your authorship. **Parallel-session-cautious by default: commit the smallest explicit set.** On `git commit`, if the index contains files the agent has NOT touched this session (via `Edit` / `Write` / `git add <path>` / `git rm <path>`), the hook **blocks (exit 2)** and steers to the parallel-safe form:

```sh
git commit -o path/to/your-file.ts -m "…"   # commits ONLY the named path
```

`git commit -o <paths>` (or `git commit … -- <paths>`) commits only the named paths regardless of what else is staged, so it can't sweep another agent's work. Commits that already carry a pathspec are never blocked.

The detection heuristic walks the transcript's tool-use history; files staged but never touched this session are the unfamiliar set.

## Bypass

- `Allow add-all bypass` (verbatim, recent user turn) — permits `-A` / `.` / `-u` for one operation (Layer 1).
- `Allow index-sweep bypass` (verbatim, recent user turn) — lets a bare commit take the whole index (Layer 2), for when you genuinely mean to commit everything staged.
- `FLEET_SYNC=1` prefix — wheelhouse cascade commits legitimately sweep the whole index in a fresh worktree; the sentinel opts both layers out.
- `SOCKET_OVEREAGER_STAGING_GUARD_DISABLED=1` — disables the hook entirely.

Bypass phrases are single-use and not persisted across sessions.

## Why this hook exists

Past incident: a session's own `pnpm check` surfaced another agent's migration files; the session nearly committed them. A repeat: under heavy parallel contention, plain `git commit` swept in 8–9 other-session files despite surgical `git add <one-file>` — only `git commit -o <pathspec>` isolated the intended files. Blocking the bare sweep makes the parallel-safe form the default path.
