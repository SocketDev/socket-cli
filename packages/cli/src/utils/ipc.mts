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

/**
 * Get IPC extra data from handshake.
 * Returns the extra field from the bootstrap handshake.
 */
export function getIpcExtra(): IpcObject | undefined {
  return ipcExtra
}

/**
 * Initialize IPC data handling.
 * Waits for the bootstrap handshake and extracts the extra field.
 */
export async function initializeIpc(): Promise<void> {
  try {
    const handshake = await waitForBootstrapHandshake(1000)
    if (handshake?.['extra']) {
      ipcExtra = handshake['extra'] as IpcObject
    }
  } catch {
    // No handshake - running without IPC.
  }
}
