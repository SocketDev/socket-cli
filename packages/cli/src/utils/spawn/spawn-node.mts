/**
 * Node.js spawn abstraction with SEA bootstrap handling.
 *
 * Provides a `spawnNode()` function that automatically handles:
 * - System Node.js detection and delegation (when in SEA)
 * - Self-spawning with IPC handshake (when no system Node.js available)
 * - Regular process.execPath spawning (when not in SEA)
 *
 * This abstraction should be used anywhere we need to spawn Node.js,
 * replacing direct calls to spawn(process.execPath, ...) or spawn(getExecPath(), ...).
 *
 * Example usage:
 * ```typescript
 * // Instead of:
 * spawn(getExecPath(), ['script.js', ...args], { stdio: 'inherit' })
 *
 * // Use:
 * spawnNode(['script.js', ...args], { stdio: 'inherit' })
 * ```
 */

import { spawn } from '@socketsecurity/lib/spawn'
import { getExecPath } from '@socketsecurity/lib/constants/node'

import { isSeaBinary } from '../sea/detect.mjs'
import { sendBootstrapHandshake } from '../sea/boot.mjs'
import { ensureIpcInStdio } from '../../shadow/stdio-ipc.mjs'

import type { SpawnOptions, SpawnResult, SpawnExtra } from '@socketsecurity/lib/spawn'

/**
 * Options for spawnNode, extending SpawnOptions with IPC handshake data.
 */
export interface SpawnNodeOptions extends SpawnOptions {
  /**
   * Additional IPC handshake data to send to subprocess.
   *
   * This is merged with bootstrap indicators (subprocess: true, parent_pid)
   * to create the full IPC handshake message.
   *
   * Use this to pass custom configuration to the subprocess:
   * - Shadow npm/pnpm/yarn settings (API token, bin name, etc.)
   * - Custom application data
   *
   * Only used when spawning SEA binary as subprocess.
   */
  ipc?: Record<string, unknown>
}

/**
 * Spawn Node.js with automatic SEA bootstrap handling.
 *
 * Behavior:
 * - Not a SEA: Uses process.execPath directly
 * - SEA with system Node.js: Uses system Node.js
 * - SEA without system Node.js: Spawns self with IPC handshake
 *
 * @param args - Arguments to pass to Node.js (script path + args)
 * @param options - Spawn options, including optional IPC data
 * @param extra - Extra spawn options (from @socketsecurity/lib/spawn)
 * @returns Spawn result with process handle
 */
export function spawnNode(
  args: string[] | readonly string[],
  options?: SpawnNodeOptions,
  extra?: SpawnExtra,
): SpawnResult {
  const { ipc, ...spawnOpts } = options ?? {}

  // Get the Node.js executable path to use.
  const nodePath = getNodeExecutablePath()

  // Determine if we need to set up IPC handshake.
  const needsIpcHandshake = isSeaBinary() && nodePath === process.execPath

  // If we need IPC handshake, ensure stdio includes 'ipc'.
  const finalOptions = needsIpcHandshake
    ? {
        ...spawnOpts,
        stdio: ensureIpcInStdio(spawnOpts.stdio),
      }
    : spawnOpts

  // Spawn the Node.js process.
  const spawnResult = spawn(nodePath, args, finalOptions, extra)

  // If we're spawning ourselves as a SEA subprocess, send IPC handshake.
  if (needsIpcHandshake) {
    // Build IPC handshake with bootstrap indicators + custom data.
    const handshakeData = {
      // Bootstrap indicators - always included for subprocess detection.
      subprocess: true,
      parent_pid: process.pid,
      // Custom IPC data (shadow config, application data, etc.).
      ...(ipc ?? {}),
    }
    sendBootstrapHandshake(spawnResult.process, handshakeData)
  }

  return spawnResult
}

/**
 * Get the Node.js executable path to use for spawning.
 *
 * Priority:
 * 1. System Node.js (if we're a SEA and system Node.js exists)
 * 2. Current execPath (process.execPath)
 *
 * @returns Path to Node.js executable
 */
function getNodeExecutablePath(): string {
  // If not a SEA, use standard getExecPath().
  if (!isSeaBinary()) {
    return getExecPath()
  }

  // For SEA binaries, try to find system Node.js.
  const systemNode = findSystemNodejs()
  if (systemNode) {
    return systemNode
  }

  // Fall back to SEA binary itself (will use IPC handshake).
  return process.execPath
}

/**
 * Find system Node.js binary in PATH (excluding the current SEA binary).
 *
 * Returns the path to system Node.js if found, undefined otherwise.
 *
 * @returns Path to system Node.js, or undefined
 */
function findSystemNodejs(): string | undefined {
  // TODO: Implement proper system Node.js detection.
  // This should:
  // 1. Parse PATH environment variable
  // 2. Look for 'node' or 'node.exe' executables
  // 3. Exclude the current SEA binary path (process.execPath)
  // 4. Verify it's actually Node.js (check version or --version flag)
  // 5. Ensure it's compatible (meets minimum version requirements)
  // 6. Return the first valid system Node.js found
  //
  // For now, return undefined to use SEA binary with IPC handshake.
  // This will be implemented in a follow-up PR.

  return undefined
}

/**
 * Synchronous version of spawnNode using spawnSync.
 *
 * Note: IPC handshake is not supported in synchronous mode,
 * so this should only be used when IPC is not required.
 *
 * @param args - Arguments to pass to Node.js
 * @param options - Spawn options (ipc field is ignored)
 * @returns Spawn sync result
 */
export function spawnNodeSync(
  args: string[] | readonly string[],
  options?: Omit<SpawnNodeOptions, 'ipc'>,
): ReturnType<typeof import('@socketsecurity/lib/spawn').spawnSync> {
  const { spawnSync } = require('@socketsecurity/lib/spawn')
  const nodePath = getNodeExecutablePath()
  return spawnSync(nodePath, args, options)
}
