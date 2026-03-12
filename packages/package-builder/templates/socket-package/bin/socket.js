#!/usr/bin/env node
/**
 * Socket CLI bootstrap loader.
 *
 * Finds and executes the appropriate @socketbin/* SEA binary
 * based on the current platform and architecture.
 */

'use strict'

const { existsSync } = require('node:fs')
const { arch, platform } = require('node:os')
const { join } = require('node:path')
const { spawn } = require('node:child_process')

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

// Get the socketbin package name for current platform.
function getSocketbinPackageName() {
  const p = platform()
  const a = arch()
  const musl = isMusl() ? '-musl' : ''
  return `@socketbin/cli-${p}-${a}${musl}`
}

// Get path to the socket binary.
function getSocketbinPath() {
  const packageName = getSocketbinPackageName()
  const binaryName = platform() === 'win32' ? 'socket.exe' : 'socket'

  // Try to find the binary in node_modules.
  const paths = [
    // Installed as dependency.
    join(__dirname, '..', 'node_modules', packageName, binaryName),
    // Hoisted to parent node_modules.
    join(__dirname, '..', '..', packageName, binaryName),
    // Workspace/monorepo layout.
    join(__dirname, '..', '..', '..', 'node_modules', packageName, binaryName),
  ]

  for (const p of paths) {
    if (existsSync(p)) {
      return p
    }
  }

  return undefined
}

// Main entry point.
function main() {
  const binaryPath = getSocketbinPath()

  if (!binaryPath) {
    const packageName = getSocketbinPackageName()
    console.error(`Socket CLI binary not found for your platform.`)
    console.error(`Expected package: ${packageName}`)
    console.error(``)
    console.error(`This may happen if:`)
    console.error(`  - Your platform is not supported`)
    console.error(`  - The optional dependency failed to install`)
    console.error(``)
    console.error(`Try reinstalling: npm install -g socket`)
    process.exit(1)
  }

  // Spawn the binary with all arguments.
  const child = spawn(binaryPath, process.argv.slice(2), {
    stdio: 'inherit',
  })

  child.on('error', err => {
    console.error(`Failed to start Socket CLI: ${err.message}`)
    process.exit(1)
  })

  child.on('exit', (code, signal) => {
    if (signal) {
      process.exit(1)
    }
    process.exit(code ?? 0)
  })
}

main()
