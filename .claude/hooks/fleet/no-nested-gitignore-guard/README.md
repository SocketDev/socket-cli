# no-nested-gitignore-guard

PreToolUse (Write/Edit/MultiEdit) guard. Blocks CREATING a nested per-directory
`.gitignore` in a fleet repo — every ignore entry belongs in the single root
`.gitignore` (fleet block from `FLEET_ENTRIES` + the repo-owned block).

- **Allowed:** the repo root `.gitignore`, and `template/<archetype>/.gitignore`
  in the wheelhouse.
- **Blocked:** any deeper `.gitignore` (e.g. `some/dir/.gitignore`).
- **Exempt:** vendored / untracked-by-default trees (`vendor/`, `third_party/`,
  `external/`, `upstream/`, `deps/…`, `node_modules/`, `*-vendored`/`*-bundled`),
  and editing a `.gitignore` that already exists on disk.
- **Bypass:** `Allow nested-gitignore bypass` (typed verbatim in a recent turn).

Fix a would-be nested entry with a `**/`-anchored line in the root `.gitignore`
— it reaches any depth including the `template/base/` mirror.

The `isNestedGitignore` predicate is shared with the commit-/CI-time belt check
`scripts/fleet/check/gitignore-is-single-file.mts` so the two never diverge.
Detail: `docs/agents.md/fleet/single-gitignore.md`.
