/** @fileoverview CLI execution test helpers for Socket CLI. Provides high-level utilities for executing CLI commands with comprehensive output validation and assertion capabilities. */

import constants from '../../src/constants.mts'
import { spawnSocketCli } from '../utils.mts'

import type { SpawnOptions } from '@socketsecurity/registry/lib/spawn'

/**
 * Result from CLI execution with enhanced utilities
 */
export interface CliExecutionResult {
  /** Exit code from the CLI command */
  code: number
  /** Whether the command succeeded (code === 0) */
  status: boolean
  /** Cleaned stdout output */
  stdout: string
  /** Cleaned stderr output */
  stderr: string
  /** Combined stdout and stderr */
  output: string
  /** Error details if command failed */
  error?: {
    message: string
    stack: string
  }
}

/**
 * Options for CLI execution
 */
export interface CliExecutionOptions extends SpawnOptions {
  /** Whether to automatically add --config {} to isolate from user config (default: true) */
  isolateConfig?: boolean | undefined
  /** Custom config object to pass with --config flag */
  config?: Record<string, unknown> | undefined
  /** Expect the command to fail with specific exit code */
  expectedExitCode?: number | undefined
  /** Timeout in milliseconds (default: 30000) */
  timeout?: number | undefined
}

/**
 * Execute Socket CLI command with enhanced result handling.
 *
 * @param args - Command arguments to pass to Socket CLI
 * @param options - Execution options
 * @returns Enhanced CLI execution result
 *
 * @example
 * ```typescript
 * const result = await executeCliCommand(['scan', '--json'], { isolateConfig: true })
 * expect(result.status).toBe(true)
 * expect(result.stdout).toContain('scan-id')
 * ```
 */
export async function executeCliCommand(
  args: string[],
  options?: CliExecutionOptions | undefined,
): Promise<CliExecutionResult> {
  const {
    config,
    expectedExitCode,
    isolateConfig = true,
    timeout = 30_000,
    ...spawnOptions
  } = {
    __proto__: null,
    ...options,
  } as CliExecutionOptions

  const { binCliPath } = constants
  const finalArgs = [...args]

  // Add config isolation if requested
  if (isolateConfig && !args.includes('--config')) {
    if (config) {
      finalArgs.push('--config', JSON.stringify(config))
    } else {
      finalArgs.push('--config', '{}')
    }
  }

  const result = await spawnSocketCli(binCliPath, finalArgs, {
    timeout,
    ...spawnOptions,
  })

  // Check expected exit code if provided
  if (expectedExitCode !== undefined && result.code !== expectedExitCode) {
    throw new Error(
      `Expected exit code ${expectedExitCode} but got ${result.code}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    )
  }

  return {
    code: result.code,
    error: result.error,
    output: `${result.stdout}\n${result.stderr}`.trim(),
    status: result.status,
    stderr: result.stderr,
    stdout: result.stdout,
  }
}

/**
 * Execute Socket CLI command expecting success (exit code 0).
 *
 * @param args - Command arguments
 * @param options - Execution options
 * @returns CLI execution result
 * @throws Error if command fails
 *
 * @example
 * ```typescript
 * const result = await expectCliSuccess(['wrapper', '--help'])
 * expect(result.stdout).toContain('Usage')
 * ```
 */
export async function expectCliSuccess(
  args: string[],
  options?: CliExecutionOptions | undefined,
): Promise<CliExecutionResult> {
  const result = await executeCliCommand(args, {
    expectedExitCode: 0,
    ...options,
  })

  if (!result.status) {
    throw new Error(
      `Expected CLI command to succeed but got exit code ${result.code}\nCommand: ${args.join(' ')}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    )
  }

  return result
}

/**
 * Execute Socket CLI command expecting failure (non-zero exit code).
 *
 * @param args - Command arguments
 * @param expectedCode - Expected exit code (default: any non-zero)
 * @param options - Execution options
 * @returns CLI execution result
 * @throws Error if command succeeds
 *
 * @example
 * ```typescript
 * const result = await expectCliError(['scan'], 1)
 * expect(result.stderr).toContain('error')
 * ```
 */
export async function expectCliError(
  args: string[],
  expectedCode?: number | undefined,
  options?: CliExecutionOptions | undefined,
): Promise<CliExecutionResult> {
  const result = await executeCliCommand(args, options)

  if (result.status) {
    throw new Error(
      `Expected CLI command to fail but it succeeded\nCommand: ${args.join(' ')}\nstdout: ${result.stdout}`,
    )
  }

  if (expectedCode !== undefined && result.code !== expectedCode) {
    throw new Error(
      `Expected exit code ${expectedCode} but got ${result.code}\nCommand: ${args.join(' ')}\nstderr: ${result.stderr}`,
    )
  }

  return result
}

/**
 * Execute Socket CLI command and parse JSON output.
 *
 * @param args - Command arguments (--json flag added automatically)
 * @param options - Execution options
 * @returns Parsed JSON data and execution result
 *
 * @example
 * ```typescript
 * const { data, result } = await executeCliJson(['scan', 'create'])
 * expect(data.id).toBeDefined()
 * ```
 */
export async function executeCliJson<T = unknown>(
  args: string[],
  options?: CliExecutionOptions | undefined,
): Promise<{ data: T; result: CliExecutionResult }> {
  const finalArgs = args.includes('--json') ? args : [...args, '--json']

  const result = await executeCliCommand(finalArgs, options)

  try {
    const data = JSON.parse(result.stdout) as T
    return { data, result }
  } catch (error) {
    throw new Error(
      `Failed to parse JSON from CLI output\nCommand: ${args.join(' ')}\nstdout: ${result.stdout}\nError: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/**
 * Execute Socket CLI command with multiple retry attempts.
 * Useful for commands that may have transient failures.
 *
 * @param args - Command arguments
 * @param maxRetries - Maximum number of retry attempts (default: 3)
 * @param retryDelay - Delay between retries in ms (default: 1000)
 * @param options - Execution options
 * @returns CLI execution result
 *
 * @example
 * ```typescript
 * const result = await executeCliWithRetry(['scan', 'create'], 3, 2000)
 * ```
 */
export async function executeCliWithRetry(
  args: string[],
  maxRetries = 3,
  retryDelay = 1000,
  options?: CliExecutionOptions | undefined,
): Promise<CliExecutionResult> {
  let lastError: Error | undefined
  let attempts = 0

  while (attempts < maxRetries) {
    attempts++
    try {
      // eslint-disable-next-line no-await-in-loop
      return await executeCliCommand(args, options)
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))

      if (attempts < maxRetries) {
        // Wait before retrying
        // eslint-disable-next-line no-await-in-loop
        await new Promise(resolve => setTimeout(resolve, retryDelay))
      }
    }
  }

  throw new Error(
    `CLI command failed after ${maxRetries} attempts\nCommand: ${args.join(' ')}\nLast error: ${lastError?.message}`,
  )
}

/**
 * Batch execute multiple CLI commands in sequence.
 *
 * @param commands - Array of command argument arrays
 * @param options - Execution options applied to all commands
 * @returns Array of CLI execution results
 *
 * @example
 * ```typescript
 * const results = await executeBatchCliCommands([
 *   ['config', 'get', 'apiToken'],
 *   ['config', 'get', 'defaultOrg'],
 * ])
 * ```
 */
export async function executeBatchCliCommands(
  commands: string[][],
  options?: CliExecutionOptions | undefined,
): Promise<CliExecutionResult[]> {
  const results: CliExecutionResult[] = []

  for (const args of commands) {
    // eslint-disable-next-line no-await-in-loop
    const result = await executeCliCommand(args, options)
    results.push(result)
  }

  return results
}

/**
 * Execute CLI command and capture timing information.
 *
 * @param args - Command arguments
 * @param options - Execution options
 * @returns Execution result with timing information
 *
 * @example
 * ```typescript
 * const { result, duration } = await executeCli WithTiming(['scan', 'create'])
 * expect(duration).toBeLessThan(5000)
 * ```
 */
export async function executeCliWithTiming(
  args: string[],
  options?: CliExecutionOptions | undefined,
): Promise<{
  result: CliExecutionResult
  duration: number
  startTime: number
  endTime: number
}> {
  const startTime = Date.now()
  const result = await executeCliCommand(args, options)
  const endTime = Date.now()
  const duration = endTime - startTime

  return {
    duration,
    endTime,
    result,
    startTime,
  }
}
