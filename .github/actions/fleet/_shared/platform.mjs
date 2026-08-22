/**
 * @file Prints the canonical Socket platform string for this runner. Output:
 *   linux-x64, linux-arm64, linux-x64-musl, linux-arm64-musl, darwin-x64,
 *   darwin-arm64, win-x64, win-arm64. Replaces the uname + ldd dance repeated
 *   across action steps. Node gives us platform/arch directly, and
 *   `process.report` exposes libc (glibcVersionRuntime is the string "musl" on
 *   musl Node, otherwise a glibc version number). No shelling out. Usage: node
 *   .github/actions/fleet/_shared/platform.mjs Exits non-zero on unsupported
 *   platform/arch.
 *   NOTE: this script outputs `win-x64` / `win-arm64` (the legacy fleet
 *   shell-side shape), NOT `win32-x64` (the external-tools.json `platforms`
 *   keys). The resolver helper (resolve-external-tool-asset.mjs) computes its
 *   own `win32-*` key for schema lookup; do NOT consume this script's output as
 *   a platforms-map key.
 *   Testability: the pure `canonicalPlatform` helper is EXPORTED and the
 *   side-effectful stdout print is guarded by isMainModule(), so unit tests can
 *   import it without triggering a process.exit. Every composite-action _shared
 *   helper follows this pattern (see check-fleet-shared-scripts-are-testable).
 */

import { existsSync, readdirSync, realpathSync } from 'node:fs'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

// Composite-action helper runs on the raw runner before setup-node;
// @socketsecurity/lib-stable not installed yet.
// oxlint-disable-next-line socket/no-console-prefer-logger -- no lib yet
const fail = msg => console.error(msg)

// The canonical Socket platform string for THIS runner (the shell-side shape:
// `win-x64`, not `win32-x64`). Exported so tests + the resolver can share the
// libc-detection logic. Throws on an unsupported platform/arch (the CLI
// wrapper turns the throw into a loud process.exit).
export function canonicalPlatform() {
  const archMap = { __proto__: null, arm64: 'arm64', x64: 'x64' }
  const platformMap = {
    __proto__: null,
    darwin: 'darwin',
    linux: 'linux',
    win32: 'win',
  }

  const arch = archMap[process.arch]
  const platform = platformMap[process.platform]

  if (!arch || !platform) {
    throw new Error(`unsupported runner: ${process.platform}-${process.arch}`)
  }

  let suffix = ''
  if (platform === 'linux') {
    const libc = process.report?.getReport?.().header.glibcVersionRuntime
    if (libc === 'musl') {
      suffix = '-musl'
    } else if (!libc) {
      // glibcVersionRuntime undefined on Linux is unusual — confirm
      // libc by probing for the musl dynamic loader. Both /lib/ld-musl-*
      // and /lib64/ld-musl-* are valid musl ABI paths.
      const probeDirs = ['/lib', '/lib64']
      const isMusl = probeDirs.some(d => {
        if (!existsSync(d)) {
          return false
        }
        try {
          return readdirSync(d).some(f => f.startsWith('ld-musl-'))
        } catch {
          return false
        }
      })
      if (isMusl) {
        suffix = '-musl'
      }
    }
  }

  return `${platform}-${arch}${suffix}`
}

function isMainModule() {
  const entry = process.argv[1]
  if (!entry) {
    return false
  }
  try {
    // realpath both sides before comparing. Node normalizes `..` in argv[1]
    // but leaves symlinks in place, while import.meta.url is fully resolved, so
    // a launch path under a symlinked prefix (macOS /tmp and /var/folders, a
    // symlinked checkout) compares unequal and the CLI silently does nothing
    // while exiting 0.
    return pathToFileURL(realpathSync(entry)).href === import.meta.url
  } catch {
    return false
  }
}

if (isMainModule()) {
  try {
    // composite-action helper runs on the raw runner before setup-node; the
    // action's stdout IS the contract (consumed via `id: detect` output).
    // oxlint-disable-next-line socket/no-console-prefer-logger -- stdout contract
    console.log(canonicalPlatform())
  } catch (e) {
    fail(`× ${e?.message ?? e}`)
    process.exit(1)
  }
}
