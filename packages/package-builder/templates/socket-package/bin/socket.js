#!/usr/bin/env node
/**
 * Socket CLI bootstrap loader.
 *
 * Finds and executes the platform's Socket CLI standalone executable.
 * Preference order per platform triplet:
 *
 * 1. `@socketsecurity/cli.exe.<triplet>` — the current tail family.
 * 2. `@socketbin/cli-*` — frozen legacy binaries, kept as a fallback until the
 *    cli.exe tails are live and pinned. Legacy naming used `alpine` for musl
 *    and `win32` for Windows; the `cli-win-*` and `cli-linux-*-musl` names on
 *    npm are empty placeholders and are never targeted.
 */

'use strict'

const { existsSync } = require('node:fs')
const { arch, platform } = require('node:os')
const { join } = require('node:path')
const { spawn } = require('node:child_process')

// Legacy @socketbin unscoped names keyed by triplet. Only the frozen names
// that actually contain binaries.
const LEGACY_SOCKETBIN_NAMES = {
  __proto__: null,
  'darwin-arm64': 'cli-darwin-arm64',
  'darwin-x64': 'cli-darwin-x64',
  'linux-arm64': 'cli-linux-arm64',
  'linux-arm64-musl': 'cli-alpine-arm64',
  'linux-x64': 'cli-linux-x64',
  'linux-x64-musl': 'cli-alpine-x64',
  'win32-arm64': 'cli-win32-arm64',
  'win32-x64': 'cli-win32-x64',
}

// Binary file name inside a tail package's payload directory.
function binaryNameFor(triplet) {
  return triplet.startsWith('win32-') ? 'socket.exe' : 'socket'
}

// Candidate binary paths for one package, covering dependency, hoisted, and
// workspace node_modules layouts relative to `fromDir`. Both tail families
// ship the executable at `bin/<name>`.
function candidateBinaryPaths(packageName, binaryName, fromDir) {
  const payload = join(packageName, 'bin', binaryName)
  return [
    // Installed as dependency of this package.
    join(fromDir, '..', 'node_modules', payload),
    // Hoisted to parent node_modules.
    join(fromDir, '..', '..', payload),
    // Workspace/monorepo layout.
    join(fromDir, '..', '..', '..', 'node_modules', payload),
  ]
}

// Candidate package names for a triplet, preferred first.
function candidatePackageNames(triplet) {
  const names = [`@socketsecurity/cli.exe.${triplet}`]
  const legacy = LEGACY_SOCKETBIN_NAMES[triplet]
  if (legacy) {
    names.push(`@socketbin/${legacy}`)
  }
  return names
}

// This loader ships dependency-free in the published `socket` wrapper, so the
// fleet logger is not available at runtime.
function fail(message) {
  // oxlint-disable-next-line socket/no-console-prefer-logger -- dependency-free published bin script; the fleet logger cannot be required here.
  console.error(message)
}

// Find the first existing binary across the fallback chain.
function findBinaryPath(triplet, fromDir) {
  const binaryName = binaryNameFor(triplet)
  const packageNames = candidatePackageNames(triplet)
  for (let i = 0, { length } = packageNames; i < length; i += 1) {
    const packageName = packageNames[i]
    // require.resolve handles layouts the static probes below miss.
    try {
      const manifestPath = require.resolve(`${packageName}/package.json`, {
        paths: [fromDir],
      })
      const resolved = join(manifestPath, '..', 'bin', binaryName)
      if (existsSync(resolved)) {
        return resolved
      }
    } catch {
      // Fall through to path probing.
    }
    const paths = candidateBinaryPaths(packageName, binaryName, fromDir)
    for (let j = 0, { length: pl } = paths; j < pl; j += 1) {
      if (existsSync(paths[j])) {
        return paths[j]
      }
    }
  }
  return undefined
}

// Detect musl libc on Linux.
function isMusl() {
  if (platform() !== 'linux') {
    return false
  }
  try {
    // Check if we're running on Alpine/musl by looking at the libc.
    const { execSync } = require('node:child_process')
    const lddOutput = execSync('ldd --version 2>&1 || true', {
      encoding: 'utf8',
    })
    return lddOutput.includes('musl')
  } catch {
    return false
  }
}

// Resolve a pack-app triplet from platform + arch + musl flag. Returns
// undefined on unsupported platforms.
function resolveTriplet(p, a, musl) {
  if (p !== 'darwin' && p !== 'linux' && p !== 'win32') {
    return undefined
  }
  if (a !== 'arm64' && a !== 'x64') {
    return undefined
  }
  const muslSuffix = p === 'linux' && musl ? '-musl' : ''
  return `${p}-${a}${muslSuffix}`
}

// Main entry point.
function main() {
  const triplet = resolveTriplet(platform(), arch(), isMusl())
  const binaryPath = triplet ? findBinaryPath(triplet, __dirname) : undefined

  if (!binaryPath) {
    const expected = triplet
      ? candidatePackageNames(triplet).join(' or ')
      : `an unsupported platform: ${platform()}-${arch()}`
    fail('Socket CLI binary not found for your platform.')
    fail(`Expected package: ${expected}`)
    fail('')
    fail('This may happen if:')
    fail('  - Your platform is not supported')
    fail('  - The optional dependency failed to install')
    fail('')
    fail('Try reinstalling: npm install -g socket')
    process.exit(1)
  }

  // Spawn the binary with all arguments.
  const child = spawn(binaryPath, process.argv.slice(2), {
    stdio: 'inherit',
  })

  // socket-lint: allow bare-spawn-access -- `spawn` here is node:child_process's
  // native spawn (required directly above), which returns a bare ChildProcess;
  // it is not the fleet `@socketsecurity/lib` spawn wrapper this rule guards.
  child.on('error', err => {
    fail(`Failed to start Socket CLI: ${err.message}`)
    process.exit(1)
  })

  // socket-lint: allow bare-spawn-access -- same native node:child_process
  // ChildProcess as above.
  child.on('exit', (code, signal) => {
    if (signal) {
      process.exit(1)
    }
    process.exit(code ?? 0)
  })
}

if (require.main === module) {
  main()
}

module.exports = {
  binaryNameFor,
  candidateBinaryPaths,
  candidatePackageNames,
  findBinaryPath,
  isMusl,
  resolveTriplet,
}
