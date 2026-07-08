/**
 * @file Prints the canonical Socket platform string for this runner. Output:
 *   linux-x64, linux-arm64, linux-x64-musl, linux-arm64-musl, darwin-x64,
 *   darwin-arm64, win-x64, win-arm64. Replaces the uname + ldd dance repeated
 *   across action steps. Node gives us platform/arch directly, and
 *   `process.report` exposes libc (glibcVersionRuntime is the string "musl" on
 *   musl Node, otherwise a glibc version number). No shelling out. Usage: node
 *   .github/actions/fleet/lib/platform.mjs Exits non-zero on unsupported
 *   platform/arch.
 */

import { existsSync, readdirSync } from 'node:fs'

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
  // oxlint-disable-next-line socket/no-console-prefer-logger -- composite-action helper runs on the raw runner before setup-node; @socketsecurity/lib-stable not installed yet.
  console.error(`× unsupported runner: ${process.platform}-${process.arch}`)
  process.exit(1)
}

let suffix = ''
if (platform === 'linux') {
  const libc = process.report?.getReport().header.glibcVersionRuntime
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

// oxlint-disable-next-line socket/no-console-prefer-logger -- composite-action helper runs on the raw runner before setup-node; the action's stdout IS the contract (consumed via `id: detect` output).
console.log(`${platform}-${arch}${suffix}`)
