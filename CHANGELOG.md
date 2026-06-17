# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.1.122](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.122) - 2026-06-17

### Changed
- Updated the Coana CLI to v `15.4.6`.

## [1.1.121](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.121) - 2026-06-17

### Fixed
- `socket config set` now persists correctly when a Socket API token is supplied via an environment variable. Previously, setting `SOCKET_CLI_API_TOKEN` / `SOCKET_SECURITY_API_TOKEN` put the entire config into read-only mode, so `socket config set <key> <value>` silently failed to save (and a later `socket config get` showed nothing) while still printing `OK`. A token from the environment now overrides authentication only: unrelated keys such as `defaultOrg` are written to disk as expected, and the env-supplied token itself is still never persisted.
- `socket config set` no longer reports a misleading `OK` when the value genuinely cannot be saved. When the config is fully overridden (and therefore ephemeral) via `--config`, `SOCKET_CLI_CONFIG`, or `SOCKET_CLI_NO_API_TOKEN`, the command now fails with a clear error explaining that the value was not saved, instead of pretending it succeeded.

## [1.1.120](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.120) - 2026-06-12

### Changed
- `socket scan create --reach` now applies your project's build-tool settings from `socket.json` (configured via `socket manifest setup`) — custom build-tool binary, include/exclude configs, and Gradle/sbt options — when resolving dependencies for Gradle and sbt reachability analysis, instead of always invoking the build tool with defaults.
- `socket scan create --auto-manifest --reach` now fails with an error when a build tool fails during manifest generation, rather than tolerating it. Plain `--reach` (without `--auto-manifest`) keeps generating manifests on a best-effort basis.
- Updated the Coana CLI to v `15.4.5`.

## [1.1.119](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.119) - 2026-06-11

### Changed
- Updated the Coana CLI to v `15.3.26`.

## [1.1.118](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.118) - 2026-06-08

### Changed
- Updated the Coana CLI to v `15.3.24`.

## [1.1.117](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.117) - 2026-06-08

### Changed
- The published package no longer bundles the unused Terminus bitmap font (pulled in transitively by the vendored `blessed` dependency), so its declared license is now `MIT` instead of `MIT AND OFL-1.1`.

## [1.1.116](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.116) - 2026-06-06

### Changed
- Updated the Coana CLI to v `15.3.22`.

## [1.1.115](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.115) - 2026-06-04

### Fixed
- `socket manifest gradle`, `kotlin`, and `scala` (including sbt-based projects) now stream the underlying build-tool and Coana output and surface the real failure reason. Previously a generation failure could collapse to an unhelpful `Coana command failed (exit code 1): command failed` with no detail, hiding actionable hints such as unresolved dependencies (re-run with `--ignore-unresolved` / `--exclude-configs`, or `--pom` for the legacy `pom.xml` output).

## [1.1.114](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.114) - 2026-06-04

### Changed
- `socket manifest gradle`, `kotlin`, and `scala` now generate a Socket facts file (`.socket.facts.json`) by default; pass `--pom` to generate `pom.xml` manifests instead.
- Replaced `--configs` with `--include-configs` and `--exclude-configs` on `socket manifest gradle/kotlin/scala` for finer control over which build configurations are resolved.
- Updated the Coana CLI to v `15.3.21`.

## [1.1.113](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.113) - 2026-06-03

### Added
- **`socket manifest bazel [beta]`** — Generate Bazel JVM SBOM manifests by running `bazel query` against discovered Maven repos in a Bazel workspace. Closes the inline-Maven-declaration gap that lockfile-only parsing misses for repos like envoy, ray, tensorflow, tink-java, and or-tools. Auto-detects Bzlmod and legacy `WORKSPACE`.
- **`socket scan create --auto-manifest`** now covers Bazel workspaces in addition to Gradle/Scala/Kotlin/Conda. Repos with `MODULE.bazel`, `WORKSPACE`, or `WORKSPACE.bazel` are detected automatically and their Maven dependencies extracted as part of the standard scan-create flow.
- **Bazel PyPI extraction** — `socket manifest bazel --ecosystem pypi` now generates `requirements.txt` for Python Bazel workspaces. Discovers custom `rules_python` pip hub names with Bazel command output first, queries `py_library` / `py_binary` / `py_test` dependencies, resolves canonical pinned versions from `requirements_lock.txt`, and emits PEP 503-normalized `name==version` lines. Supports both Bzlmod (`pip.parse`) and legacy `WORKSPACE` (`pip_parse` / `pip_install`) configurations. PyPI remains explicit opt-in for `socket scan create --auto-manifest` until real-world no-lockfile recovery is validated.

### Changed
- **Bazel diagnostics** — `socket manifest bazel --verbose` now emits bounded subprocess traces with argv, cwd, duration, exit status, output sizes, and failure stderr tails to make customer log-only triage safer and faster.
- Updated the Coana CLI to v `15.3.20`.

## [1.1.112](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.112) - 2026-05-29

### Fixed
- `socket fix` and `socket scan create` no longer abort with `EACCES: permission denied, scandir` when the project contains a directory the running user cannot read (for example a postgres `pgdata` data directory owned by another uid, or a Docker volume mount). Manifest discovery walks a project for `.gitignore` files before applying any path exclusions; that walk now honors `--exclude-paths` and `socket.yml` `projectIgnorePaths`, and skips unreadable directories rather than crashing. This makes `--exclude-paths` effective for unreadable directories — previously the crash happened before the exclusion was ever applied.

## [1.1.111](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.111) - 2026-05-29

### Changed
- Updated the Coana CLI to v `15.3.15`.

## [1.1.110](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.110) - 2026-05-29

### Fixed
- Resolved intermittent ~5-second timeouts affecting manifest uploads for reachability analysis and `socket fix`, along with other long-running API requests. Socket CLI now uses an explicit HTTP agent for all API traffic, so slow uploads and large streaming responses are no longer dropped prematurely.

## [1.1.109](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.109) - 2026-05-28

### Added
- **`socket fix --exclude-paths`** — Skip matching paths from the scan entirely: manifests under these paths are not uploaded, and fixes are not applied to workspaces under them. Use this to skip directories the current user cannot read (e.g. a postgres `pgdata` directory inside the repo) so they do not abort manifest collection. The pre-existing `--exclude` flag keeps its previous fix-application-only semantic but is now hidden in `--help` in favor of `--exclude-paths`.

## [1.1.108](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.108) - 2026-05-28

### Changed
- Updated the Coana CLI to v `15.3.12`.

## [1.1.107](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.107) - 2026-05-28

### Changed
- **`socket manifest gradle --facts [beta]`** (and its `kotlin` alias) gained `--configs` and `--ignore-unresolved`, matching `socket manifest scala --facts`. `--configs` takes comma-separated glob patterns (e.g. `*CompileClasspath,*RuntimeClasspath`) to restrict resolution to matching Gradle configurations; unresolved dependencies are now a fatal error by default — pass `--ignore-unresolved` for the previous lenient behavior.
- **`socket manifest scala --facts --configs`** now accepts glob patterns too (e.g. `*Test*`) for consistency with the gradle command. Bare names (no `*`/`?`) keep working as exact-name filters, so existing usages are unchanged.

### Fixed
- **`socket manifest gradle --facts`** now works on Gradle builds with the configuration cache enabled (default on Gradle 9), which previously failed with `Task.project at execution time` errors.

## [1.1.106](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.106) - 2026-05-27

### Added
- **`socket manifest scala --facts [beta]`** — Emit a `.socket.facts.json` dependency graph from an sbt build for `socket scan create` to consume as a pregenerated SBOM. Toggle also exposed via the `socket manifest setup` wizard for use with `--auto-manifest`.

## [1.1.105](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.105) - 2026-05-27

### Changed
- Updated the Coana CLI to v `15.3.11`.

## [1.1.104](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.104) - 2026-05-26

### Fixed
- Coana CLI invocation: strip `npm_package_*` env vars before spawning the npm-install fallback. Prevents `spawn E2BIG` failures in large monorepos where the parent process has hundreds of `npm_package_*` env vars populated from the root `package.json`. Preserves `npm_config_*` (registry / proxy / cache from `.npmrc`).

## [1.1.103](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.103) - 2026-05-26

### Changed
- Updated the Coana CLI to v `15.3.9`.

## [1.1.102](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.98) - 2026-05-22

### Added
- **`socket manifest gradle --facts [beta]`** (and its `socket manifest kotlin --facts` alias) — Emit a `.socket.facts.json` dependency graph from a Gradle build for `socket scan create` to consume as a pregenerated SBOM. Toggle also exposed via the `socket manifest setup` wizard for use with `--auto-manifest`.

### Changed
- Updated the Coana CLI to v `15.3.8`.

## [1.1.101](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.101) - 2026-05-22

### Changed
- Updated the Coana CLI to v `15.3.6`.

## [1.1.100](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.100) - 2026-05-21

### Changed
- Updated the Coana CLI to v `15.3.4`.

## [1.1.99](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.99) - 2026-05-20

### Changed
- Updated the Coana CLI to v `15.3.1`.
- Forward a `SOCKET_CALLER_USER_AGENT` env var (`socket/<version> node/<nodeVersion> <platform>/<arch>`) to the Coana CLI on spawn. Coana appends this to its outbound axios `User-Agent` so backend traffic identifies the originating Socket CLI alongside the Coana version.

## [1.1.98](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.98) - 2026-05-20

### Changed
- `socket scan create --reach` now uploads the reachability facts file as brotli on the wire, shrinking mono-repo upload sizes by roughly 85% with no change to the on-disk or stored format. Faster scan submissions on slow connections.

## [1.1.97](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.97) - 2026-05-18

### Changed
- Updated the Coana CLI to v `15.3.0`.

## [1.1.96](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.96) - 2026-05-15

### Changed
- Updated the Coana CLI to v `15.2.8`.

## [1.1.95](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.95) - 2026-05-15

### Changed
- Updated the Coana CLI to v `15.2.7`.

## [1.1.94](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.94) - 2026-05-12

### Fixed
- `socket manifest scala` now copies sbt-generated `.pom` files out of each subproject's `target/` directory to the project root as `pom.xml`, so Socket scan (which discovers `**/pom.xml` and respects `.gitignore`) picks them up automatically. Use `--out` to override the destination filename.

## [1.1.93](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.93) - 2026-05-08

### Changed
- `socket fix --ecosystems` now accepts values case-insensitively (e.g. `NPM`, `npm`, and `Npm` are all valid), matching the existing behavior of `--package-managers`.
- Updated the Coana CLI to v `15.2.4`.

## [1.1.92](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.92) - 2026-05-05

### Changed
- Updated the Coana CLI to v `15.2.2`.

## [1.1.91](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.91) - 2026-05-01

### Added
- New `socket scan create` and `socket scan reach` flags let you keep reachability analysis going when it would otherwise halt: `--reach-continue-on-analysis-errors`, `--reach-continue-on-install-errors`, `--reach-continue-on-missing-lock-files`, and `--reach-continue-on-no-source-files`. Each falls back to precomputed (Tier 2) results so you still get a scan when individual workspaces hit timeouts, install failures, missing lock files, or empty source trees.

## [1.1.90](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.90) - 2026-04-30

### Added
- `socket fix` now accepts a `--package-managers` flag to narrow fix computation to specific package managers within an ecosystem (e.g. only PNPM in a monorepo that mixes pnpm/yarn/npm). Accepts space- or comma-separated values and is case-insensitive. When combined with `--ecosystems`, both filters must match.

### Changed
- Updated the Coana CLI to v `15.2.0`.

## [1.1.89](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.89) - 2026-04-30

### Fixed
- `socket scan create` now matches manifest filenames case-insensitively, so capitalized files such as `Pipfile` and `Pipfile.lock` are no longer silently dropped from the scan.

## [1.1.88](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.88) - 2026-04-29

### Changed
- Updated the Coana CLI to v `15.1.0`.

## [1.1.87](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.87) - 2026-04-28

### Changed
- Updated the Coana CLI to v `14.12.222`.

## [1.1.86](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.86) - 2026-04-24

### Changed
- `socket fix` now fails with a clear error when a `.socket.facts.json` analysis artifact is present alongside manifest files, prompting you to delete it before re-running

## [1.1.85](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.85) - 2026-04-20

### Changed
- Updated the Coana CLI to v `14.12.219`.

## [1.1.84](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.84) - 2026-04-17

### Changed
- Updated the Coana CLI to v `14.12.218`.

## [1.1.83](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.83) - 2026-04-14

### Fixed
- `socket fix` now shows a clear error when a vulnerability ID (GHSA, CVE, or PURL) is passed as a positional argument instead of with `--id`, with a helpful "Did you mean" suggestion
- `socket fix` now shows a clear error when the target directory does not exist, instead of a confusing API error about missing files

## [1.1.82](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.82) - 2026-04-13

### Changed
- Updated the Coana CLI to v `14.12.213`.

## [1.1.81](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.81) - 2026-04-10

### Changed
- Updated the Coana CLI to v `14.12.211`.

## [1.1.80](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.80) - 2026-04-10

### Changed
- Updated the Coana CLI to v `14.12.209`.

## [1.1.79](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.79) - 2026-04-08

### Changed
- Updated the Coana CLI to v `14.12.205`.

## [1.1.78](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.78) - 2026-04-01

### Fixed
- `socket scan create`, `socket scan reach`, and `socket fix` now respect `projectIgnorePaths` from `socket.yml` when collecting files

## [1.1.77](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.77) - 2026-04-01

### Fixed
- Improved error message when using `--reach` with an invalid, expired, or revoked API token. Previously showed a misleading "Unable to verify plan permissions" error; now clearly indicates the authentication failure.

### Changed
- Updated the Coana CLI to v `14.12.201`.

## [1.1.74](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.74) - 2026-03-19

### Fixed
- Fixed `socket scan create --reach` failing with input validation errors when no explicit target is passed. In non-TTY environments (e.g. Jenkins CI), the interactive prompt to confirm the current directory would silently fail, causing all reach validations to error. Now defaults to `.` (cwd) when `--reach` is used without a target.

### Changed
- Updated the Coana CLI to v `14.12.200`.

## [1.1.73](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.73) - 2026-03-13

### Changed
- Updated the Coana CLI to v `14.12.197`.

## [1.1.72](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.72) - 2026-03-12

### Changed
- Updated the Coana CLI to v `14.12.196`.

## [1.1.71](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.71) - 2026-03-11

### Changed
- Updated the Coana CLI to v `14.12.195`.

## [1.1.70](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.70) - 2026-03-11

### Changed
- Updated the Coana CLI to v `14.12.194`.

## [1.1.69](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.69) - 2026-03-10

### Changed
- Updated the Coana CLI to v `14.12.192`.

## [1.1.68](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.68) - 2026-03-09

### Changed
- Updated the Coana CLI to v `14.12.191`.

## [1.1.67](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.67) - 2026-03-06

### Changed
- Updated `@socketsecurity/socket-patch` to v2.0.0, now powered by a native Rust binary for faster patch operations
- The `socket patch` command now directly invokes the platform-specific Rust binary instead of a Node.js wrapper
- Enhanced `socket patch` documentation with a complete subcommand reference and quick-start guide

## [1.1.66](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.66) - 2026-03-02

### Changed
- Updated the Coana CLI to v `14.12.189`.

## [1.1.65](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.65) - 2026-02-26

### Changed
- Improved API error messages to include the request URL, making it easier to debug which endpoint failed

## [1.1.64](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.64) - 2026-02-25

### Changed
- Updated the Coana CLI to v `14.12.183`.

## [1.1.63](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.63) - 2026-02-04

### Changed
- Updated the Coana CLI to v `14.12.182`.

## [1.1.62](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.62) - 2026-01-30

### Changed
- Updated the Coana CLI to v `14.12.178`.

## [1.1.61](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.61) - 2026-01-29

### Changed
- Updated the Coana CLI to v `14.12.174`.

## [1.1.60](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.60) - 2026-01-28

### Changed
- Updated the Coana CLI to v `14.12.173`.

## [1.1.59](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.59) - 2026-01-19

### Changed
- Updated the Coana CLI to v `14.12.162`.

## [1.1.58](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.58) - 2026-01-14

### Changed
- Analysis splitting is now disabled by default for reachability scans.
- Added `--reach-enable-analysis-splitting` flag to opt-in to multiple analysis runs per workspace when needed.
- Deprecated `--reach-disable-analysis-splitting` flag (now a no-op for backwards compatibility).
- Updated the Coana CLI to v `14.12.154`.

## [1.1.57](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.57) - 2026-01-10

### Changed
- Updated `@socketsecurity/socket-patch` to v1.2.0, which includes:
  - Progress spinner for scan command
  - Improved test coverage

## [1.1.56](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.56) - 2026-01-10

### Fixed
- Fixed heap overflow when scanning large monorepos with 100k+ files by implementing streaming-based filtering.

## [1.1.55](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.55) - 2026-01-09

### Changed
- Updated the Coana CLI to v `14.12.148`.

## [1.1.54](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.54) - 2026-01-09

### Changed
- Updated the Coana CLI to v `14.12.143`.

## [1.1.53](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.53) - 2026-01-06

### Changed
- The `scan_type` query argument is now set to `'socket_tier1'` when running `socket scan create --reach`.
This change ensures Tier 1 alerts from scans are ingested into the organization-level alerts correctly.

## [1.1.52](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.52) - 2026-01-02

### Added
- Added `--silence` flag to `socket fix` to suppress intermediate output and show only the final result.

### Changed
- Updated the Coana CLI to v `14.12.139`.

## [1.1.51](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.51) - 2025-12-23

### Added
- Added internal `--reach-lazy-mode` flag for reachability analysis.

### Changed
- Updated the Coana CLI to v `14.12.138`.

## [1.1.50](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.50) - 2025-12-19

### Fixed
- Fixed exit code when blocking alerts are found

## [1.1.49](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.49) - 2025-12-17

### Added
- Added initial telemetry functionality to track CLI usage and help improve the Socket experience.

### Fixed
- Fixed error propagation when npm package finalization failed in `socket fix`.

### Changed
- Updated the Coana CLI to v `14.12.134`.

## [1.1.48](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.48) - 2025-12-16

### Changed
- Updated the Coana CLI to v `14.12.130`.

## [1.1.47](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.47) - 2025-12-15

### Added
- Added `--debug` flag to `socket fix` to enable verbose logging in the Coana CLI.

### Changed
- Updated the Coana CLI to v `14.12.127`.

## [1.1.46](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.46) - 2025-12-12

### Changed
- Updated the Coana CLI to v `14.12.126`.

## [1.1.45](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.45) - 2025-12-10

### Changed
- Updated the Coana CLI to v `14.12.122`.

### Added
- Added `--reach-use-only-pregenerated-sboms` to run the Tier 1 reachability based only on pre-computed CDX and SPDX SBOMs (all other manifests are excluded).

## [1.1.44](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.44) - 2025-12-09

### Changed
- Updated the Coana CLI to v `14.12.118`.

## [1.1.43](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.43) - 2025-12-08

### Added
- Added `--all` flag to `socket fix` for explicitly processing all vulnerabilities in local mode. Cannot be used with `--id`.

### Deprecated
- Running `socket fix` in local mode without `--all` or `--id` is deprecated. A warning is shown when neither flag is provided. In a future release, one of these flags will be required.

## [1.1.42](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.42) - 2025-12-04

### Added
- Added `--ecosystems` flag to `socket fix`.

### Changed
- Updated the Coana CLI to v `14.12.113`.
- Rename `--limit` flag to `--pr-limit` for `socket fix`, but keep old flag as an alias. Note: `--pr-limit` has no effect in local mode, use `--id` options instead.
- Process all vulnerabilities with `socket fix` when no `--id` options are provided.

## [1.1.41](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.41) - 2025-12-02

### Added
- Added `--reach-version` flag to `socket scan create` and `socket scan reach` to override the @coana-tech/cli version used for reachability analysis.
- Added `--fix-version` flag to `socket fix` to override the @coana-tech/cli version used for fix analysis.

## [1.1.40](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.40) - 2025-12-02

### Fixed
- Fix a bug where vulnerabilities were not found correctly during `socket fix`.

### Changed
- Updated the Coana CLI to v `14.12.110`.

## [1.1.39](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.39) - 2025-12-01

### Added
- Added the `--output <scan-report.json>` flag to `socket scan reach`.

### Changed
- Updated the Coana CLI to v `14.12.107`.

## [1.1.38](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.38) - 2025-11-26

### Changed
- Enhanced CVE to GHSA conversion with improved error detection and caching for more reliable vulnerability lookups

## [1.1.37](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.37) - 2025-11-26

### Fixed
- Fix a bug where setting target path could cause incorrect manifest file paths for commands `socket scan reach <target>`, `socket scan create --reach <target>`, and `socket fix <target>`.

## [1.1.36](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.36) - 2025-11-26

### Fixed
- Fix a bug where the reachability analysis would hang on runs with analysis errors.

### Changed
- Updated `@coana-tech/cli` to 14.12.100

## [1.1.35](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.35) - 2025-11-25

### Added
- Added `--reach-debug` flag to enable verbose logging in the reachability Coana CLI

### Changed
- Updated `@coana-tech/cli` to 14.12.100

## [1.1.34](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.34) - 2025-11-21

### Fixed
- The target path is now properly considered when conducting reachability analysis: `socket scan reach <target>` and `socket scan create --reach <target>`.
- Fixed a bug where manifest files `<target>` were not included in a scan when the target was pointing to a directory.

## [1.1.33](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.33) - 2025-11-20

### Changed
- Updated `@coana-tech/cli` to 14.12.94

### Fixed
- Enhanced error badge visibility with improved text color contrast

## [1.1.32](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.32) - 2025-11-20

### Changed
- Updated `@coana-tech/cli` to 14.12.90
- Updated `@cyclonedx/cdxgen` to 11.11.0

### Fixed
- Resolved `--limit` flag behavior to correctly restrict vulnerability processing in `socket fix` local mode
- Exclude `.socket.facts.json` files from `socket fix` manifest uploads

## [1.1.31](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.31) - 2025-11-19

### Fixed
- Enhanced pull request descriptions to remove duplicate package listings for cleaner, more readable output

## [1.1.30](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.30) - 2025-11-18

### Changed
- Enhanced `SOCKET_CLI_COANA_LOCAL_PATH` to support compiled Coana CLI binaries alongside Node.js script files

### Fixed
- Resolved PR creation workflow to properly recreate pull requests after closing or merging
- Corrected API token selection to honor `SOCKET_CLI_API_TOKEN` environment variable in package alert requests

## [1.1.29](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.29) - 2025-11-16

### Added
- Added options `--reach-concurrency <number>` and `--reach-disable-analysis-splitting` for `socket scan create --reach`

## [1.1.28](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.28) - 2025-11-13

### Added
- Backported `socket fix` with `--json` improvements

## [1.1.27](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.27) - 2025-11-12

### Added
- Backported `--exclude` and `--include` flags for `socket fix` command from v2

## [1.1.26](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.26) - 2025-11-08

### Added
  - Debug logging of API requests/responses

## [1.1.23](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.23) - 2025-09-22

### Changed
- Enhanced `--no-apply-fixes` flag naming for improved clarity (previously `--dont-apply-fixes`)
- Streamlined documentation and help text for better user experience
- Improved `pnpm dlx` operations by removing unnecessary `--ignore-scripts` flag

### Fixed
- Resolved JSON example formatting in usage documentation
- Enhanced test reliability for cdxgen on Windows platforms
- Improved error handling in optimize command for pnpm environments

## [1.1.22](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.22) - 2025-09-20

### Changed
- Rename `--only-compute` flag to `--dont-apply-fixes` for `socket fix`, but keep old flag as an alias.

### Fixed
- Resolved interactive prompts in `socket optimize` when using pnpm
- Sanitize extracted git repository names to be compatible with the Socket API.

## [1.1.21](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.22) - 2025-09-20

### Added
- New `--compact-header` flag for streamlined CLI output display

### Changed
- Enhanced package manager interception for improved security scanning
- Improved detection of temporary package execution environments

### Fixed
- Enhanced error handling in `socket optimize` with proper exit codes

## [1.1.20](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.20) - 2025-09-19

### Added
- Terminal link support for enhanced command output formatting

### Fixed
- Resolved Windows compatibility issues with package manager execution

## [1.1.19](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.19) - 2025-09-19

### Added
- Enhanced testing capabilities for malware detection features

## [1.1.18](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.18) - 2025-09-18

### Fixed
- Enhanced compatibility with older Node.js versions

## [1.1.17](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.17) - 2025-09-18

### Fixed
- Enhanced Windows compatibility for package manager operations

## [1.1.16](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.16) - 2025-09-16

### Fixed
- Enhanced pnpm wrapper compatibility with dlx commands

## [1.1.15](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.15) - 2025-09-16

### Changed
- Improved `socket fix` error messages for missing environment variables

### Fixed
- Resolved path handling issue in `socket optimize` command

## [1.1.14](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.14) - 2025-09-17

### Changed
- Enhanced third-party tool integration

## [1.1.13](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.13) - 2025-09-16

### Added
- New `--output-file` flag for `socket fix` to save computed fixes to a JSON file
- New `--only-compute` flag for `socket fix` to compute fixes without applying them

## [1.1.12](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.12) - 2025-09-15

### Fixed
- Enhanced security alert processing for more reliable operations

## [1.1.11](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.11) - 2025-09-12

### Fixed
- Improved multipart upload reliability with Socket SDK update

## [1.1.10](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.10) - 2025-09-11

### Changed
- Enhanced command argument filtering for improved compatibility with npm and cdxgen integrations

## [1.1.9](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.9) - 2025-09-11

### Added
- Enhanced `socket fix --id` to accept CVE IDs and PURLs in addition to GHSA IDs

### Fixed
- Correct SOCKET_CLI_API_TIMEOUT environment variable lookup

## [1.1.8](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.8) - 2025-09-11

### Changed
- Clearer permission error messages to help resolve access issues

## [1.1.7](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.7) - 2025-09-11

### Added
- Control spinner display with new `--no-spinner` flag

### Fixed
- Enhanced proxy support for flexible network configurations

## [1.1.6](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.6) - 2025-09-10

### Fixed
- Improved pull request operations with better cache management

## [1.1.5](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.5) - 2025-09-10

### Fixed
- Enhanced reachability analysis spinner for consistent feedback
- Better working directory control with `--cwd` flag improvements

## [1.1.4](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.4) - 2025-09-09

### Added
- Track release changes with CHANGELOG.md
- Enhanced development workflow with contributor guidance
- Control scan output detail with `--report-level` flag

## [1.1.1](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.1) - 2025-09-04

### Changed
- Faster command completion with improved tab functionality
- Smoother user experience with better loading indicators

### Removed
- Removed legacy `--test` and `--test-script` flags from `socket fix`
- Continued cleanup of legacy `socket fix` code

## [1.1.0](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.0) - 2025-09-03

### Added
- See package versions directly in `socket npm` security reports

### Changed
- Clearer feedback for repeat `socket npm` installations
- More reliable handling of scan timeouts
- Streamlined repeat installs by hiding redundant audit info

### Fixed
- More reliable file system operations
- Better configuration value handling

### Removed
- Cleaned up legacy `socket fix` code

## [1.0.111](https://github.com/SocketDev/socket-cli/releases/tag/v1.0.111) - 2025-09-03

### Added
- Reimplemented `--range-style` flag for `socket fix`

### Fixed
- Enhanced CI/CD compatibility for reachability analysis and fixes

## [1.0.110](https://github.com/SocketDev/socket-cli/releases/tag/v1.0.110) - 2025-09-03

### Changed
- Enhanced reachability analysis and `socket fix` for better output handling

## [1.0.109](https://github.com/SocketDev/socket-cli/releases/tag/v1.0.109) - 2025-09-03

### Changed
- Improved build environment handling for better compatibility

## [1.0.108](https://github.com/SocketDev/socket-cli/releases/tag/v1.0.108) - 2025-09-03

### Changed
- Cleaner output from wrapped commands for focused results

## [1.0.107](https://github.com/SocketDev/socket-cli/releases/tag/v1.0.107) - 2025-09-02

### Fixed
- Restored build stability for reliable deployments

## [1.0.106](https://github.com/SocketDev/socket-cli/releases/tag/v1.0.106) - 2025-09-02

### Added
- Control reachability analysis caching with new `--reach-skip-cache` flag

## [1.0.104](https://github.com/SocketDev/socket-cli/releases/tag/v1.0.104) - 2025-08-29

### Fixed
- Enhanced security advisory resolution for accurate vulnerability tracking

## [1.0.103](https://github.com/SocketDev/socket-cli/releases/tag/v1.0.103) - 2025-08-29

### Fixed
- Improved GitHub Security Advisory processing

## [1.0.102](https://github.com/SocketDev/socket-cli/releases/tag/v1.0.102) - 2025-08-29

### Fixed
- Enhanced command flag processing for better reliability

## [1.0.100](https://github.com/SocketDev/socket-cli/releases/tag/v1.0.100) - 2025-08-29

### Added
- Richer debugging output for security advisory analysis

## [1.0.96](https://github.com/SocketDev/socket-cli/releases/tag/v1.0.96) - 2025-08-27

### Changed
- Streamlined organization selection for reachability analysis

## [1.0.89](https://github.com/SocketDev/socket-cli/releases/tag/v1.0.89) - 2025-08-15

### Added
- Comprehensive manifest scanning with `socket scan create --reach`

## [1.0.85](https://github.com/SocketDev/socket-cli/releases/tag/v1.0.85) - 2025-08-01

### Added
- Flexible npm path configuration via `SOCKET_CLI_NPM_PATH` environment variable

## [1.0.82](https://github.com/SocketDev/socket-cli/releases/tag/v1.0.82) - 2025-07-30

### Added
- Memory optimization controls with `--max-old-space-size` and `--max-semi-space-size` flags

## [1.0.80](https://github.com/SocketDev/socket-cli/releases/tag/v1.0.80) - 2025-07-29

### Changed
- Enhanced file discovery feedback in `socket scan create`

## [1.0.73](https://github.com/SocketDev/socket-cli/releases/tag/v1.0.73) - 2025-07-14

### Added
- Automatic detection of `.socket.facts.json` configuration files

## [1.0.69](https://github.com/SocketDev/socket-cli/releases/tag/v1.0.69) - 2025-07-10

### Added
- Skip pull request checks with new `--no-pr-check` flag for `socket fix`

## [1.0.10](https://github.com/SocketDev/socket-cli/releases/tag/v1.0.10) - 2025-06-28

### Changed
- Enhanced performance and reliability across all commands

## [1.0.9](https://github.com/SocketDev/socket-cli/releases/tag/v1.0.9) - 2025-06-28

### Changed
- Improved stability and command execution speed

## [1.0.8](https://github.com/SocketDev/socket-cli/releases/tag/v1.0.8) - 2025-06-27

### Changed
- Faster command processing with optimized internals

## [1.0.7](https://github.com/SocketDev/socket-cli/releases/tag/v1.0.7) - 2025-06-25

### Changed
- Enhanced reliability through improved code quality

## [1.0.6](https://github.com/SocketDev/socket-cli/releases/tag/v1.0.6) - 2025-06-25

### Changed
- Smoother user experience with targeted improvements

## [1.0.5](https://github.com/SocketDev/socket-cli/releases/tag/v1.0.5) - 2025-06-25

### Changed
- Faster command execution with performance enhancements

## [1.0.4](https://github.com/SocketDev/socket-cli/releases/tag/v1.0.4) - 2025-06-25

### Changed
- More stable operations with targeted fixes

## [1.0.3](https://github.com/SocketDev/socket-cli/releases/tag/v1.0.3) - 2025-06-25

### Added
- Load npm config as part of `socket fix`

## [1.0.2](https://github.com/SocketDev/socket-cli/releases/tag/v1.0.2) - 2025-06-25

### Added
- Added spinner to reachability scan

## [1.0.1](https://github.com/SocketDev/socket-cli/releases/tag/v1.0.1) - 2025-06-24

### Added
- Package manager version logging to info
- Organization persistence when selecting orgs

### Changed
- Made `socket fix` command reuse implementations for better efficiency
- Normalized options passed to `socket fix`
- Improved banner spacing logic
- Enhanced default org feedback and call-to-action

## [1.0.0](https://github.com/SocketDev/socket-cli/releases/tag/v1.0.0) - 2025-06-13

### Added
- Official v1.0.0 release
- Added `socket org deps` alias command

### Changed
- Moved dependencies command to a subcommand of organization
- Improved UX for threat-feed and audit-logs
- Removed Node 18 deprecation warnings
- Removed v1 preparation flags

## [0.15.64](https://github.com/SocketDev/socket-cli/releases/tag/v0.15.64) - 2025-06-13

### Fixed
- Improved `socket fix` error handling when server rejects request

### Changed
- Final pre-v1.0.0 stability improvements

## [0.15.63](https://github.com/SocketDev/socket-cli/releases/tag/v0.15.63) - 2025-06-12

### Added
- Enhanced debugging capabilities

## [0.15.62](https://github.com/SocketDev/socket-cli/releases/tag/v0.15.62) - 2025-06-12

### Fixed
- Avoided double installing during `socket fix` operations

## [0.15.61](https://github.com/SocketDev/socket-cli/releases/tag/v0.15.61) - 2025-06-11

### Fixed
- Memory management for `socket fix` with packument cache clearing

## [0.15.60](https://github.com/SocketDev/socket-cli/releases/tag/v0.15.60) - 2025-06-10

### Changed
- Widened Node.js test matrix
- Removed Node 18 support due to native-ts compatibility

## [0.15.59](https://github.com/SocketDev/socket-cli/releases/tag/v0.15.59) - 2025-06-09

### Changed
- Reduced Node version restrictions on CLI

## [0.15.57](https://github.com/SocketDev/socket-cli/releases/tag/v0.15.57) - 2025-06-06

### Added
- Added `socket threat-feed` search flags

## [0.15.56](https://github.com/SocketDev/socket-cli/releases/tag/v0.15.56) - 2025-05-07

### Added
- `socket manifest setup` for project configuration
- Enhanced debugging output and error handling

## [0.15.0](https://github.com/SocketDev/socket-cli/releases/tag/v0.15.0) - 2025-05-07

### Added
- Enhanced `socket threat-feed` with new API endpoints
- `socket.json` configuration support
- Improved `socket fix` error handling

### Fixed
- Avoid double installing with `socket fix`
- CI/CD improvements reducing GitHub Action dependencies for `socket fix`

## [0.14.155](https://github.com/SocketDev/socket-cli/releases/tag/v0.14.155) - 2025-05-07

### Added
- `SOCKET_CLI_API_BASE_URL` for base URL configuration
- `DISABLE_GITHUB_CACHE` environment variable
- `cdxgen` lifecycle logging and documentation hyperlinks

### Fixed
- Set `exitCode=1` when login steps fail
- Fixed Socket package URLs
- Band-aid fix for `socket analytics`
- Improved handling of non-SDK API calls

### Changed
- Enhanced JSON-safe API handling
- Updated `cdxgen` flags and configuration

## [0.14.0](https://github.com/SocketDev/socket-cli/releases/tag/v0.14.0) - 2024-10-10

### Added
- `socket optimize` to apply Socket registry overrides
- Suggestion flows to `socket scan create`
- JSON/markdown output support for `socket repos list`
- Enhanced organization command with `--json` and `--markdown` flags
- `SOCKET_CLI_NO_API_TOKEN` environment variable support
- Improved test snapshot updating

### Fixed
- Spinner management in report flow and after API errors
- API error handling for non-SDK calls
- Package URL corrections

### Changed
- Added Node permissions for shadow-bin

## [0.13.0](https://github.com/SocketDev/socket-cli/releases/tag/v0.13.0) - 2024-09-06

### Added
- `socket threat-feed` for security threat information

## [0.12.0](https://github.com/SocketDev/socket-cli/releases/tag/v0.12.0) - 2024-08-30

### Added
- Diff Scan command for comparing scan results
- Analytics enhancements and data visualization
- Feature to save analytics data to local files

## [0.11.0](https://github.com/SocketDev/socket-cli/releases/tag/v0.11.0) - 2024-08-05

### Added
- Organization listing capability

## [0.10.0](https://github.com/SocketDev/socket-cli/releases/tag/v0.10.0) - 2024-07-17

### Added
- Analytics command with graphical data visualization
- Interactive charts and graphs

## [0.9.0](https://github.com/SocketDev/socket-cli/releases/tag/v0.9.0) - 2023-12-01

### Added
- Automatic latest version fetching for `socket info`
- Package scoring integration
- Human-readable issue rendering with clickable links
- Enhanced package analysis with scores

### Changed
- Smart defaults for package version resolution
- Improved issue visualization and reporting

## [0.8.0](https://github.com/SocketDev/socket-cli/releases/tag/v0.8.0) - 2023-08-10

### Added
- Configuration-based warnings from settings
- Enhanced `socket npm` installation safety checks

### Changed
- Dropped Node 14 support (EOL April 2023)
- Added Node 16 manual testing due to c8 segfault issues

## [0.7.1](https://github.com/SocketDev/socket-cli/releases/tag/v0.7.1) - 2023-06-13

### Added
- Python report creation capabilities
- CLI login/logout functionality

### Fixed
- Lockfile handling to ensure saves on `socket npm install`
- Report creation issues
- Python uploads via CLI

### Changed
- Switched to base64 encoding for certain operations

## [0.6.0](https://github.com/SocketDev/socket-cli/releases/tag/v0.6.0) - 2023-04-11

### Added
- Enhanced update notifier for npm wrapper
- TTY IPC to mitigate sub-shell prompts

## [0.5.0](https://github.com/SocketDev/socket-cli/releases/tag/v0.5.0) - 2023-03-16

### Added
- npm/npx wrapper commands (`socket npm`, `socket npx`)
- npm provenance and publish action support

### Changed
- Reusable consistent flags across commands

## [0.4.0](https://github.com/SocketDev/socket-cli/releases/tag/v0.4.0) - 2023-01-20

### Added
- Persistent authentication - CLI remembers API key for full duration
- Comprehensive TypeScript integration and type checks
- Enhanced development tooling and dependencies

## [0.3.0](https://github.com/SocketDev/socket-cli/releases/tag/v0.3.0) - 2022-12-13

### Added
- Support for globbed input and ignores for package scanning
- `--strict` and `--all` flags to commands
- Configuration support using `@socketsecurity/config`

### Changed
- Improved error handling and messaging
- Stricter TypeScript configuration

### Fixed
- Improved tests

## [0.2.1](https://github.com/SocketDev/socket-cli/releases/tag/v0.2.1) - 2022-11-23

### Added
- Update notifier to inform users of new CLI versions

## [0.2.0](https://github.com/SocketDev/socket-cli/releases/tag/v0.2.0) - 2022-11-23

### Added
- New `socket report view` for viewing existing reports
- `--view` flag to `report create` for immediate viewing
- Enhanced report creation and viewing capabilities

### Changed
- Synced up report create command with report view functionality
- Synced up info command with report view
- Improved examples in `--help` output

### Fixed
- Updated documentation and README with new features

## [0.1.2](https://github.com/SocketDev/socket-cli/releases/tag/v0.1.2) - 2022-11-17

### Added
- Node 19 testing support

### Changed
- Improved documentation

## [0.1.1](https://github.com/SocketDev/socket-cli/releases/tag/v0.1.1) - 2022-11-07

### Changed
- Extended README documentation

### Fixed
- Removed accidental debug code

## [0.1.0](https://github.com/SocketDev/socket-cli/releases/tag/v0.1.0) - 2022-11-07

### Added
- Initial Socket CLI release
- `socket info` for package security information
- `socket report create` for generating security reports
- Basic CLI infrastructure and configuration
