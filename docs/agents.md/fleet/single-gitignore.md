# One `.gitignore` per repo

Every fleet repo keeps its ignore rules in a SINGLE `.gitignore` at the repo
root — never a nested per-directory `.gitignore`. The wheelhouse additionally
carries the `template/base/.gitignore` archetype-root copy that seeds it.

## The rule

- **Ignore entries live in one place.** Add every ignore pattern to the repo
  root `.gitignore` (fleet-managed block generated from `FLEET_ENTRIES` in
  `scripts/repo/sync-scaffolding/checks/gitignore-fleet-block.mts`, repo-owned
  block below it). Do NOT create a nested `.gitignore` in a subdirectory.
- **Why not nested.** A nested `.gitignore` fragments the single source of
  truth: it is not generator-managed, cascades as an extra tracked file, is easy
  to miss when auditing what a repo ignores, and splits the answer to "what does
  this repo ignore" across the tree. A root-only `**/`-anchored pattern reaches
  any depth — including the `template/base/` mirror — so nesting buys nothing.
- **Scoped ignores use `**/` anchoring, not nesting.** To ignore a generated
  artifact deep in the tree (e.g. the `_dispatch/` build output), add a
  `**/<path>` line to the root block — it matches the live copy AND the
  `template/base/` mirror in one line.
- **Vendored / untracked-by-default trees are exempt.** A `.gitignore` inside a
  vendored dir (`vendor/`, `third_party/`, `external/`, `upstream/`, `deps/…`,
  `node_modules/`, `*-vendored`) is upstream-owned, not fleet-managed — those are
  untracked-by-default anyway, so they never reach the tracked-tree scan.

## Enforcement

- `no-nested-gitignore-guard` (PreToolUse Write/Edit/MultiEdit) blocks CREATING
  a nested `.gitignore` in a fleet repo; bypass `Allow nested-gitignore bypass`.
- `gitignore-is-single-file` (`scripts/fleet/check/`) is the commit-/CI-time
  belt: it scans `git ls-files '*.gitignore'` and fails on any tracked
  `.gitignore` that is not the repo root or a `template/<archetype>/` root.
  Both share the `isNestedGitignore` predicate so they never diverge.

## Why

Ignore rules scattered across nested files are the same defect as any
duplicated source of truth: the answer to "what is ignored here" stops being
greppable in one file, the generator can no longer own the whole set, and a
stray nested file (like the `_dispatch/.gitignore` this rule retired) silently
diverges from the canonical block. One file, one place. See also
[`single-source-of-truth`](single-source-of-truth.md).
