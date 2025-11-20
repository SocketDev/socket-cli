/** @fileoverview Unified process runner for external CLIs with output buffering. */

import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'
import { Spinner as createSpinner } from '@socketsecurity/lib/spinner'

import { ensureIpcInStdio } from '../../shadow/stdio-ipc.mjs'
import { debugNs } from '../debug.mts'
import { formatExternalCliError } from '../error/display.mts'
import {
  trackSubprocessComplete,
  trackSubprocessError,
  trackSubprocessStart,
} from '../telemetry/integration.mts'

import type { IpcObject } from '../../constants/shadow.mts'
import type { CResult } from '../../types.mjs'
import type {
  SpawnExtra,
  SpawnResult,
  SpawnStdioResult,
} from '@socketsecurity/lib/spawn'
import type { Spinner } from '@socketsecurity/lib/spinner'

export type ProcessRunnerOptions = {
  bufferOutput?: boolean | undefined
  cwd?: string | undefined
  env?: NodeJS.ProcessEnv | undefined
  ipc?: IpcObject | undefined
  showSpinner?: boolean | undefined
  spinnerMessage?: string | undefined
  stdio?: 'inherit' | 'pipe' | undefined
}

export type ProcessRunnerResult = {
  exitCode: number | null
  stderr: string
  stdout: string
}

/**
 * Run external command with unified error handling and output management.
 * Provides output buffering, spinner coordination, normalized error formatting,
 * and optional IPC for secure config passing.
 */
export async function runExternalCommand(
  command: string,
  args: string[] | readonly string[],
  options?: ProcessRunnerOptions | undefined,
): Promise<CResult<ProcessRunnerResult>> {
  const opts = { __proto__: null, ...options } as ProcessRunnerOptions
  const bufferOutput = opts.bufferOutput ?? opts.stdio === 'pipe'
  const showSpinner = opts.showSpinner ?? bufferOutput
  const spinnerMessage = opts.spinnerMessage || `Running ${command}...`
  const useIpc = opts.ipc !== undefined

  debugNs('stdio', `Executing: ${command} ${args.join(' ')}`)

  if (useIpc) {
    debugNs('stdio', 'Using IPC for secure config passing')
  }

  let spinner: Spinner | undefined

  // Track subprocess start for telemetry.
  const subprocessStartTime = await trackSubprocessStart(command)

  try {
    // Start spinner if requested.
    if (showSpinner) {
      spinner = createSpinner()
      spinner.start(spinnerMessage)
    }

    // Handle stdio with IPC support.
    let stdio: 'inherit' | 'pipe' | unknown =
      opts.stdio || (bufferOutput ? 'pipe' : 'inherit')
    if (useIpc) {
      stdio = ensureIpcInStdio(stdio as 'inherit' | 'pipe')
    }

    const spawnExtra: SpawnExtra = { stdio }

    // Run command.
    const spawnPromise: SpawnResult = spawn(command, args as string[], {
      cwd: opts.cwd,
      env: opts.env,
      ...spawnExtra,
    })

    const spawnResult: SpawnStdioResult = await spawnPromise

    // Send IPC data if provided and process has IPC channel.
    if (useIpc && spawnPromise.process && 'send' in spawnPromise.process) {
      const sendResult = (
        spawnPromise.process as unknown as NodeJS.Process
      ).send?.(opts.ipc)
      if (!sendResult) {
        debugNs('warn', 'Failed to send IPC data to child process')
      }
    }

    // Stop spinner before processing output.
    if (spinner) {
      spinner.stop()
      spinner = undefined
    }

    const stdout = spawnResult.stdout?.toString() ?? ''
    const stderr = spawnResult.stderr?.toString() ?? ''
    const exitCode = spawnResult.code ?? 0

    debugNs('stdio', `Command completed with exit code: ${exitCode}`)

    // Track subprocess completion or error based on exit code.
    if (exitCode !== 0) {
      // Non-zero exit code is an error.
      const error = new Error(
        `Command failed with exit code ${exitCode}: ${command} ${args.join(' ')}`,
      )
      await trackSubprocessError(
        command,
        subprocessStartTime,
        error,
        exitCode,
        {
          stderr_length: stderr.length,
          stdout_length: stdout.length,
        },
      )
    } else {
      // Zero exit code is success.
      await trackSubprocessComplete(command, subprocessStartTime, exitCode, {
        stderr_length: stderr.length,
        stdout_length: stdout.length,
      })
    }

    // If buffered and has output, log it.
    if (bufferOutput && stdout) {
      const logger = getDefaultLogger()
      logger.log(stdout)
    }

    return {
      ok: true,
      data: {
        exitCode,
        stderr,
        stdout,
      },
    }
  } catch (e) {
    // Stop spinner on error.
    if (spinner) {
      spinner.stop()
    }

    debugNs('error', `Command failed: ${command}`, e)

    // Extract error details.
    const exitCode =
      e && typeof e === 'object' && 'code' in e
        ? Number((e as { code: unknown }).code)
        : 1

    // Track subprocess error for telemetry.
    await trackSubprocessError(command, subprocessStartTime, e, exitCode)

    const errorMessage = formatExternalCliError(command, e, {
      verbose: false,
    })

    return {
      ok: false,
      code: exitCode,
      data: e,
      message: errorMessage,
    }
  }
}

/**
 * Run external command and return only stdout.
 * Convenience wrapper for commands that primarily output to stdout.
 */
export async function runExternalCommandForOutput(
  command: string,
  args: string[] | readonly string[],
  options?: ProcessRunnerOptions | undefined,
): Promise<CResult<string>> {
  const result = await runExternalCommand(command, args, {
    ...options,
    bufferOutput: true,
    stdio: 'pipe',
  })

  if (!result.ok) {
    return {
      ok: false,
      code: result.code,
      data: result.data,
      message: result.message,
    }
  }

  return {
    ok: true,
    data: result.data.stdout,
  }
}

/**
 * Run external command in streaming mode.
 * Output streams directly to terminal without buffering.
 */
export async function runExternalCommandStreaming(
  command: string,
  args: string[] | readonly string[],
  options?: ProcessRunnerOptions | undefined,
): Promise<CResult<ProcessRunnerResult>> {
  return await runExternalCommand(command, args, {
    ...options,
    bufferOutput: false,
    showSpinner: false,
    stdio: 'inherit',
  })
}
