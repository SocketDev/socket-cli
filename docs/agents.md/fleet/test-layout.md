# Test layout

Where a test lives is decided by **who runs it**, which decides **whether it
cascades** to members and ships in the release bundle.

## The three homes

| Test of… | Lives in | Runner | Cascades to members? |
|---|---|---|---|
| Fleet **scripts** (`scripts/fleet/**`) | `test/unit/fleet/**` | vitest | **Yes** — in lock-step with the scripts (`manifest/files.mts`); members run them against their own copy |
| Repo-specific code (host-owned) | `test/unit/**`, `test/repo/**` (host) | vitest | No (host-only) |
| Wheelhouse **hooks / lint-rules / git-hooks** | `test/repo/{unit,integration,e2e}/**` | vitest | **No** — wheelhouse-only |

## Why hook / lint-rule / git-hook tests are wheelhouse-only

Their sources cascade byte-identical inside dir-mirrors (`.claude/hooks/fleet`,
`.config/fleet/oxlint-plugin`, `.git-hooks`). But the cascaded
`vitest.config.mts` **excludes** exactly those paths — so a member that received
a co-located test could never run it. It would ship to every member and into the
GitHub release bundle as pure dead weight.

So those tests live under `test/repo/` in the wheelhouse only. They are NOT
co-located with the code they test, and the cascaded trees ship **no** `*.test.*`
files.

## `test/repo/` organization

`test/repo/<category>/<area>/<name>.test.mts`

- **category** — `unit` (pure, in-process), `integration` (spawns a child
  process / git fixture / exercises the cascade engine), `e2e` (release /
  publish / bundle flows).
- **area** — `hooks`, `hooks-shared`, `lint-rules`, `git-hooks`.
- Tests import the canonical source under `template/base/…` via a relative path
  (the file sits 4 levels deep, so `../../../../template/base/…`).

## Enforcement (code-is-law)

- **Runner**: `prefer-vitest-guard` — fleet tests are vitest, not `node:test`.
- **No co-located co-tenant tests**: `cascaded-fleet-trees-have-no-tests` check
  (in `check --all`) + the edit-time guard fail loud if a `*.test.*` appears
  under a cascaded tree. Move it to `test/repo/` instead.
- `test/unit/fleet/**` is the deliberate exception — those are cascaded fleet
  contract tests, not co-tenant dead weight.
