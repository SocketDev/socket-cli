/**
 * Bootstrap abstraction for SEA (Single Executable Application) subprocess handling.
 *
 * When running in a SEA binary, we need to distinguish between:
 * 1. Initial entry - Bootstrap mode: delegate to system Node.js or self with IPC
 * 2. Subprocess entry - Bypass bootstrap: act as regular Node.js
 *
 * The IPC handshake mechanism is used to detect subprocess mode:
 * - process.channel exists = subprocess
 * - SOCKET_IPC_HANDSHAKE message received = validated subprocess
 *
 * This abstraction should be used anywhere we would spawn process.execPath,
 * ensuring proper bootstrap delegation for SEA binaries.
 */

import { isSeaBinary } from './detect.mts'
import { SOCKET_IPC_HANDSHAKE } from '../../constants/shadow.mts'

import type { SpawnOptions } from '@socketsecurity/lib/spawn'

/**
 * Check if the current process is running as a subprocess with IPC.
 * Returns true if we have an IPC channel (process.channel exists).
 */
export function isSubprocess(): boolean {
  return !!process.channel
}

/**
 * Check if we should bypass bootstrap logic.
 * Returns true if:
 * - Not a SEA binary (regular Node.js doesn't need bootstrap)
 * - Running as a subprocess with IPC channel (already bootstrapped)
 */
export function shouldBypassBootstrap(): boolean {
  // If not a SEA binary, no bootstrap needed.
  if (!isSeaBinary()) {
    return true
  }

  // If we're a subprocess (have IPC channel), bypass bootstrap.
  // The parent already handled delegation.
  if (isSubprocess()) {
    return true
  }

  // We're a SEA binary in initial entry mode - need bootstrap.
  return false
}

/**
 * Get the execution path to use for spawning subprocesses.
 *
 * For SEA binaries:
 * - Returns system Node.js path if available (preferred)
 * - Returns SEA binary path if no system Node.js (will use IPC handshake)
 *
 * For regular Node.js:
 * - Returns process.execPath
 *
 * @param preferSystemNode - If true, try to find system Node.js first
 */
export function getBootstrapExecPath(preferSystemNode = true): string {
  // If not a SEA binary, just return execPath.
  if (!isSeaBinary()) {
    return process.execPath
  }

  // For SEA binaries, try to use system Node.js if available.
  if (preferSystemNode) {
    // TODO: Implement system Node.js detection.
    // For now, we'll use socket-lib's getExecPath which returns process.execPath.
    // In the future, we should check for system Node.js in PATH.
    const systemNode = findSystemNodejs()
    if (systemNode) {
      return systemNode
    }
  }

  // Fall back to SEA binary itself (will use IPC handshake for subprocesses).
  return process.execPath
}

/**
 * Find system Node.js binary in PATH (excluding the current SEA binary).
 * Returns undefined if not found or if we are not a SEA binary.
 */
function findSystemNodejs(): string | undefined {
  // TODO: Implement proper system Node.js detection.
  // This should:
  // 1. Parse PATH environment variable
  // 2. Look for 'node' or 'node.exe' executables
  // 3. Exclude the current SEA binary path
  // 4. Verify it's actually Node.js (check version)
  // 5. Return the first valid system Node.js found

  // For now, return undefined (will fall back to SEA binary).
  return undefined
}

/**
 * Prepare spawn options for subprocess execution with IPC handshake.
 *
 * When spawning a SEA binary as a subprocess, we need to:
 * 1. Ensure IPC channel is set up (stdio includes 'ipc')
 * 2. Send SOCKET_IPC_HANDSHAKE message after spawn
 *
 * @param options - Base spawn options
 * @param ipcData - IPC handshake data to send (if spawning SEA binary)
 */
export function prepareBootstrapSpawnOptions(
  options: SpawnOptions | undefined,
  ipcData?: Record<string, unknown>,
): SpawnOptions {
  const opts = { ...options }

  // If we're spawning a SEA binary as a subprocess, ensure IPC channel.
  if (isSeaBinary() && ipcData) {
    // Ensure stdio includes 'ipc' for IPC channel.
    // This is handled by ensureIpcInStdio in shadow/stdio-ipc.mts.
    // We'll document that callers should use that utility.
  }

  return opts
}

/**
 * Send IPC handshake message to a spawned subprocess.
 *
 * This should be called immediately after spawning a SEA binary
 * as a subprocess, so it knows to bypass bootstrap logic.
 *
 * @param childProcess - The spawned child process
 * @param ipcData - IPC handshake data to send
 */
export function sendBootstrapHandshake(
  childProcess: { send: (message: unknown) => void },
  ipcData: Record<string, unknown>,
): void {
  childProcess.send({
    [SOCKET_IPC_HANDSHAKE]: ipcData,
  })
}

/**
 * Wait for IPC handshake message on subprocess startup.
 *
 * This should be called at the entry point of a SEA binary
 * to detect if it's running as a subprocess.
 *
 * Returns a promise that resolves with the IPC data when received,
 * or rejects if not received within timeout.
 *
 * The returned IPC data includes:
 * - Bootstrap indicators: subprocess, parent_pid
 * - Custom data: shadow config, application settings, etc.
 *
 * @param timeoutMs - Timeout in milliseconds (default: 5000)
 */
export function waitForBootstrapHandshake(
  timeoutMs = 5000,
): Promise<Record<string, unknown> | undefined> {
  // If no IPC channel, we're not a subprocess.
  if (!isSubprocess()) {
    return Promise.resolve(undefined)
  }

  return new Promise((resolve, reject) => {
    let resolved = false

    const handler = (message: unknown) => {
      if (resolved) {
        return
      }

      // Check if message has SOCKET_IPC_HANDSHAKE key.
      if (
        message &&
        typeof message === 'object' &&
        SOCKET_IPC_HANDSHAKE in message
      ) {
        const ipcData = (message as Record<string, unknown>)[
          SOCKET_IPC_HANDSHAKE
        ] as Record<string, unknown> | undefined

        // Validate bootstrap indicators are present.
        if (
          ipcData &&
          typeof ipcData === 'object' &&
          ipcData['subprocess'] === true &&
          typeof ipcData['parent_pid'] === 'number'
        ) {
          resolved = true
          clearTimeout(timeout)
          process.off('message', handler)
          resolve(ipcData)
        }
      }
    }

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true
        process.off('message', handler)
        reject(
          new Error(
            'IPC handshake timeout: expected SOCKET_IPC_HANDSHAKE message',
          ),
        )
      }
    }, timeoutMs)

    process.on('message', handler)
  })
}
