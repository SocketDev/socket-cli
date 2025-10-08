#!/usr/bin/env node
'use strict'

/**
 * @fileoverview Platform dispatcher for Socket CLI.
 * Selects and runs the appropriate platform-specific binary from @socketbin/*.
 */

const { spawn } = require('node:child_process')
const { existsSync, realpathSync } = require('node:fs')
const os = require('node:os')
const path = require('node:path')

// Detect platform and architecture
const platform = os.platform()
const arch = os.arch()
const ext = platform === 'win32' ? '.exe' : ''

// Map Node.js arch to our binary arch names if needed
const archMap = {
  x64: 'x64',
  arm64: 'arm64',
  // Add more mappings if we support other architectures
}

const mappedArch = archMap[arch] || arch

// Build package name
const packageName = `@socketbin/cli-${platform}-${mappedArch}`

// Try to resolve binary path
let binaryPath

try {
  // Try to resolve the binary package
  // This will throw if the package isn't installed
  const packageJsonPath = require.resolve(`${packageName}/package.json`)
  const packageDir = path.dirname(packageJsonPath)
  binaryPath = path.join(packageDir, 'bin', `cli${ext}`)

  // Verify binary exists
  if (!existsSync(binaryPath)) {
    throw new Error(`Binary not found at: ${binaryPath}`)
  }

  // Resolve symlinks to get actual binary path
  try {
    binaryPath = realpathSync(binaryPath)
  } catch {
    // If realpath fails, continue with original path
  }
} catch {
  // Binary package not found or other error
  console.error(`Error: Socket CLI binary not available for ${platform}-${mappedArch}`)
  console.error(``)

  // Check if this is an unsupported platform
  const supportedPlatforms = [
    'darwin-x64', 'darwin-arm64',
    'linux-x64', 'linux-arm64',
    'win32-x64', 'win32-arm64'
  ]

  if (!supportedPlatforms.includes(`${platform}-${mappedArch}`)) {
    console.error(`Your platform (${platform}-${mappedArch}) is not supported by Socket CLI binaries.`)
    console.error(``)
    console.error(`Supported platforms:`)
    supportedPlatforms.forEach(p => {
      const [os, arch] = p.split('-')
      console.error(`  - ${os} ${arch}`)
    })
    console.error(``)
    console.error(`You can install the JavaScript version instead:`)
    console.error(`  npm install -g @socketsecurity/cli`)
    console.error(``)
    console.error(`Then use: npx @socketsecurity/cli`)
  } else {
    // Supported platform but package missing
    console.error(`The package ${packageName} was not installed properly.`)
    console.error(``)
    console.error(`Try reinstalling:`)
    console.error(`  npm uninstall -g socket`)
    console.error(`  npm install -g socket`)
    console.error(``)
    console.error(`If the problem persists, you can install from source:`)
    console.error(`  npm install -g @socketsecurity/cli`)
  }

  console.error(``)
  console.error(`For help, visit: https://github.com/SocketDev/socket-cli/issues`)

  // eslint-disable-next-line n/no-process-exit
  process.exit(1)
}

// Spawn the binary with all arguments
const child = spawn(binaryPath, process.argv.slice(2), {
  stdio: 'inherit',
  env: process.env,
  cwd: process.cwd(),
  // Preserve colors and TTY
  windowsHide: true
})

// Handle signals
const signals = ['SIGTERM', 'SIGINT', 'SIGBREAK', 'SIGHUP']
signals.forEach(signal => {
  process.on(signal, () => {
    if (!child.killed) {
      child.kill(signal)
    }
  })
})

// Handle child exit
child.on('exit', (code, signal) => {
  if (signal) {
    // If child exited due to signal, propagate it
    process.kill(process.pid, signal)
  } else {
    // Otherwise exit with child's exit code
    // eslint-disable-next-line n/no-process-exit
    process.exit(code ?? 0)
  }
})

// Handle spawn errors
child.on('error', error => {
  if (error.code === 'ENOENT') {
    console.error(`Error: Binary not found at ${binaryPath}`)
    console.error(`This usually means the package was corrupted during installation.`)
  } else if (error.code === 'EACCES') {
    console.error(`Error: Permission denied executing ${binaryPath}`)
    console.error(`Try: chmod +x "${binaryPath}"`)
  } else {
    console.error(`Failed to start Socket CLI:`, error.message)
  }
  // eslint-disable-next-line n/no-process-exit
  process.exit(1)
})