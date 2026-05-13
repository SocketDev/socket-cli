# paths-mts-inherit-guard

PreToolUse Edit/Write hook. Blocks landing a sub-package
`scripts/paths.mts` (or `paths.cts`) whose content doesn't inherit
from the nearest ancestor `paths.mts` via `export *`.

## Why

`paths.mts` is per-package — like `package.json`, every package that
has a `scripts/` dir has its own. Sub-packages must `export *` from
the nearest ancestor so `REPO_ROOT`, `CONFIG_DIR`,
`NODE_MODULES_CACHE_DIR`, etc. aren't re-derived (and don't drift).

The fleet rule from CLAUDE.md (1 path, 1 reference):

> Sub-packages inherit: a sub-package's `paths.mts` `export * from
> '<rel>/paths.mts'` from the nearest ancestor and adds local
> overrides below the re-export. Don't re-derive `REPO_ROOT` /
> `CONFIG_DIR` / `NODE_MODULES_CACHE_DIR`.

## Allowed shapes

Repo-root `scripts/paths.mts` — no ancestor exists; nothing to
inherit from. Skipped.

Sub-package `packages/foo/scripts/paths.mts`:

```ts
export * from '../../../scripts/paths.mts'

// Local overrides below — package-specific paths.
import path from 'node:path'
import { REPO_ROOT } from '../../../scripts/paths.mts'
export const FOO_DIST = path.join(REPO_ROOT, 'packages', 'foo', 'dist')
```

## Blocked shapes

A sub-package `paths.mts` that re-derives `REPO_ROOT` instead of
inheriting:

```ts
// BLOCKED — should re-export from the ancestor
const REPO_ROOT = fileURLToPath(import.meta.url)
  .split('/scripts/')[0]
```

## Bypass

`Allow paths-mts-inherit bypass` (verbatim, in a recent user turn).
Use when a sub-package's paths.mts genuinely needs to be self-
contained — but this is rare; if you're tempted, double-check the
inheritance pattern.

## Cited from CLAUDE.md

Under *1 path, 1 reference*: "Sub-packages inherit" bullet.
