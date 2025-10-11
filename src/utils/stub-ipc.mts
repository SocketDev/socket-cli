/**
 * Stub IPC utilities for inter-process communication.
 * Re-exports from socket-registry for consistency.
 */

import { getIpcStubPath } from '@socketsecurity/registry/lib/ipc'

/**
 * Get the path to the IPC stub file.
 * This is used for inter-process communication during self-update.
 *
 * @returns The path to the IPC stub file.
 */
export function getStubPath(): string {
  return getIpcStubPath('socket-cli')
}
