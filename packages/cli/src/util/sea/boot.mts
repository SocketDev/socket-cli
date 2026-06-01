/**
 * Bootstrap abstraction for SEA (Single Executable Application) subprocess
 * handling.
 *
 * When running in a SEA binary, we need to distinguish between:
 *
 * 1. Initial entry - Bootstrap mode: delegate to system Node.js or self with IPC
 * 2. Subprocess entry - Bypass bootstrap: act as regular Node.js
 *
 * The IPC handshake mechanism is used to detect subprocess mode:
 *
 * - Process.channel exists = subprocess
 * - SOCKET_IPC_HANDSHAKE message received = validated subprocess
 *
 * This abstraction should be used anywhere we would spawn process.execPath,
 * ensuring proper bootstrap delegation for SEA binaries.
 */

import { SOCKET_IPC_HANDSHAKE } from "@socketsecurity/lib-stable/constants/socket";

/**
 * Check if the current process is running as a subprocess with IPC. Returns
 * true if we have an IPC channel (process.channel exists).
 */
export function isSubprocess(): boolean {
  return !!process.channel;
}

/**
 * Send IPC handshake message to a spawned subprocess.
 *
 * This should be called immediately after spawning a SEA binary as a
 * subprocess, so it knows to bypass bootstrap logic.
 *
 * @param childProcess - The spawned child process.
 * @param ipcData - IPC handshake data to send.
 */
export function sendBootstrapHandshake(
  childProcess: { send: (message: unknown) => void },
  ipcData: Record<string, unknown>,
): void {
  childProcess.send({
    [SOCKET_IPC_HANDSHAKE]: ipcData,
  });
}

/**
 * Wait for IPC handshake message on subprocess startup.
 *
 * This should be called at the entry point of a SEA binary to detect if it's
 * running as a subprocess.
 *
 * Returns a promise that resolves with the IPC data when received, or rejects
 * if not received within timeout.
 *
 * The returned IPC data includes:
 *
 * - Bootstrap indicators: subprocess, parent_pid
 * - Custom data: wrapper config, application settings, etc.
 *
 * @param timeoutMs - Timeout in milliseconds (default: 5000)
 */
export function waitForBootstrapHandshake(
  timeoutMs = 5000,
): Promise<Record<string, unknown> | undefined> {
  // If no IPC channel, we're not a subprocess.
  if (!isSubprocess()) {
    return Promise.resolve(undefined);
  }

  return new Promise((resolve, reject) => {
    let resolved = false;

    const handler = (message: unknown) => {
      /* c8 ignore start - guard fires only on a duplicate IPC message after promise resolved */
      if (resolved) {
        return;
      }
      /* c8 ignore stop */

      // Check if message has SOCKET_IPC_HANDSHAKE key.
      if (message && typeof message === "object" && SOCKET_IPC_HANDSHAKE in message) {
        const ipcData = (message as Record<string, unknown>)[SOCKET_IPC_HANDSHAKE] as
          | Record<string, unknown>
          | undefined;

        // Validate bootstrap indicators are present.
        if (
          ipcData &&
          typeof ipcData === "object" &&
          ipcData["subprocess"] === true &&
          typeof ipcData["parent_pid"] === "number"
        ) {
          resolved = true;
          clearTimeout(timeout);
          process.off("message", handler);
          resolve(ipcData);
        }
      }
    };

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        process.off("message", handler);
        reject(new Error("IPC handshake timeout: expected SOCKET_IPC_HANDSHAKE message"));
      }
    }, timeoutMs);

    process.on("message", handler);
  });
}
