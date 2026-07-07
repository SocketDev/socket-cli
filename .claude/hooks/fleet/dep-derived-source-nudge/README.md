# dep-derived-source-nudge

PostToolUse `Edit`/`Write` hook that nudges (never blocks) when an edit touches a
manifest's dependency surface — `package.json`
(`dependencies`/`devDependencies`/`overrides`) or `pnpm-workspace.yaml`
(`catalog`/`overrides`/`minimumReleaseAgeExclude`).

Two things must happen before landing a manifest dep change: (1) regenerate the
lockfile (`pnpm i` or `pnpm i --lockfile-only`) so `pnpm install --frozen-lockfile`
passes in CI, and (2) update the canonical sources several CI gates derive from.
Forgetting either trips CI separately — a multi-round-trip trap. The nudge names
both at the same moment. See
[`docs/agents.md/fleet/tooling.md`](../../../../docs/agents.md/fleet/tooling.md).

## What it flags

An `Edit`/`Write` whose target basename is `package.json` or `pnpm-workspace.yaml`
AND whose changed content carries a dependency signal:

| Manifest             | Signal                                                                          |
| -------------------- | ------------------------------------------------------------------------------- |
| `package.json`       | a `*Dependencies`/`overrides` block key, or a `"name": "<spec>"` version line   |
| `pnpm-workspace.yaml`| `catalog`/`overrides`/`minimumReleaseAgeExclude`, a `- 'name@ver'` bullet, or a `'name': <spec>` entry |

## What it reminds you to do

- **Regenerate the lockfile** → `pnpm i` (or `pnpm i --lockfile-only`); commit
  the result alongside the manifest change so CI's `--frozen-lockfile` passes.
- **soak-exclude parity** → `scripts/repo/sync-scaffolding/manifest/release-age-annotations.mts` (`check-fleet-soak-exclude-parity`)
- **cross-major dedup** → `.config/repo/reviewed-duplicates.json` (`dependencies-are-deduped`)
- **catalog** → `scripts/repo/sync-scaffolding/manifest/catalog.mts` + `pnpm-workspace.fleet.yaml`

## What it does NOT flag

- Edits to other files, or a `package.json` edit that only touches scripts /
  engines / metadata (no dependency signal).
- A lockfile that is already dirty after `pnpm i` ran (`dirty-lockfile-nudge`'s domain).

## Trigger

Fires on `Edit` / `MultiEdit` / `Write` PostToolUse events. Always exits 0; the
reminder is informational on stderr.

## Bypass

No bypass phrase — this hook never blocks.

## Companion files

- `index.mts` — the hook; `touchesManifestDeps(filePath, content)` is the pure
  exported detector.
- `test/repo/integration/hooks/dep-derived-source-nudge.test.mts` — vitest
  integration tests (spawn-based, never self-import).
