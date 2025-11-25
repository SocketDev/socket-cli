/**
 * IPC data handling for shadow npm processes.
 *
 * Provides access to IPC data passed via bootstrap handshake.
 * The handshake includes shadow configuration like API tokens,
 * bin names, and other settings needed by the arborist.
 */

import { waitForBootstrapHandshake } from './sea/boot.mjs'

import type { IpcObject } from '../constants/shadow.mts'

// Store for IPC extra data received via handshake.
let ipcExtra: IpcObject | undefined

// Store for bootstrap binary path received via handshake.
let bootstrapBinaryPath: string | undefined

/**
 * Get IPC extra data from handshake.
 * Returns the extra field from the bootstrap handshake.
 */
export function getIpcExtra(): IpcObject | undefined {
  return ipcExtra
}

/**
 * Get bootstrap binary path from handshake.
 * Returns the path to the bootstrap wrapper that launched this CLI instance.
 * Only available when CLI was launched via a bootstrap wrapper (e.g., npx socket).
 */
export function getBootstrapBinaryPath(): string | undefined {
  return bootstrapBinaryPath
}

/**
 * Initialize IPC data handling.
 * Waits for the bootstrap handshake and extracts the extra field.
 */
export async function initializeIpc(): Promise<void> {
  try {
    const handshake = await waitForBootstrapHandshake(1000)
    if (handshake?.['extra']) {
      const extra = handshake['extra'] as Record<string, unknown>

      // Extract bootstrap binary path if provided.
      if (typeof extra['bootstrapBinaryPath'] === 'string') {
        bootstrapBinaryPath = extra['bootstrapBinaryPath']
      }

      // Extract shadow IPC data (excluding bootstrap metadata).
      const { bootstrapBinaryPath: _, ...shadowData } = extra
      ipcExtra = shadowData as IpcObject
    }
  } catch {
    // No handshake - running without IPC.
  }
}
