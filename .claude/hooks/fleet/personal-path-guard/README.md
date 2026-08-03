# personal-path-guard

PreToolUse hook that blocks an `Edit` / `Write` whose about-to-land
content carries a hardcoded personal path — a local USERNAME leak:

- `/Users/<name>/...` (macOS)
- `/home/<name>/...` (Linux)
- `C:\Users\<name>\...` (Windows)

Username-free forms are the **opposite** of a leak and are never
flagged: `~/...`, `$HOME/...`, and the canonical placeholders
`/Users/<user>/`, `/home/<user>/`, `C:\Users\<USERNAME>\`.

## Why blocking

This is the edit-time twin of the commit-time `scanPersonalPaths` check
in `.git-hooks/fleet/pre-commit.mts`. Without it, a hardcoded
`/Users/jdalton/...` path lands on disk and is only caught later when
`git commit` runs the pre-commit scanner — long after the model has
moved on. Blocking at Write/Edit time means the leak is fixed in the
same turn it is introduced. The regex shape and the per-line opt-out
marker are kept in lock-step with `PERSONAL_PATH_RE` and
`scanPersonalPaths` in `.git-hooks/_shared/helpers.mts` so the two
gates never disagree on what counts as a leak.

## Bypass

There is no chat bypass phrase. For a line that must keep the literal
path (rare — usually documentation), append the per-line marker the
commit-time scanner also honors:

```
/Users/jdalton/x // socket-lint: allow personal-path
```

The bare `// socket-lint: allow` form blanket-suppresses every scanner
on that line.

## Skipped silently

- `tool_name` other than `Edit` / `Write` / `MultiEdit`.
- Empty content.
- Pure-placeholder lines (`/Users/<user>/`, `$HOME`, `${USER}` forms).
- `node_modules/`, `vendor/`, `upstream/`, `external/`, `third_party/`,
  and lockfiles — they legitimately carry absolute machine paths and
  are not author-written source.
- Lines marked `// socket-lint: allow personal-path`.

## Failure mode

Fails open: any internal error logs to stderr and exits 0. The hook is
a quality gate, not a hard dependency — it never wedges the operator's
flow.
