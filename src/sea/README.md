# Socket CLI Node 27 SEA

This prototype builds a standalone `socket` executable with Node 27. It embeds the application and tool files in Node's virtual file system (VFS), so startup does not install npm packages or download helper tools.

A release config is required at `.config/release.json`, `release.json`, or `.release.json`; release tools fail closed if it is missing, invalid, or conflicting. The shared policy supports `stable-from-hint` and `prerelease-only`; SEA builds require `prerelease-only`. Its `versionHint` is the intended final release version (`2.1.0`), so the published versions remain `2.1.0-rc.N`. The v1.x release workflow selects major version 1 and does not promote this track to a stable release.

## Release recovery

The npm workflow reserves the version tag and stages the verified package files. It does not create a GitHub release. Approve each stage ID with `pnpm run approve:npm <id>`; the command uses the repository’s pinned pnpm for stage commands and dispatches `release-github.yml`. That workflow waits until every package for the version is public before publishing the GitHub release.

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
pnpm build:sea
```

The builder uses Node <!-- socket-sea-node-version:start -->`v27.0.0-alpha.0.1.1`<!-- socket-sea-node-version:end -->. It verifies the Node archive against the release `SHASUMS256.txt`. Node 27 is a prerelease, so these builds are experimental.

Release and native-build jobs use this same Node version. They install the pnpm version pinned in `package.json` and the npm version pinned in `.config/release-tools.json`. pnpm packs the tarballs, installs them in a clean consumer for smoke testing, and stages them for release. The native smoke test installs the launcher and its matching platform tarball offline.

Build on the target OS and architecture. The builder supports `darwin`, `linux`, and `win32`, with `x64` and `arm64` archives where Node publishes them. Cross-target builds fail.

The builder creates a private temporary copy of the distribution. It does not replace the checkout's `dist` or `external` directories. It writes the executable and manifest to `build/sea`. Use `--output-dir` or `SOCKET_CLI_SEA_OUTPUT_DIR` to select another directory; the command-line option takes precedence.

The builder stages independent payloads in parallel. It waits for all staging jobs before cleanup. It builds the .NET facts helper before Rollup copies the distribution.

The builder caches downloads in `~/.cache/socket-sea/downloads` and checks each cache hit against its pinned digest. It fetches Node's `SHASUMS256.txt` on every build.

## Embedded tools

The build embeds the .NET facts helper, `socket-patch`, and `uv` when a verified payload exists for the target. The .NET helper still needs a compatible .NET SDK from the project or `PATH`. The scan command uses `SOCKET_CLI_UV_PATH` when set. Otherwise, it extracts embedded `uv` to a temporary directory when needed.

The bundled `cdxgen` generates SBOMs from npm lockfile v3 and Yarn Classic projects. Yarn Classic needs an existing `node_modules` directory for Synp. The manifest records source verification and third-party notices.

Rollup creates a notice inventory from each bundled dependency graph. Some pinned packages omit their license text from npm; exact package-version entries in `.config/rollup.cdxgen-sea.config.mjs` and `src/sea/rollup-provenance.mjs` supply the missing text. A dependency bump cannot reuse a mismatched entry, so the inventory records a missing-text obligation. README files are not used as license text or shipped as notice documents.

The Node CLI and SEA download Coana from the Socket API on a cache miss. The SEA bundles Node to run Coana. SEA builds need no Coana credentials. Python and JVM runtimes remain external.

## Manifest

Each successful build writes a manifest beside the executable. It records the target, Socket and Node versions, file digests, bundled tools, third-party notices, and available capabilities. Read the manifest's `capabilities` and notice `obligations` before using a bundled tool. The npm prerelease package uses the `rc-2.1.0` dist-tag; it does not use `latest` or `next`.

## Prototype status

Use the executable's `--version` output and the adjacent manifest's recorded Socket and Node versions to identify a build. Artifact size, digest, signature status, bundled tools, and capabilities depend on the build inputs and target; inspect the generated manifest for those values. The prototype remains experimental. Production signing, notarization, release provenance, and target qualification are incomplete.

## Native terminal tests

Use the Node version in `src/sea/.node-version` and build the prototype on the host OS before running its native tests:

Run `pnpm snapshots` to verify the terminal screenshots and print the HTML report path. Use `pnpm snapshots:termless:refresh` to refresh the images, `pnpm snapshots:vite:refresh` for Vitest unit snapshots, or `pnpm snapshots:refresh` for both.

```sh
pnpm build:sea
SOCKET_CLI_NATIVE_TEST_ARTIFACTS=build/native-test-artifacts/run-1 pnpm test:sea test/native/commands/cli.native.test.mts test/native/commands/cli-behavior.native.test.mts
node scripts/test/terminal-report.mts --artifacts build/native-test-artifacts/run-1 --output build/native-test-artifacts/run-1/index.html
```

Choose a fresh run directory each time; it stores checkpoint PNG/SVG files, the animation, and signing receipt. On macOS, configured Developer ID credentials sign the staged binary; CI exposes signing secrets only on trusted pushes.

Terminal images trim unused rows while preserving internal spacing. Each animation uses a shared height across its checkpoints.

### Build, test, and publish the RC

Run `pnpm build:sea` on the target OS and CPU. The builder checks help and version output and runs `patch --version` where available. It generates .NET facts with package sources disabled and generates SBOMs for npm and Yarn Classic fixtures.

`socket sea smoke-test` verifies VFS integrity and checks that an empty Coana cache reports a miss. It checks the bundled Node and uv versions and removes the extracted executables. Run `pnpm test:sea` for the native suite.

The release workflow builds the five platform packages on their matching runners. Each runner installs the actual `socket` launcher tarball with its matching platform tarball in an empty consumer and runs help and version through the installed command. The launcher declares exact-version optional dependencies under `@socketsecurity/socket-cli-<platform>-<arch>`. Linux packages target glibc. The pinned Node release provides macOS arm64, Linux arm64/x64 and Windows arm64/x64 archives.

Use the existing publish workflow. To rehearse from a v1 checkout, choose **publish**, **dry-run**, and release major **2**. To release, prepare and merge the RC version first. The publish job stages verified platform tarballs before the launcher under `rc-2.1.0`. Approve platform stage IDs first and the launcher last with `pnpm run approve:npm <stage-id>`.

For the first release of a new name, an npm organization maintainer must provision a short-lived granular token with write permission to create public packages in the `@socketsecurity` scope. It does not need 2FA bypass. Store it as `NPM_FIRST_STAGE_TOKEN` in the protected GitHub `publish-npm` environment. CI checks package names against the public registry before reserving the tag and supplies the token only for first-time native staging. Approval uses maintainer 2FA.

Once each package exists, configure trusted staging for subsequent releases:
`npm trust github @socketsecurity/<package> --repository SocketDev/socket-cli --file publish-npm.yml --environment publish-npm --allow-stage-publish`. Remove the bootstrap token when the initial stages are complete. Configure trust near the next publish since unused new connections expire after two days. See [npm stage](https://docs.npmjs.com/cli/v11/commands/npm-stage/) and [trusted publishers](https://docs.npmjs.com/trusted-publishers/).
