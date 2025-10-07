/** @fileoverview IPC handler for receiving stub path from bootstrap executable. Stores the path for use in self-update mechanism and SEA detection. */

import process from 'node:process'

import constants from '../constants.mts'
import { debugFn } from './debug.mts'

import type { IpcObject } from '../constants.mts'

/**
 * Module-level storage for stub path received via IPC from bootstrap executable.
 * The bootstrap stub sends its location so the CLI can update it when needed.
 */
let stubPath: string | undefined

/**
 * Get the stub path received via IPC from the bootstrap executable.
 * Returns undefined if not running via bootstrap stub or IPC message not received.
 */
export function getStubPath(): string | undefined {
  return stubPath
}

/**
 * Check if running as SEA binary based on whether stub path was received.
 * When the bootstrap stub spawns the CLI, it sends its path via IPC.
 * This is a reliable indicator that we're running via the SEA bootstrap.
 */
export function isRunningViaSea(): boolean {
  return stubPath !== undefined
}

/**
 * Initialize IPC message handler to receive stub path from bootstrap.
 * Should be called early in CLI initialization.
 * Expects IPC messages wrapped in SOCKET_IPC_HANDSHAKE for consistency with shadow binaries.
 */
export function initStubIpcHandler(): void {
  // Only listen for IPC if we have a connected IPC channel.
  if (process.send) {
    process.on('message', (message: unknown) => {
      if (message && typeof message === 'object') {
        // Check for SOCKET_IPC_HANDSHAKE wrapper (standard protocol)
        if (constants.SOCKET_IPC_HANDSHAKE in message) {
          const handshake = (message as any)[constants.SOCKET_IPC_HANDSHAKE]
          if (
            handshake &&
            typeof handshake === 'object' &&
            'SOCKET_CLI_STUB_PATH' in handshake
          ) {
            const stubPathValue = (handshake as any).SOCKET_CLI_STUB_PATH
            if (stubPathValue && typeof stubPathValue === 'string') {
              stubPath = stubPathValue
              debugFn('info', `Received stub path via IPC handshake: ${stubPath}`)
            }
          }
        }
        // Also support legacy format without wrapper for backwards compatibility
        else if ('SOCKET_CLI_STUB_PATH' in message) {
          const ipc = message as IpcObject
          if (ipc.SOCKET_CLI_STUB_PATH && typeof ipc.SOCKET_CLI_STUB_PATH === 'string') {
            stubPath = ipc.SOCKET_CLI_STUB_PATH
            debugFn('info', `Received stub path via IPC (legacy): ${stubPath}`)
          }
        }
      }
    })
  }
}
