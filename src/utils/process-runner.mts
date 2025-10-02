/** @fileoverview Unified process runner for external CLIs with output buffering. */

import { Buffer } from 'node:buffer'

import { spawn } from '@socketsecurity/registry/lib/spawn'

import { debugFn } from './debug.mts'
import { formatExternalCliError } from './error-display.mts'
import {
  logWithSpinnerCoordination,
  pauseSpinners,
  resumeSpinners,
  startSpinner,
} from './spinner.mts'

import { ensureIpcInStdio } from '../shadow/stdio-ipc.mts'

import type { IpcObject } from '../constants.mts'
import type { CResult } from '../types.mts'
import type {
  SpawnExtra,
  SpawnResult,
} from '@socketsecurity/registry/lib/spawn'

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

  debugFn('stdio', `Executing: ${command} ${args.join(' ')}`)

  if (useIpc) {
    debugFn('stdio', 'Using IPC for secure config passing')
  }

  let stopSpinner: (() => void) | undefined

  try {
    // Start spinner if requested.
    if (showSpinner) {
      stopSpinner = startSpinner(spinnerMessage)
    }

    // Handle stdio with IPC support.
    let stdio = opts.stdio || (bufferOutput ? 'pipe' : 'inherit')
    if (useIpc) {
      stdio = ensureIpcInStdio(stdio)
    }

    const spawnExtra: SpawnExtra = { stdio }

    // Run command.
    const spawnResult: SpawnResult = await spawn(command, args as string[], {
      cwd: opts.cwd,
      env: opts.env,
      ...spawnExtra,
    })

    // Send IPC data if provided and process has IPC channel.
    if (useIpc && spawnResult.process && 'send' in spawnResult.process) {
      const sendResult = (spawnResult.process as NodeJS.Process).send?.(
        opts.ipc,
      )
      if (!sendResult) {
        debugFn('warn', 'Failed to send IPC data to child process')
      }
    }

    // Stop spinner before processing output.
    if (stopSpinner) {
      stopSpinner()
      stopSpinner = undefined
    }

    const stdout = spawnResult.stdout ? spawnResult.stdout.toString() : ''
    const stderr = spawnResult.stderr ? spawnResult.stderr.toString() : ''
    const exitCode = spawnResult.code ?? 0

    debugFn('stdio', `Command completed with exit code: ${exitCode}`)

    // If buffered and has output, log it with spinner coordination.
    if (bufferOutput && stdout) {
      pauseSpinners()
      logWithSpinnerCoordination('log', stdout)
      resumeSpinners()
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
    if (stopSpinner) {
      stopSpinner()
    }

    debugFn('error', `Command failed: ${command}`, e)

    // Extract error details.
    const stderr =
      e && typeof e === 'object' && 'stderr' in e
        ? Buffer.isBuffer((e as { stderr: unknown }).stderr)
          ? (e as { stderr: Buffer }).stderr.toString()
          : String((e as { stderr: unknown }).stderr)
        : undefined

    const exitCode =
      e && typeof e === 'object' && 'code' in e
        ? Number((e as { code: unknown }).code)
        : 1

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
