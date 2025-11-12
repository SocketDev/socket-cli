/**
 * Unified Socket CLI entry point.
 *
 * This single file handles all Socket CLI commands by detecting how it was invoked:
 * - socket (main CLI)
 * - socket-npm (npm wrapper)
 * - socket-npx (npx wrapper)
 *
 * Perfect for SEA packaging and single-file distribution.
 *
 * Bootstrap Logic:
 * When running as a SEA binary, we use IPC handshake to detect subprocess mode:
 * - Initial entry (no IPC): Bootstrap to system Node.js or self with IPC
 * - Subprocess entry (has IPC): Bypass bootstrap, act as regular Node.js
 */

import path from 'node:path'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { waitForBootstrapHandshake } from './utils/sea/boot.mjs'

const logger = getDefaultLogger()

// Detect how this binary was invoked.
function getInvocationMode(): string {
  // Check environment variable first (for explicit mode).
  const envMode = process.env['SOCKET_CLI_MODE']
  if (envMode) {
    return envMode
  }

  // Check process.argv[1] for the actual script name.
  const scriptPath = process.argv[1]
  if (scriptPath) {
    const scriptName = path
      .basename(scriptPath)
      .replace(/\.(js|mjs|cjs|exe)$/i, '')

    // Map script names to modes.
    if (scriptName.endsWith('-npm') || scriptName === 'npm') {
      return 'npm'
    }
    if (scriptName.endsWith('-npx') || scriptName === 'npx') {
      return 'npx'
    }
    if (scriptName.endsWith('-pnpm') || scriptName === 'pnpm') {
      return 'pnpm'
    }
    if (scriptName.endsWith('-yarn') || scriptName === 'yarn') {
      return 'yarn'
    }
    // For 'cli' or anything containing 'socket', default to socket mode.
    if (scriptName.includes('socket') || scriptName === 'cli') {
      return 'socket'
    }
  }

  // Check process.argv0 as fallback.
  const argv0 = path
    .basename(process.argv0 || process.execPath)
    .replace(/\.exe$/i, '')

  if (argv0.endsWith('npm')) {
    return 'npm'
  }
  if (argv0.endsWith('npx')) {
    return 'npx'
  }
  if (argv0.endsWith('pnpm')) {
    return 'pnpm'
  }
  if (argv0.endsWith('yarn')) {
    return 'yarn'
  }

  // Default to main Socket CLI.
  return 'socket'
}

// Route to the appropriate CLI based on invocation mode.
async function main() {
  // If we're a subprocess with IPC, wait for handshake.
  // This validates we're running in the correct context.
  // Note: The handshake is used by shadow npm/pnpm/yarn operations to pass
  // configuration (API token, bin name, etc.) to the subprocess.
  try {
    await waitForBootstrapHandshake(1000) // 1 second timeout.
    // Handshake received - we're a validated subprocess.
  } catch {
    // No handshake received, or we're not a subprocess.
    // This is normal for initial entry.
  }

  const mode = getInvocationMode()

  // Set environment variable for child processes.
  process.env['SOCKET_CLI_MODE'] = mode

  // Import and run the appropriate CLI function.
  // All wrapper modes now route through the main CLI entry with the mode set.
  // The CLI will detect the mode and run the appropriate command.
  await import('./cli-entry.mjs')
}

// Run the appropriate CLI.
main().catch(error => {
  logger.error('Socket CLI Error:', error)
  // eslint-disable-next-line n/no-process-exit -- Required for CLI error handling.
  process.exit(1)
})
