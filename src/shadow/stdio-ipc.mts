import type { Stdio } from '@socketsecurity/registry/lib/spawn'

/**
 * Ensures stdio configuration includes IPC channel for process communication.
 * Converts various stdio formats to include 'ipc' as the fourth element.
 */
export function ensureIpcInStdio(stdio: Stdio | undefined): Stdio {
  if (typeof stdio === 'string') {
    return [stdio, stdio, stdio, 'ipc']
  } else if (Array.isArray(stdio)) {
    if (!stdio.includes('ipc')) {
      return stdio.concat('ipc')
    }
    return stdio
  } else {
    return ['pipe', 'pipe', 'pipe', 'ipc']
  }
}
