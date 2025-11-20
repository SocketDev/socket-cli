/**
 * IPC Validation Module
 *
 * Provides runtime validation for IPC messages in socket-cli.
 * Ensures type safety for inter-process communication.
 */

import type { IpcHandshake, IpcMessage, IpcStub } from '@socketsecurity/lib/ipc'

/**
 * Check if a value is a valid IPC message.
 */
export function isValidIpcMessage(value: unknown): value is IpcMessage {
  if (!value || typeof value !== 'object') {
    return false
  }

  const msg = value as Record<string, unknown>
  return (
    typeof msg['id'] === 'string' &&
    msg['id'].length > 0 &&
    typeof msg['timestamp'] === 'number' &&
    msg['timestamp'] > 0 &&
    typeof msg['type'] === 'string' &&
    msg['type'].length > 0 &&
    'data' in msg
  )
}

/**
 * Check if a value is a valid IPC handshake message.
 */
export function isValidIpcHandshake(value: unknown): value is IpcHandshake {
  if (!isValidIpcMessage(value)) {
    return false
  }

  const msg = value as IpcMessage
  if (msg.type !== 'handshake' || !msg.data || typeof msg.data !== 'object') {
    return false
  }

  const data = msg.data as Record<string, unknown>
  return (
    typeof data['version'] === 'string' &&
    typeof data['pid'] === 'number' &&
    data['pid'] > 0 &&
    typeof data['appName'] === 'string' &&
    (data['apiToken'] === undefined || typeof data['apiToken'] === 'string')
  )
}

/**
 * Check if a value is a valid IPC handle.
 */
export function isValidIpcHandle(value: unknown): value is IpcStub {
  if (!value || typeof value !== 'object') {
    return false
  }

  const handle = value as Record<string, unknown>
  return (
    typeof handle['pid'] === 'number' &&
    handle['pid'] > 0 &&
    typeof handle['timestamp'] === 'number' &&
    handle['timestamp'] > 0 &&
    'data' in handle
  )
}

/**
 * Create a valid IPC message with current timestamp.
 */
export function createIpcMessage<T = unknown>(
  type: string,
  data: T,
): IpcMessage<T> {
  return {
    id: `${process.pid}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    timestamp: Date.now(),
    type,
    data,
  }
}

/**
 * Create a valid IPC handshake message.
 */
export function createIpcHandshake(options: {
  version: string
  apiToken?: string
  appName: string
}): IpcHandshake {
  return createIpcMessage('handshake', {
    version: options.version,
    pid: process.pid,
    apiToken: options.apiToken,
    appName: options.appName,
  }) as IpcHandshake
}

/**
 * Validate and parse IPC message from unknown input.
 */
export function parseIpcMessage(value: unknown): IpcMessage | null {
  if (isValidIpcMessage(value)) {
    return value
  }

  // Try to parse if it's a JSON string.
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      if (isValidIpcMessage(parsed)) {
        return parsed
      }
    } catch {
      // Invalid JSON, return null.
    }
  }

  return null
}
