/**
 * Node.js spawn abstraction with SEA bootstrap handling.
 *
 * Provides a `spawnNode()` function that automatically handles:
 *
 * - System Node.js detection and delegation (when in SEA)
 * - Self-spawning with IPC handshake (when no system Node.js available)
 * - Regular process.execPath spawning (when not in SEA)
 *
 * This abstraction should be used anywhere we need to spawn Node.js, replacing
 * direct calls to spawn(process.execPath, ...) or spawn(getExecPath(), ...).
 *
 * A SEA binary has no interpreter of its own to lend a child JavaScript file,
 * so it looks one up on PATH — and it does that while its working directory is
 * a repository checkout the CLI did not author. That lookup goes through the
 * trusted resolver: a `node` inside the checkout is never selected, and the
 * child receives a PATH with the poisoned entries removed so its own
 * grandchildren cannot walk back into the checkout.
 *
 * Example usage:
 *
 * ```typescript
 * // Instead of:
 * spawn(getExecPath(), ['script.js', ...args], { stdio: 'inherit' })
 *
 * // Use:
 * await spawnNode(['script.js', ...args], { stdio: 'inherit' })
 * ```
 */

import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { getExecPath } from '@socketsecurity/lib-stable/constants/node'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { buildSystemToolEnv, findSystemTool } from './system-tool.mts'
import { sendBootstrapHandshake } from '../sea/boot.mjs'
import { isSeaBinary } from '../sea/detect.mjs'

import type { SystemToolOptions, SystemToolResolution } from './system-tool.mts'

import type { StdioOptions } from 'node:child_process'
import type {
  SpawnExtra,
  SpawnOptions,
  SpawnResult,
} from '@socketsecurity/lib-stable/process/spawn/types'

export type NodeExecutableResolution = {
  /**
   * Absolute path to the Node.js interpreter to spawn.
   */
  executable: string
  /**
   * PATH the child may search, with every poisoned entry already removed.
   * Undefined when the interpreter is this process's own and no PATH lookup
   * happened, so there is nothing for the resolver to sanitize.
   */
  searchPath: string | undefined
}

/**
 * Narrows a spawned process to the shape required by `sendBootstrapHandshake`
 * (i.e. `.send` is a callable, not undefined). The typeof-on-a-property guard
 * can't flow to the parent object, so we need an explicit assertion function.
 */
export function assertHasSend<T extends { send?: unknown | undefined }>(
  proc: T,
): asserts proc is T & { send: (message: unknown) => void } {
  if (typeof proc.send !== 'function') {
    throw new TypeError(
      'spawn-node: expected IPC channel on child process (send is undefined)',
    )
  }
}

/**
 * Ensures stdio configuration includes IPC channel for process communication.
 * Converts various stdio formats to include 'ipc' as the fourth element.
 */
export function ensureIpcInStdio(
  stdio: StdioOptions | undefined,
): StdioOptions {
  if (typeof stdio === 'string') {
    return [stdio, stdio, stdio, 'ipc']
  }
  if (Array.isArray(stdio)) {
    if (!stdio.includes('ipc')) {
      return stdio.concat('ipc')
    }
    return stdio.slice()
  }
  return ['pipe', 'pipe', 'pipe', 'ipc']
}

/**
 * Find a system Node.js outside the protected root, excluding the current SEA
 * binary.
 *
 * The trusted resolver returns one winner rather than a ranked list, so a
 * winner that is this process's own executable means the SEA binary is itself
 * installed as `node`; there is no system interpreter to delegate to and the
 * IPC-handshake fallback takes over.
 *
 * @returns The resolved interpreter and its sanitized search path, or undefined
 */
export async function findSystemNodejs(
  options?: SystemToolOptions | undefined,
): Promise<SystemToolResolution | undefined> {
  const resolution = await findSystemTool('node', options)
  if (!resolution || resolution.executable === process.execPath) {
    return undefined
  }
  return resolution
}

/**
 * Get the Node.js executable to use for spawning, plus the PATH its child may
 * search.
 *
 * Priority: 1. System Node.js (if we're a SEA and a trusted system Node.js
 * exists) 2. Current execPath (process.execPath)
 */
export async function resolveNodeExecutable(
  options?: SystemToolOptions | undefined,
): Promise<NodeExecutableResolution> {
  // If not a SEA, use standard getExecPath(); no PATH lookup takes place.
  if (!isSeaBinary()) {
    return { executable: getExecPath(), searchPath: undefined }
  }

  // For SEA binaries, try to find system Node.js.
  const systemNode = await findSystemNodejs(options)
  if (systemNode) {
    return systemNode
  }

  // Fall back to SEA binary itself (will use IPC handshake).
  return { executable: process.execPath, searchPath: undefined }
}

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
   * Final handshake structure: { subprocess: true, parent_pid: <pid>, extra: {
   * ...ipc } // Custom data goes here }
   *
   * Use this to pass custom configuration to the subprocess:
   *
   * - Socket Firewall settings (API token, bin name, etc.)
   * - Custom application data
   *
   * System Node.js will ignore the handshake message. SEA subprocess will use
   * it to skip bootstrap.
   */
  ipc?: Record<string, unknown> | undefined
}

/**
 * Spawn Node.js with automatic SEA bootstrap handling.
 *
 * Behavior: - Not a SEA: Uses process.execPath directly - SEA with system
 * Node.js: Uses system Node.js - SEA without system Node.js: Spawns self with
 * IPC handshake.
 *
 * @param args - Arguments to pass to Node.js (script path + args)
 * @param options - Spawn options, including optional IPC data.
 * @param extra - Extra spawn options (from @socketsecurity/lib/spawn)
 *
 * @returns Spawn result with process handle
 */
export async function spawnNode(
  args: string[] | readonly string[],
  options?: SpawnNodeOptions | undefined,
  extra?: SpawnExtra | undefined,
): Promise<SpawnResult> {
  const { ipc, ...spawnOpts } = {
    __proto__: null,
    ...options,
  } as SpawnNodeOptions

  // Get the Node.js executable to use, plus the PATH its child may search.
  // The child's own working directory is the checkout to protect, and spawn
  // accepts it as either a path or a file URL.
  const { cwd } = spawnOpts
  const { executable, searchPath } = await resolveNodeExecutable(
    cwd === undefined
      ? undefined
      : { cwd: typeof cwd === 'string' ? cwd : fileURLToPath(cwd) },
  )

  // Spawn the Node.js process.
  const spawnResult = spawn(
    executable,
    args,
    {
      ...spawnOpts,
      ...(searchPath === undefined
        ? {}
        : {
            env: buildSystemToolEnv(spawnOpts.env ?? process.env, searchPath),
          }),
      // Always ensure stdio includes 'ipc' for handshake.
      // System Node.js will ignore the handshake message.
      // SEA subprocess will use it to skip bootstrap.
      stdio: ensureIpcInStdio(spawnOpts.stdio),
    },
    extra,
  )

  // `ensureIpcInStdio` above guarantees an IPC channel in stdio, so
  // `.send` should always be a function here. Narrow explicitly via an
  // assertion function so the call site doesn't need a structural cast.
  assertHasSend(spawnResult.process)
  sendBootstrapHandshake(
    spawnResult.process,
    // Always send IPC handshake with bootstrap indicators + custom data.
    {
      subprocess: true,
      parent_pid: process.pid,
      // Custom IPC data in extra field to avoid collision with standard fields.
      ...(ipc ? { extra: { ...ipc } } : {}),
    },
  )

  return spawnResult
}
