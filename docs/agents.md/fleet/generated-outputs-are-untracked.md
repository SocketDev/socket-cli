# Generated outputs stay untracked

The fleet generates a lot — a hook bundle, dispatch tables, an oxlint plugin
bundle, V8 snapshot artifacts. **None of it is committed.** Build outputs are
built or fetched; version control carries only source and a tiny set of dep-0
seeds. Committing a 5 MB bundle to 16 member repos, every revision, is exactly
what this rule prevents.

## The three buckets

| Kind | Home | Tracked? | How members get it |
|---|---|---|---|
| **Source** | `template/make/…`, `template/base/…` | ✅ | canonical, cascaded (or wheelhouse-only) |
| **Generated output** | `_dist/`, the oxlint `.mjs`, dispatch tables, snapshot blobs | ❌ gitignored | built locally or fetched from the release bundle |
| **Dep-0 seed** | `scripts/repo/bootstrap/fleet.mjs`, `.npmrc` | ✅ — the ONLY committed generated artifacts | cascaded live seed |

## Why the two seeds are the only exception

`fleet.mjs` is the bootstrap fetcher — it pulls the release bundle, so nothing
can fetch *it*. `.npmrc` is the registry config `pnpm install` reads before any
postinstall could create it. Both must exist in the tree before any fetch or
generate step runs (chicken-and-egg), so committing them is forced, not an
oversight. Their `template/generated/` staging copies stay gitignored; only the
cascaded live seed is tracked. `.claude/` is not a critical path, so every
generated artifact under it is untracked.

## Enforcement

Two checks, run per-tree in the wheelhouse and every member:

- **`ignored-files-are-untracked.mts`** — fails if any *gitignored* path is
  tracked (`git ls-files -ci`). Catches "ignored yet tracked."
- **`generated-outputs-are-untracked.mts`** — fails if any *build output* is
  tracked, knowing a path is an output structurally from `paths.mts` (the single
  owner of build-output paths), not from the gitignore patterns. This catches the
  gap the first check cannot: a new output under `_dist/` tracked *before* it is
  gitignored. `_dist/` is exclusively build output, so any tracked file under it
  is a violation.

The generated set is derived from `paths.mts` (which cascades, so the check runs
in members); the sanctioned seed allowlist is the one hand-maintained list, in
the check. Adding a new build output means adding its pattern to the fleet
gitignore block (`gitignore-fleet-block.mts`) — never committing it.
