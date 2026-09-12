/**
 * Unified Socket CLI entry point.
 *
 * This single file handles all Socket CLI commands by detecting how it was
 * invoked: - socket (main CLI) - socket-npm, npm wrapper - socket-npx (npx
 * wrapper)
 *
 * Perfect for SEA packaging and single-file distribution.
 *
 * Bootstrap Logic: When running as a SEA binary, we use IPC handshake to detect
 * subprocess mode: - Initial entry (no IPC): Bootstrap to system Node.js or
 * self with IPC - Subprocess entry (has IPC): Bypass bootstrap, act as regular
 * Node.js.
 */

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { getInvocationMode } from './util/cli/invocation-mode.mts'
import { waitForBootstrapHandshake } from './util/sea/boot.mjs'

const logger = getDefaultLogger()

// Route to the appropriate CLI based on invocation mode.
async function main() {
  // If we're a subprocess with IPC, wait for handshake.
  // This validates we're running in the correct context.
  // Note: The handshake is used by Socket Firewall (sfw) operations to pass
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
  process.exit(1)
})
