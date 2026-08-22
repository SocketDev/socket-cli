/**
 * @file Prints the external-tools.json `platforms` KEY for this runner:
 *   linux-x64, linux-arm64, linux-x64-musl, linux-arm64-musl, darwin-x64,
 *   darwin-arm64, win32-x64, win32-arm64.
 *   This is the companion to platform.mjs, which prints the legacy shell-side
 *   shape (`win-x64`, `win-arm64`) for human-facing messages. The two agree
 *   everywhere except Windows, and that one difference silently broke every
 *   real Windows runner: a lookup keyed `win-x64` misses the schema's
 *   `win32-x64` entry, jq.mjs exits non-zero printing NOTHING, and `set -e`
 *   kills the step with an empty log. It read as "pnpm has no Windows build"
 *   when the entry was there all along, and it false-negatived the zizmor
 *   audit into a permanent skip.
 *   So: use THIS for any `platforms <key>` lookup, and platform.mjs only for
 *   prose. The mapping itself is not duplicated here — it is
 *   `canonicalPlatformKey` from resolve-external-tool-asset.mjs, which already
 *   owned it for the Go/Rust/odai resolvers.
 *   Usage: node .github/actions/fleet/_shared/platform-key.mjs
 *   Exits non-zero on an unsupported platform/arch.
 */

import process from 'node:process'
import { realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

import { canonicalPlatformKey } from './resolve-external-tool-asset.mjs'

// Re-exported so a caller can reach the key function from the module whose name
// says "key", and so this file satisfies the exported-helper contract that
// check-fleet-shared-scripts-are-testable enforces on every _shared script.
export { canonicalPlatformKey }

function isMainModule() {
  const entry = process.argv[1]
  if (!entry) {
    return false
  }
  try {
    // realpath both sides before comparing: Node normalizes `..` in argv[1] but
    // leaves symlinks in place, while import.meta.url is fully resolved, so a
    // launch path under a symlinked prefix compares unequal and the CLI
    // silently does nothing while exiting 0.
    return pathToFileURL(realpathSync(entry)).href === import.meta.url
  } catch {
    return false
  }
}

if (isMainModule()) {
  try {
    // Composite-action helper runs on the raw runner before setup-node, so the
    // action's stdout IS the contract.
    // oxlint-disable-next-line socket/no-console-prefer-logger -- stdout contract
    console.log(canonicalPlatformKey())
  } catch (e) {
    // oxlint-disable-next-line socket/no-console-prefer-logger -- no lib yet
    console.error(`× ${e?.message ?? e}`)
    process.exit(1)
  }
}
