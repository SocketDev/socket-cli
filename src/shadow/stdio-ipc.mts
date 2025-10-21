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
  }
  if (Array.isArray(stdio)) {
    if (!stdio.includes('ipc')) {
      return stdio.concat('ipc')
    }
    return stdio.slice()
  }
  return ['pipe', 'pipe', 'pipe', 'ipc']
}
