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

import { whichRealSync } from '@socketsecurity/lib/bin'
import { getExecPath } from '@socketsecurity/lib/constants/node'
import { spawn, spawnSync } from '@socketsecurity/lib/spawn'

import { ensureIpcInStdio } from '../../shadow/stdio-ipc.mjs'
import { sendBootstrapHandshake } from '../sea/boot.mjs'
import { isSeaBinary } from '../sea/detect.mjs'

import type {
  SpawnOptions,
  SpawnResult,
  SpawnExtra,
} from '@socketsecurity/lib/spawn'

/**
 * Options for spawnNode, extending SpawnOptions with IPC handshake data.
 */
export interface SpawnNodeOptions extends SpawnOptions {
  /**
   * Additional IPC handshake data to send to subprocess.
   *
   * This is placed in the `extra` field of the handshake message to avoid
   * collision with standard fields (subprocess, parent_pid).
   *
   * Final handshake structure:
   * {
   *   subprocess: true,
   *   parent_pid: <pid>,
   *   extra: { ...ipc }  // Custom data goes here
   * }
   *
   * Use this to pass custom configuration to the subprocess:
   * - Shadow npm/pnpm/yarn settings (API token, bin name, etc.)
   * - Custom application data
   *
   * System Node.js will ignore the handshake message.
   * SEA subprocess will use it to skip bootstrap.
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
  options?: SpawnNodeOptions | undefined,
  extra?: SpawnExtra | undefined,
): SpawnResult {
  const { ipc, ...spawnOpts } = { __proto__: null, ...options } as SpawnNodeOptions

  // Get the Node.js executable path to use.
  const nodePath = getNodeExecutablePathSync()

  // Spawn the Node.js process.
  const spawnResult = spawn(
    nodePath, 
    args, 
    {
      ...spawnOpts as SpawnOptions,
      // Always ensure stdio includes 'ipc' for handshake.
      // System Node.js will ignore the handshake message.
      // SEA subprocess will use it to skip bootstrap.
      stdio: ensureIpcInStdio((spawnOpts as SpawnOptions).stdio),
    }, 
    extra
  )

  sendBootstrapHandshake(
    spawnResult.process, 
    // Always send IPC handshake with bootstrap indicators + custom data.
    {
      subprocess: true,
      parent_pid: process.pid,
      // Custom IPC data in extra field to avoid collision with standard fields.
      ...(ipc ? { extra: { ...ipc } } : {}),
    }
  )

  return spawnResult
}

/**
 * Find system Node.js binary in PATH (excluding the current SEA binary).
 *
 * Returns the path to system Node.js if found, undefined otherwise.
 *
 * @returns Path to system Node.js, or undefined
 */
export function findSystemNodejsSync(): string | undefined {
  // Use which to find 'node' in PATH (returns all matches).
  const nodePath = whichRealSync('node', { all: true, nothrow: true })

  if (!nodePath) {
    return undefined
  }

  // which with all:true returns string[] if multiple matches, string if single match.
  const nodePaths = Array.isArray(nodePath) ? nodePath : [nodePath]

  // Find first Node.js that isn't our SEA binary.
  const currentExecPath = process.execPath
  const systemNode = nodePaths.find(p => p !== currentExecPath)

  return systemNode
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
export function getNodeExecutablePathSync(): string {
  // If not a SEA, use standard getExecPath().
  if (!isSeaBinary()) {
    return getExecPath()
  }

  // For SEA binaries, try to find system Node.js.
  const systemNode = findSystemNodejsSync()
  if (systemNode) {
    return systemNode
  }

  // Fall back to SEA binary itself (will use IPC handshake).
  return process.execPath
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
  const nodePath = getNodeExecutablePathSync()
  return spawnSync(nodePath, args, options)
}
