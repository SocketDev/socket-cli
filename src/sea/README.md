# Socket CLI Node 27 SEA

This prototype builds a standalone `socket` executable with Node 27. It embeds the application and tool files in Node's virtual file system (VFS), so startup does not install npm packages or download helper tools.

A release config is required at `.config/release.json`, `release.json`, or `.release.json`; release tools fail closed if it is missing, invalid, or conflicting. The shared policy supports `stable-from-hint` and `prerelease-only`; SEA builds require `prerelease-only`. Its `versionHint` is the intended final release version (`2.1.0`), so the published versions remain `2.1.0-rc.N`. The v1.x release workflow selects major version 1 and does not promote this track to a stable release.

## Release recovery

The npm workflow reserves the version tag and stages the verified package files. It does not create a GitHub release. Approve each stage ID with `pnpm run approve:npm <id>`; the command uses pnpm 11 for stage commands and dispatches `release-github.yml`. That workflow waits until every package for the version is public before publishing the GitHub release.

| npm status | Action |
| --- | --- |
| `validating` | Wait, then retry the same stage ID. |
| `staged` | Approve with the same stage ID. |
| `published` | Do not stage again. Retry GitHub finalization with that stage ID. |
| `blocked` or `deleted` | Keep the reserved tag. The version is burned; prepare the next version. |

If a workflow stops before showing a stage ID, find the existing stage in its logs or npm before starting another release. Never rerun staging for a reserved tag. Changelogs start at the last public version, so changes from burned attempts carry forward. The first prerelease uses the latest stable release as its baseline; only a repository with no published release uses all history.

## Why Node SEA

The CLI already runs on Node. SEA keeps that runtime and uses Node's VFS to embed JavaScript and supporting files in one executable. This prototype has not benchmarked SEA against `@yao-pkg/pkg`, `nexe`, or Bun's compiler. Node 27 SEA is experimental, so the current choice is a prototype decision rather than a claim that it is the best production packager.

## Build

```sh
pnpm build:sea -- --prototype
```

The builder uses Node `v27.0.0-alpha.0.0.0`. It verifies the Node archive against the release `SHASUMS256.txt`. Node 27 is a prerelease, so these builds are experimental.

Build on the target OS and architecture. The builder supports `darwin`, `linux`, and `win32`, with `x64` and `arm64` archives where Node publishes them. Cross-target builds fail.

The builder creates a private temporary copy of the distribution. It does not replace the checkout's `dist` or `external` directories. It writes the executable and manifest to `build/sea`. Use `--output-dir` or `SOCKET_CLI_SEA_OUTPUT_DIR` to select another directory; the command-line option takes precedence.

The builder stages independent payloads in parallel. It waits for all staging jobs before cleanup. It builds the .NET facts helper before Rollup copies the distribution.

Verified source downloads are cached under `~/.cache/socket-sea/downloads`; each cache hit is checked against its pinned digest, and Node's `SHASUMS256.txt` is fetched fresh for each build. The runtime executable does not access this cache or download helper tools.

## Embedded tools

The build embeds the .NET facts helper, `socket-patch`, and `uv` when a verified payload exists for the target. The .NET helper still needs a compatible .NET SDK from the project or `PATH`. The scan command uses `SOCKET_CLI_UV_PATH` when set. Otherwise, it extracts embedded `uv` to a temporary directory when needed.

The build stages and embeds the `cdxgen` and `synp` APIs for darwin-arm64, but the manifest marks both features unavailable. Their source provenance and third-party notice obligations are not resolved, so the CLI refuses to run them. Their notice files stay with this build because the payloads are already embedded in the executable.

Rollup creates a notice inventory from each bundled dependency graph. Some pinned packages omit their license text from npm; exact package-version entries in `.config/rollup.cdxgen-sea.config.mjs` and `src/sea/rollup-provenance.mjs` supply the missing text. A dependency bump cannot reuse a mismatched entry, so the inventory records a missing-text obligation. README files are not used as license text or shipped as notice documents.

The build does not embed Coana, Python, or a JVM toolchain. It does not add a runtime path to download helper tools. Socket API requests and project inputs keep their existing network behavior.

## Manifest

Each successful build writes a manifest beside the executable. It records the target, Socket and Node versions, file digests, bundled tools, third-party notices, and available capabilities. Read the manifest's `capabilities` and notice `obligations` before using a bundled tool. The npm prerelease package uses the `rc-2.1.0` dist-tag; it does not use `latest` or `next`.

## Prototype status

Use the executable's `--version` output and the adjacent manifest's recorded Socket and Node versions to identify a build. Artifact size, digest, signature status, bundled tools, and capabilities depend on the build inputs and target; inspect the generated manifest for those values. The prototype remains experimental. Production signing, notarization, release provenance, and target qualification are incomplete.

## Native terminal tests

Use Node 26.13.0 and build the prototype on the host OS before running its native tests:

For the screenshot baseline workflow, run `pnpm snapshots` to rebuild and verify the focused screenshot suites, or `pnpm snapshots:update` (equivalent to `pnpm snapshots -u`) to update baselines. Both commands print the self-contained report path.

```sh
pnpm build:sea -- --prototype
SOCKET_CLI_NATIVE_TEST_ARTIFACTS=build/native-test-artifacts/run-1 pnpm test:native test/native/commands/cli.native.test.mts test/native/commands/cli-behavior.native.test.mts
node scripts/test/terminal-report.mts --artifacts build/native-test-artifacts/run-1 --output build/native-test-artifacts/run-1/index.html
```

Choose a fresh run directory each time; it stores checkpoint PNG/SVG files, the animation, and signing receipt. On macOS, configured Developer ID credentials sign the staged binary; CI exposes signing secrets only on trusted pushes.

Terminal images trim unused rows while preserving internal spacing. Each animation uses a shared height across its checkpoints.
