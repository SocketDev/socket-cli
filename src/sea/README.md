# Socket CLI Node 27 SEA

This prototype builds an executable from the root `socket` application. It embeds the application files in a Node 27 virtual file system (VFS). It does not install npm packages or download helper tools when it starts.

## Build

```sh
pnpm build:sea -- --prototype
```

The builder uses Node `v27.0.0-alpha.0.0.0`. It verifies the Node archive against the release `SHASUMS256.txt`. Node 27 is a prerelease, so these builds are experimental.

Build on the target OS and architecture. The builder supports `darwin`, `linux`, and `win32`, with `x64` and `arm64` archives where Node publishes them. Cross-target builds fail.

The builder creates a private temporary copy of the distribution. It does not replace the checkout's `dist` or `external` directories. It writes the executable and manifest to `build/sea`. Use `--output-dir` to select another directory.

The builder stages independent payloads in parallel. It waits for all staging jobs before cleanup. It builds the .NET facts helper before Rollup copies the distribution.

Verified source downloads are cached under `~/.cache/socket-sea/downloads`; each cache hit is checked against its pinned digest, and Node's `SHASUMS256.txt` is fetched fresh for each build. The runtime executable does not access this cache or download helper tools.

## Embedded tools

The build embeds the .NET facts helper, `socket-patch`, and `uv` when a verified payload exists for the target. The .NET helper still needs a compatible .NET SDK from the project or `PATH`. The scan command uses `SOCKET_CLI_UV_PATH` when set. Otherwise, it extracts embedded `uv` to a temporary directory when needed.

The build also stages `cdxgen` and `synp` APIs for darwin-arm64. The current manifest marks both features unavailable. Their source provenance and third-party notice obligations are not resolved.

The build does not embed Coana, Python, or a JVM toolchain. It does not add a runtime path to download helper tools. Socket API requests and project inputs keep their existing network behavior.

## Manifest

Each successful build writes a manifest beside the executable. It records the target, Socket and Node versions, file digests, bundled tools, third-party notices, and available capabilities. Read the manifest's `capabilities` and notice `obligations` before using a bundled tool.

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
