/**
 * @file Utility for running shell commands with proper error handling.
 */

import process from 'node:process'

import { WIN32 } from '@socketsecurity/lib-stable/constants/platform'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import type { SpawnOptions } from '@socketsecurity/lib-stable/process/spawn/types'
import {
  spawn,
  spawnSync,
} from '@socketsecurity/lib-stable/process/spawn/child'

const logger = getDefaultLogger()

/**
 * Run a command and return a promise that resolves with the exit code.
 */
export async function runCommand(
  command: string,
  args: string[] = [],
  options: SpawnOptions = {},
): Promise<number> {
  // Clear any in-flight spinner/progress row so the child's first write
  // doesn't butt into it. Children inherit our stdio and have no idea
  // we left the cursor mid-line.
  logger.clearLine()
  try {
    const result = await spawn(command, args, {
      stdio: 'inherit',
      shell: WIN32,
      ...options,
    })
    // @socketsecurity/lib-stable/spawn reports null on signal termination.
    return result.code ?? 1
  } catch (e) {
    if (e && typeof e === 'object' && 'code' in e) {
      const code = (e as { code: unknown }).code
      return typeof code === 'number' ? code : 1
    }
    throw e
  }
}

/**
 * Run a command synchronously.
 */
export function runCommandSync(
  command: string,
  args: string[] = [],
  options: SpawnOptions = {},
): number {
  // Clear any in-flight spinner/progress row — see runCommand() comment.
  logger.clearLine()
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: WIN32,
    ...options,
  })

  // When killed by signal, status is null — treat as failure.
  if (result.signal) {
    return 1
  }
  return result.status ?? 1
}

/**
 * Run a pnpm script.
 */
export async function runPnpmScript(
  scriptName: string,
  extraArgs: string[] = [],
  options: SpawnOptions = {},
): Promise<number> {
  return runCommand('pnpm', ['run', scriptName, ...extraArgs], options)
}

export interface CommandSpec {
  args?: string[] | undefined
  command: string
  options?: SpawnOptions | undefined
}

/**
 * Run multiple commands in sequence, stopping on first failure.
 */
export async function runSequence(commands: CommandSpec[]): Promise<number> {
  // oxlint-disable-next-line socket/prefer-cached-for-loop -- destructured command-list record; the cached-length rewrite would lose the destructuring shape.
  for (const { args = [], command, options = {} } of commands) {
    // eslint-disable-next-line no-await-in-loop
    const exitCode = await runCommand(command, args, options)
    if (exitCode !== 0) {
      return exitCode
    }
  }
  return 0
}

/**
 * Wait for stdio handles to finish flushing. When spawning multiple processes
 * with stdio: 'inherit', child processes can exit while leaving stdio handles
 * with pending write callbacks; polling for drain prevents intermittent hangs.
 */
export async function waitForStdioFlush(
  timeoutMs: number = 1000,
): Promise<void> {
  const startTime = Date.now()

  while (Date.now() - startTime < timeoutMs) {
    const handles = (
      process as unknown as {
        _getActiveHandles(): Array<{
          _isStdio?: boolean | undefined
          _writableState?: { pendingcb: number } | undefined
          constructor?: { name?: string | undefined } | undefined
        }>
      }
    )._getActiveHandles()

    const hasStdioWithPendingWrites = handles.some(handle => {
      if (handle?.constructor?.name === 'Socket' && handle._isStdio) {
        const writableState = handle._writableState
        return writableState && writableState.pendingcb > 0
      }
      return false
    })

    if (!hasStdioWithPendingWrites) {
      return
    }

    // eslint-disable-next-line no-await-in-loop
    await new Promise(resolve => {
      setTimeout(resolve, 10)
    })
  }
}

/**
 * Run multiple commands in parallel.
 */
export async function runParallel(commands: CommandSpec[]): Promise<number[]> {
  const promises = commands.map(({ args = [], command, options = {} }) =>
    runCommand(command, args, options),
  )
  const results = await Promise.allSettled(promises)

  await waitForStdioFlush()

  return results.map(r => (r.status === 'fulfilled' ? r.value : 1))
}

export interface QuietCommandResult {
  exitCode: number
  stderr: string
  stdout: string
}

/**
 * Run a command and capture output.
 */
export async function runCommandQuiet(
  command: string,
  args: string[] = [],
  options: SpawnOptions = {},
): Promise<QuietCommandResult> {
  try {
    const result = await spawn(command, args, {
      ...options,
      shell: WIN32,
      stdio: 'pipe',
      stdioString: true,
    })

    return {
      // @socketsecurity/lib-stable/spawn reports null on signal termination.
      exitCode: result.code ?? 1,
      stderr: result.stderr as string,
      stdout: result.stdout as string,
    }
  } catch (e) {
    if (
      e &&
      typeof e === 'object' &&
      'code' in e &&
      'stdout' in e &&
      'stderr' in e
    ) {
      const spawnErr = e as {
        code: number | null
        stderr: string
        stdout: string
      }
      return {
        exitCode: spawnErr.code ?? 1,
        stderr: spawnErr.stderr,
        stdout: spawnErr.stdout,
      }
    }
    throw e
  }
}

/**
 * Run a command and throw on non-zero exit code.
 *
 * @throws {Error} When the command exits with a non-zero code.
 */
export async function runCommandStrict(
  command: string,
  args: string[] = [],
  options: SpawnOptions = {},
): Promise<void> {
  const exitCode = await runCommand(command, args, options)
  if (exitCode !== 0) {
    const error: Error & { code?: number | undefined } = new Error(
      `Command failed: ${command} ${args.join(' ')}`,
    )
    error.code = exitCode
    throw error
  }
}

/**
 * Run a command quietly and throw on non-zero exit code.
 *
 * @throws {Error} When the command exits with a non-zero code.
 */
export async function runCommandQuietStrict(
  command: string,
  args: string[] = [],
  options: SpawnOptions = {},
): Promise<{ stderr: string; stdout: string }> {
  const { exitCode, stderr, stdout } = await runCommandQuiet(
    command,
    args,
    options,
  )
  if (exitCode !== 0) {
    const error: Error & {
      code?: number | undefined
      stderr?: string | undefined
      stdout?: string | undefined
    } = new Error(`Command failed: ${command} ${args.join(' ')}`)
    error.code = exitCode
    error.stdout = stdout
    error.stderr = stderr
    throw error
  }
  return { stderr, stdout }
}

/**
 * Log and run a command.
 */
export async function logAndRun(
  description: string,
  command: string,
  args: string[] = [],
  options: SpawnOptions = {},
): Promise<number> {
  logger.log(description)
  return runCommand(command, args, options)
}
