/**
 * SEA (Single Executable Application) detection utilities for Socket CLI.
 * Provides reliable detection of whether the current process is running
 * as a Node.js Single Executable Application.
 *
 * Key Functions:
 * - isSeaBinary: Detect if running as SEA
 * - getSeaBinaryPath: Get the current SEA binary path
 *
 * Detection Method:
 * - Checks for SOCKET_CLI_STUB_PATH from IPC handshake sent by bootstrap
 * - Bootstrap stub sends IPC handshake on spawn with stub path
 * - Delegates to stub-ipc.mts for actual detection
 *
 * Features:
 * - Simple delegation to stub-ipc handler
 * - Works with custom SEA bootstrap approach
 * - No separate IPC listener needed
 *
 * Usage:
 * - Detecting SEA execution context
 * - Conditional SEA-specific functionality
 * - Update notification customization
 */

import { getStubPath, isRunningViaSea } from './stub-ipc.mts'

/**
 * Detect if the current process is running as a SEA binary.
 * Delegates to stub-ipc handler which checks for IPC handshake from bootstrap.
 */
function isSeaBinary(): boolean {
  return isRunningViaSea()
}

/**
 * Get the current SEA binary path.
 * Only valid when running as a SEA binary.
 */
function getSeaBinaryPath(): string | undefined {
  return getStubPath()
}

export { getSeaBinaryPath, isSeaBinary }
