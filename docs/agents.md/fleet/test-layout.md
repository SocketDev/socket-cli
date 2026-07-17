# Test layout

**No wheelhouse test ships to the fleet.** Members receive the fleet scripts,
hooks, and lint-rules as opaque cascaded tooling and run their OWN tests with the
cascaded **runner** (`scripts/fleet/test.mts`, `cover.mts`, the cascaded
`vitest.config.mts` + `test/scripts/{fleet,repo}/setup.mts`, `test/_shared/fleet`
helpers). The wheelhouse authors + owns every `*.test.mts`, and they all live
under `test/repo/**` — host-only, never cascaded, never in the release bundle.

There is no `test/fleet/` and no cascaded test tier.

## Homes

| Test of… | Lives in |
| --- | --- |
| Fleet **scripts** (`scripts/fleet/**`) | `test/repo/{unit,integration}/**` |
| Wheelhouse **hooks / lint-rules / git-hooks** | `test/repo/{unit,integration,e2e}/**` |
| Repo-specific host-owned code | `test/repo/**` |

All wheelhouse-only. The cascaded trees (`.claude/hooks/fleet`,
`.config/fleet/oxlint-plugin`, `.git-hooks`, `scripts/fleet`) ship **no**
`*.test.*` files.

## `test/repo/` organization

`test/repo/<category>/<area?>/<name>.test.mts`

- **category** — `unit` (pure, in-process), `integration` (spawns a child
  process / git fixture / exercises the cascade engine), `e2e` (release /
  publish / bundle flows), `isolated` (own forks / longer timeouts).
- **area** (optional) — e.g. `hooks`, `hooks-shared`, `lint-rules`, `git-hooks`,
  `sync-scaffolding`. Tests of fleet scripts sit flat under the category.
- Tests import the source under a relative path; a hook / lint-rule test that
  targets a cascaded dir-mirror source reads it under `template/base/…`.

## Enforcement (code-is-law)

- **Runner**: `prefer-vitest-guard` — tests are vitest, not `node:test`.
- **No test in a cascaded tree**: `cascaded-fleet-trees-have-no-tests` (in
  `check --all`) + the edit-time guard fail loud if a `*.test.*` appears under
  any cascaded tree — absolute, no exceptions. Put it under `test/repo/`.
- **No test in the cascade manifest**: `manifest/files.mts` lists no `test/**`
  tree, so the cascade never carries a wheelhouse test to a member.
