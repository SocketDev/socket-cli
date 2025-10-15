#!/usr/bin/env node
/* eslint-disable n/no-process-exit -- CLI entry point requires process.exit */
'use strict'

/**
 * @fileoverview Platform dispatcher for Socket CLI.
 *
 * This script is the entry point for the `socket` npm package. It detects the
 * current platform/architecture and routes execution to the appropriate
 * platform-specific binary from the @socketbin/* optional dependencies.
 *
 * Architecture:
 * 1. User installs `socket` package from npm
 * 2. npm automatically installs the matching @socketbin/cli-{platform}-{arch}
 * 3. This dispatcher locates and executes that binary
 * 4. The binary (bootstrap) downloads @socketsecurity/cli on first run
 *
 * Supported platforms:
 * - darwin (macOS): x64, arm64
 * - linux (glibc): x64, arm64
 * - alpine (musl): x64, arm64
 * - win32 (Windows): x64, arm64
 *
 * Error handling:
 * - Unsupported architecture: Exit with helpful message
 * - Missing binary package: Suggest reinstall or JavaScript fallback
 * - Spawn errors: Provide specific guidance based on error code
 */

const { spawn } = require('node:child_process')
const { existsSync, realpathSync } = require('node:fs')
const os = require('node:os')
const path = require('node:path')

// ============================================================================
// Platform and Architecture Detection
// ============================================================================

// Detect the current platform and architecture using Node.js APIs.
const platform = os.platform()
const arch = os.arch()
const ext = platform === 'win32' ? '.exe' : ''

// Map Node.js architecture names to binary architecture names.
// We only support x64 (Intel/AMD 64-bit) and arm64 (ARM 64-bit).
// Other architectures like armv7l, ia32, ppc64, s390x are not supported.
const archMap = {
  arm64: 'arm64',
  x64: 'x64',
}

const mappedArch = archMap[arch]

// Exit early if the architecture is not supported.
// This prevents creating invalid package names for unsupported architectures.
if (!mappedArch) {
  console.error(`Error: Unsupported architecture: ${arch}`)
  console.error(``)
  console.error(`Supported architectures: arm64, x64`)
  console.error(``)
  console.error(`You can install the JavaScript version instead:`)
  console.error(`  npm install -g @socketsecurity/cli`)
  console.error(``)
  console.error(`Then use: npx @socketsecurity/cli`)
  process.exit(1)
}

// ============================================================================
// Alpine Linux Detection
// ============================================================================

/**
 * Detect if running on Alpine Linux.
 *
 * Alpine uses musl libc instead of glibc, which requires specially compiled
 * binaries. We detect Alpine by checking for the /etc/alpine-release file.
 *
 * This is critical because:
 * - Node.js reports Alpine as platform='linux'
 * - But Alpine binaries are incompatible with standard Linux binaries
 * - We need to route to @socketbin/cli-alpine-{arch} instead of
 *   @socketbin/cli-linux-{arch}
 *
 * @returns {boolean} True if running on Alpine Linux, false otherwise.
 */
function isAlpine() {
  try {
    return existsSync('/etc/alpine-release')
  } catch {
    return false
  }
}

// Determine the platform variant (e.g., 'alpine' vs 'linux').
// On Linux systems, we need to distinguish between glibc (standard Linux)
// and musl (Alpine Linux) because they require different binaries.
const platformVariant = platform === 'linux' && isAlpine() ? 'alpine' : platform

// Build the package name for the platform-specific binary.
// Examples: @socketbin/cli-darwin-arm64, @socketbin/cli-linux-x64, @socketbin/cli-alpine-x64
const packageName = `@socketbin/cli-${platformVariant}-${mappedArch}`

// ============================================================================
// Binary Resolution
// ============================================================================

// Try to resolve the path to the platform-specific binary.
// This uses Node.js's require.resolve() to find the installed @socketbin/*
// package, which npm automatically installs based on optionalDependencies.
let binaryPath

try {
  // Resolve the package.json of the platform-specific binary package.
  // This works because npm installs optionalDependencies that match the
  // current platform, and skips non-matching ones.
  const packageJsonPath = require.resolve(`${packageName}/package.json`)
  const packageDir = path.dirname(packageJsonPath)
  binaryPath = path.join(packageDir, 'bin', `cli${ext}`)

  // Verify the binary file exists at the expected location.
  // This catches cases where the package is installed but corrupted.
  if (!existsSync(binaryPath)) {
    throw new Error(`Binary not found at: ${binaryPath}`)
  }

  // Resolve symlinks to get the actual binary path.
  // This ensures we execute the real binary, not a symlink wrapper.
  // This is particularly important on Unix systems where the binary might
  // be symlinked from multiple locations (e.g., /usr/local/bin/socket).
  //
  // If resolution fails (e.g., broken symlink), we continue with the original
  // path and let the spawn error handler deal with it.
  try {
    binaryPath = realpathSync(binaryPath)
  } catch {
    // If realpath fails, continue with original path.
  }
} catch (error) {
  // Binary package not found or other resolution error.
  // This can happen if:
  // 1. The platform is not supported
  // 2. The optionalDependency failed to install
  // 3. The package was corrupted during installation
  console.error(
    `Error: Socket CLI binary not available for ${platformVariant}-${mappedArch}`,
  )
  console.error(``)

  // Check if this is an unsupported platform vs. a supported platform with
  // a missing binary package. This helps us provide more specific error messages.
  const supportedPlatforms = [
    'alpine-arm64',
    'alpine-x64',
    'darwin-arm64',
    'darwin-x64',
    'linux-arm64',
    'linux-x64',
    'win32-arm64',
    'win32-x64',
  ]

  // Case 1: Unsupported platform (e.g., FreeBSD, OpenBSD, AIX, etc.)
  if (!supportedPlatforms.includes(`${platformVariant}-${mappedArch}`)) {
    console.error(
      `Your platform (${platformVariant}-${mappedArch}) is not supported by Socket CLI binaries.`,
    )
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
    // Case 2: Supported platform but binary package is missing.
    // This can happen if:
    // - npm failed to install the optionalDependency
    // - The package was manually deleted
    // - There was a network issue during installation
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
  console.error(
    `For help, visit: https://github.com/SocketDev/socket-cli/issues`,
  )

  process.exit(1)
}

// ============================================================================
// Binary Execution
// ============================================================================

// Spawn the platform-specific binary as a child process.
// We pass through all command-line arguments (process.argv.slice(2) skips
// 'node' and this script path), inherit stdio to make the binary appear as
// if it was invoked directly, and preserve the environment and working directory.
//
// The windowsHide option prevents a console window from appearing on Windows
// when the binary is launched from a GUI application.
const child = spawn(binaryPath, process.argv.slice(2), {
  stdio: 'inherit', // Inherit stdin, stdout, stderr from parent.
  env: process.env, // Pass through environment variables.
  cwd: process.cwd(), // Maintain current working directory.
  windowsHide: true, // Hide console window on Windows GUI apps.
})

// ============================================================================
// Signal Handling
// ============================================================================

// Handle process signals and forward them to the child process.
// This ensures that when the dispatcher receives a signal (e.g., Ctrl+C),
// it properly forwards it to the binary instead of just terminating itself.
//
// Signal handling is platform-specific:
// - All platforms: SIGABRT, SIGALRM, SIGHUP, SIGINT, SIGTERM
// - Unix only: SIGVTALRM, SIGXCPU, SIGXFSZ, SIGUSR2, SIGTRAP, SIGSYS, SIGQUIT, SIGIOT
// - Linux only: SIGIO, SIGPOLL, SIGPWR, SIGSTKFLT
//
// This pattern is based on signal-exit from @socketsecurity/registry/lib/signal-exit.
const WIN32 = platform === 'win32'
const signals = ['SIGABRT', 'SIGALRM', 'SIGHUP', 'SIGINT', 'SIGTERM']

// Add Unix-specific signals (not available on Windows).
if (!WIN32) {
  signals.push(
    'SIGVTALRM', // Virtual timer alarm
    'SIGXCPU',   // CPU time limit exceeded
    'SIGXFSZ',   // File size limit exceeded
    'SIGUSR2',   // User-defined signal 2
    'SIGTRAP',   // Trace/breakpoint trap
    'SIGSYS',    // Bad system call
    'SIGQUIT',   // Quit from keyboard
    'SIGIOT'     // IOT trap (alias for SIGABRT)
  )
}

// Add Linux-specific signals.
if (platform === 'linux') {
  signals.push(
    'SIGIO',      // I/O now possible
    'SIGPOLL',    // Pollable event (alias for SIGIO)
    'SIGPWR',     // Power failure
    'SIGSTKFLT'   // Stack fault on coprocessor
  )
}

// Register signal handlers, filtering out any signals that are not supported
// on the current platform. The try/catch ensures we don't crash if a signal
// is not available (e.g., SIGPOLL on some systems).
signals.forEach(signal => {
  try {
    process.on(signal, () => {
      // Only forward the signal if the child hasn't already been killed.
      if (!child.killed) {
        // SIGHUP throws an ENOSYS error on Windows, so we convert it to SIGINT.
        // This is necessary because Windows doesn't support SIGHUP.
        const killSig = WIN32 && signal === 'SIGHUP' ? 'SIGINT' : signal
        child.kill(killSig)
      }
    })
  } catch {
    // Signal not supported on this platform, skip it.
    // This is normal and expected - not all signals are available on all platforms.
  }
})

// ============================================================================
// Exit Handling
// ============================================================================

// Handle child process exit.
// We need to exit with the same code/signal as the child to properly convey
// the exit status to the parent process (e.g., shell scripts checking $?).
child.on('exit', (code, signal) => {
  if (signal) {
    // If the child exited due to a signal (e.g., SIGTERM), we propagate that
    // signal to ourselves. This ensures the parent process sees the correct
    // termination reason.
    process.kill(process.pid, signal)
  } else {
    // Otherwise, exit with the child's exit code.
    // Use 0 as fallback if code is null/undefined (shouldn't happen in practice).
    process.exit(code ?? 0)
  }
})

// ============================================================================
// Error Handling
// ============================================================================

// Handle errors that occur when spawning the child process.
// These errors are different from the child process exiting with an error code.
// Spawn errors typically indicate problems with the binary itself, not the
// command being executed.
child.on('error', error => {
  if (error.code === 'ENOENT') {
    // The binary file doesn't exist at the resolved path.
    // This is very rare since we check existsSync() before spawning, but can
    // happen if the file is deleted between the check and spawn.
    console.error(`Error: Binary not found at ${binaryPath}`)
    console.error(``)
    console.error(
      `This usually means the package was corrupted during installation.`,
    )
    console.error(``)
    console.error(`Try reinstalling:`)
    console.error(`  npm uninstall -g socket`)
    console.error(`  npm install -g socket`)
  } else if (error.code === 'EACCES') {
    // Permission denied when trying to execute the binary.
    // This typically happens on Unix when the binary doesn't have execute
    // permissions (should be 755 or 0o755).
    console.error(`Error: Permission denied executing ${binaryPath}`)
    console.error(``)
    console.error(`Try: chmod +x "${binaryPath}"`)
  } else if (error.code === 'ENOEXEC') {
    // The binary format is not executable on this system.
    // This can happen if:
    // - The binary was compiled for a different architecture
    // - The binary is corrupted
    // - On Linux, the binary is for a different libc (glibc vs musl)
    console.error(`Error: Binary format not executable: ${binaryPath}`)
    console.error(``)
    console.error(
      `This may indicate an architecture mismatch or corrupted binary.`,
    )
    console.error(``)
    console.error(`Try reinstalling or use the JavaScript version:`)
    console.error(`  npm install -g @socketsecurity/cli`)
  } else {
    // Unknown error - provide debug information.
    console.error(`Failed to start Socket CLI:`, error.message)
    console.error(``)
    console.error(`Binary path: ${binaryPath}`)
    console.error(`Platform: ${platformVariant}-${mappedArch}`)
    console.error(``)
    console.error(`For help, visit: https://github.com/SocketDev/socket-cli/issues`)
  }
  process.exit(1)
})
