# 1 path, 1 reference (path hygiene)

A path is constructed exactly once. Everywhere else references the constructed value. This is the strict form of DRY for paths. Paths drift the easiest because they're string literals that look harmless until two of them diverge and you spend an hour finding which copy is the source of truth.

## Scope rules

- **Within a package**: every script imports its own `scripts/paths.mts`. No `path.join('build', mode, …)` outside that module. `paths.mts` is per-package (like `package.json`). Every package that has a `scripts/` dir has its own.
- **Across packages**: package B imports package A's `paths.mts` via the workspace `exports` field. Never `path.join(PKG, '..', '<sibling>', 'build', …)`.
- **Sub-packages inherit**: a sub-package's `paths.mts` `export * from '<rel>/paths.mts'` from the nearest ancestor and adds local overrides below the re-export. Don't re-derive `REPO_ROOT` / `CONFIG_DIR` / `NODE_MODULES_CACHE_DIR` (enforced by `.claude/hooks/fleet/paths-mts-inherit-guard/`).
- **Not just build paths**: `paths.mts` is for _every_ path the package constructs (config files (`socket-wheelhouse.json`), lockfiles, cache dirs, manifest files). The fleet ships a starter `template/scripts/paths.mts` that exports the common constants + `loadSocketWheelhouseConfig()`.
- **Workflows / Dockerfiles / shell** can't `import` TS. Construct once, reference by output / `ENV` / variable.

## Canonical layout

Build outputs live at `<package-root>/build/<mode>/<platform-arch>/out/Final/<artifact>`, where `mode ∈ {dev, prod}` and `platform-arch` is the Node-style `<process.platform>-<process.arch>` (e.g. `darwin-arm64`, `linux-x64`). socket-btm is the worked example; ultrathink follows it; smaller TS-only repos that don't fork by platform may use `'any'` as the platform-arch sentinel but keep the same nesting.

Each package's `scripts/paths.mts` exports at minimum:

- `PACKAGE_ROOT`: absolute path to the package directory
- `BUILD_ROOT`: `<PACKAGE_ROOT>/build`
- `getBuildPaths(mode, platformArch)`: returns at least `outputFinalDir` + `outputFinalFile` or `outputFinalBinary`

## Enforcement (three levels)

| Level       | Surface                                               | What it catches                                                        |
| ----------- | ----------------------------------------------------- | ---------------------------------------------------------------------- |
| Edit-time   | `.claude/hooks/fleet/path-guard/`                     | Build-path construction outside `paths.mts`                            |
| Edit-time   | `.claude/hooks/fleet/paths-mts-inherit-guard/`        | Sub-package `paths.mts` that doesn't inherit from the nearest ancestor |
| Commit-time | `scripts/fleet/check-paths.mts` (run by `pnpm check`) | Whole-repo path-hygiene scan                                           |
| Audit + fix | `/guarding-paths` skill                               | Interactive cleanup                                                    |

## Common mistakes

- **Recomputing a sibling's build dir.** Import from the sibling's `paths.mts` instead.
- **Hard-coding `build/dev/` or `build/prod/`.** Use `getBuildPaths(mode, ...)` so a future `--mode=staging` doesn't require N edits.
- **Constructing the same `~/.socket/...` cache dir in 3 places.** Either it belongs in `scripts/paths.mts` or in `@socketsecurity/lib`'s `paths/` module if it's truly cross-package.

When in doubt: find the canonical owner and import from it.
