# External tools

Socket CLI builds one Node package. Commands download external tools when needed; `bundle-tools.json` records their versions and checksums.

Socket Firewall runs inside the CLI from `src/core/firewall/`. Package-manager commands call this implementation directly.

## Configuration

Each tool entry declares its distribution source, version, and platform checksums. Build scripts read the manifest from the repository root and include the required metadata in the CLI bundle.

## Execution

`src/util/dlx/resolve-binary.mts` resolves tool executables. `src/util/dlx/spawn.mts` handles downloads and execution. The Python tool helpers live in `src/util/basics/`.

Tool downloads must retain their integrity checks. A local executable override is an explicit operator choice and must not replace the default verified download path.

## Upstream references

`.gitmodules` declares source references under `upstream/`. These references are shallow and sparse. Exact commit references keep checkout content reproducible.

Source references do not add upstream files to the npm package. The root manifest's file list defines the published artifact.

## Adding a tool

1. Add its source, version, and checksums to `bundle-tools.json`.
2. Wire the required build metadata in `scripts/repo/cli-build/environment-variables.mts`.
3. Add the command's resolver and execution path.
4. Test successful execution, integrity failures, and command exit status.
