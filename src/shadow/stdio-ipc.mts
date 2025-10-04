/** @fileoverview stdio IPC channel utilities for Socket CLI shadow binaries. Ensures child process stdio configuration includes IPC channel for parent-child communication in shadow wrappers. */

import type { StdioOptions } from 'node:child_process'

/**
 * Ensures stdio configuration includes IPC channel for process communication.
 * Converts various stdio formats to include 'ipc' as the fourth element.
 */
export function ensureIpcInStdio(
  stdio: StdioOptions | undefined,
): StdioOptions {
  if (typeof stdio === 'string') {
    return [stdio, stdio, stdio, 'ipc']
  } else if (Array.isArray(stdio)) {
    if (!stdio.includes('ipc')) {
      return stdio.concat('ipc')
    }
    // Return original array if ipc is already present
    return stdio
  } else {
    return ['pipe', 'pipe', 'pipe', 'ipc']
  }
}
