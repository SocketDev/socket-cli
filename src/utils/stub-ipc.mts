/**
 * Stub IPC utilities for inter-process communication.
 */

import os from 'node:os'
import path from 'node:path'

/**
 * Get the path to the IPC stub file.
 * This is used for inter-process communication during self-update.
 *
 * @returns The path to the IPC stub file.
 */
export function getStubPath(): string {
  const tmpDir = os.tmpdir()
  return path.join(tmpDir, 'socket-cli-ipc.stub')
}
