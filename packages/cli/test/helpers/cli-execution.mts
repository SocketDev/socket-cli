/**
 * @file CLI execution test helpers for Socket CLI. Provides high-level
 *   utilities for executing CLI commands with comprehensive output validation
 *   and assertion capabilities.
 */

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { safeDelete } from '@socketsecurity/lib/fs'

import { constants } from '../../src/constants.mts'
import { spawnSocketCli } from '../utils.mts'

import type { SpawnOptions } from '@socketsecurity/lib/spawn'

/**
 * Result from CLI execution with enhanced utilities.
 */
export interface CliExecutionResult {
  /**
   * Exit code from the CLI command.
   */
  code: number
  /**
   * Whether the command succeeded (code === 0)
   */
  status: boolean
  /**
   * Cleaned stdout output.
   */
  stdout: string
  /**
   * Cleaned stderr output.
   */
  stderr: string
  /**
   * Combined stdout and stderr.
   */
  output: string
  /**
   * Error details if command failed.
   */
  error?:
    | {
        message: string
        stack: string
      }
    | undefined
}

/**
 * Options for CLI execution.
 */
export interface CliExecutionOptions extends SpawnOptions {
  /**
   * Whether to automatically add --config {} to isolate from user config
   * (default: true)
   */
  isolateConfig?: boolean | undefined
  /**
   * Custom config object to pass with --config flag.
   */
  config?: Record<string, unknown> | undefined
  /**
   * Expect the command to fail with specific exit code.
   */
  expectedExitCode?: number | undefined
  /**
   * Timeout in milliseconds (default: 30000)
   */
  timeout?: number | undefined
}

/**
 * Batch execute multiple CLI commands in sequence.
 *
 * @example
 *   ```typescript
 *   const results = await executeBatchCliCommands([
 *     ['config', 'get', 'apiToken'],
 *     ['config', 'get', 'defaultOrg'],
 *   ])
 *   ```
 *
 * @param commands - Array of command argument arrays.
 * @param options - Execution options applied to all commands.
 *
 * @returns Array of CLI execution results
 */
export async function executeBatchCliCommands(
  commands: string[][],
  options?: CliExecutionOptions | undefined,
): Promise<CliExecutionResult[]> {
  const results: CliExecutionResult[] = []

  for (let i = 0, { length } = commands; i < length; i += 1) {
    const args = commands[i]!
    // eslint-disable-next-line no-await-in-loop
    const result = await executeCliCommand(args, options)
    results.push(result)
  }

  return results
}

/**
 * Execute Socket CLI command with enhanced result handling.
 *
 * @example
 *   ```typescript
 *   const result = await executeCliCommand(['scan', '--json'], {
 *     isolateConfig: true,
 *   })
 *   expect(result.status).toBe(true)
 *   expect(result.stdout).toContain('scan-id')
 *   ```
 *
 * @param args - Command arguments to pass to Socket CLI.
 * @param options - Execution options.
 *
 * @returns Enhanced CLI execution result
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

  const binCliPath = constants.getBinCliPath()
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
    ...(result.error && { error: result.error }),
    output: `${result.stdout}\n${result.stderr}`.trim(),
    status: result.status,
    stderr: result.stderr,
    stdout: result.stdout,
  }
}

/**
 * Execute Socket CLI command and parse JSON output.
 *
 * @example
 *   ```typescript
 *   const { data, result } = await executeCliJson(['scan', 'create'])
 *   expect(data.id).toBeDefined()
 *   ```
 *
 * @param args - Command arguments (--json flag added automatically)
 * @param options - Execution options.
 *
 * @returns Parsed JSON data and execution result
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
  } catch (e) {
    throw new Error(
      `Failed to parse JSON from CLI output\nCommand: ${args.join(' ')}\nstdout: ${result.stdout}\nError: ${e instanceof Error ? e.message : String(e)}`,
    )
  }
}

/**
 * Execute Socket CLI command with multiple retry attempts. Useful for commands
 * that may have transient failures.
 *
 * @example
 *   ```typescript
 *   const result = await executeCliWithRetry(['scan', 'create'], 3, 2000)
 *   ```
 *
 * @param args - Command arguments.
 * @param maxRetries - Maximum number of retry attempts (default: 3)
 * @param retryDelay - Delay between retries in ms (default: 1000)
 * @param options - Execution options.
 *
 * @returns CLI execution result
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
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e))

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
 * Execute CLI command and capture timing information.
 *
 * @example
 *   ```typescript
 *   const { result, duration } = await executeCli WithTiming(['scan', 'create'])
 *   expect(duration).toBeLessThan(5000)
 *   ```
 *
 * @param args - Command arguments.
 * @param options - Execution options.
 *
 * @returns Execution result with timing information
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

/**
 * Execute Socket CLI command expecting failure (non-zero exit code).
 *
 * @example
 *   ```typescript
 *   const result = await expectCliError(['scan'], 1)
 *   expect(result.stderr).toContain('error')
 *   ```
 *
 * @param args - Command arguments.
 * @param expectedCode - Expected exit code (default: any non-zero)
 * @param options - Execution options.
 *
 * @returns CLI execution result
 *
 * @throws Error if command succeeds
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
 * Execute Socket CLI command expecting success (exit code 0).
 *
 * @example
 *   ```typescript
 *   const result = await expectCliSuccess(['wrapper', '--help'])
 *   expect(result.stdout).toContain('Usage')
 *   ```
 *
 * @param args - Command arguments.
 * @param options - Execution options.
 *
 * @returns CLI execution result
 *
 * @throws Error if command fails
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
 * Shape of the Socket CLI's `--json` response contract. Mirrors the
 * `validate_json` shell helper that was in `test/smoke.sh` so e2e tests can
 * assert the contract programmatically.
 *
 * The contract:
 * - `ok: true` payloads MUST include a non-null `data` field. `message` is
 *   optional, `cause`/`code` are absent.
 * - `ok: false` payloads MUST include a non-empty `message` string. `data` is
 *   optional; `cause`/`code` are optional but, when `code` is present, it
 *   must be a number.
 */
export interface SocketJsonOk<T = unknown> {
  ok: true
  data: T
  message?: string
}
export interface SocketJsonErr {
  ok: false
  data?: unknown
  message: string
  cause?: string
  code?: number
}
export type SocketJsonContract<T = unknown> = SocketJsonOk<T> | SocketJsonErr

/**
 * Validate that `stdout` is JSON matching the Socket CLI's `--json` contract,
 * given the `expectedExitCode` the command actually returned. Returns the
 * parsed payload on success; throws with a diagnostic message on contract
 * violation.
 *
 * The contract being asserted is the same one `test/smoke.sh::validate_json`
 * enforced before being ported to TypeScript.
 *
 * @example
 *   const result = await executeCliCommand(['scan', 'list', '--json'])
 *   const payload = validateSocketJsonContract(result.stdout, 0)
 *   expect(payload.ok).toBe(true)
 */
export function validateSocketJsonContract<T = unknown>(
  stdout: string,
  expectedExitCode: number,
): SocketJsonContract<T> {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout) as unknown
  } catch (e) {
    throw new Error(
      `Socket JSON contract violation: command output is not valid JSON (${(e as Error).message}); stdout may contain progress text mixed with the payload.\nstdout: ${stdout}`,
    )
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`Socket JSON contract violation: payload is not an object.\nstdout: ${stdout}`)
  }
  const obj = parsed as Record<string, unknown>
  const ok = obj['ok']
  if (typeof ok !== 'boolean') {
    throw new Error(`Socket JSON contract violation: "ok" must be a boolean (got ${typeof ok}).\nstdout: ${stdout}`)
  }
  if (expectedExitCode === 0 && ok !== true) {
    throw new Error(`Socket JSON contract violation: exit code 0 but "ok" is ${ok} (expected true).\nstdout: ${stdout}`)
  }
  if (expectedExitCode !== 0 && ok !== false) {
    throw new Error(`Socket JSON contract violation: exit code ${expectedExitCode} but "ok" is ${ok} (expected false).\nstdout: ${stdout}`)
  }
  if (ok === true && (obj['data'] === undefined || obj['data'] === null)) {
    throw new Error(`Socket JSON contract violation: ok:true must include a non-null "data" field (return an empty object/array if no payload).\nstdout: ${stdout}`)
  }
  if (ok === false) {
    const message = obj['message']
    if (typeof message !== 'string' || message.length === 0) {
      throw new Error(`Socket JSON contract violation: ok:false must include a non-empty "message" string.\nstdout: ${stdout}`)
    }
  }
  if (obj['code'] !== undefined && typeof obj['code'] !== 'number') {
    throw new Error(`Socket JSON contract violation: "code" must be a number when present (got ${typeof obj['code']}).\nstdout: ${stdout}`)
  }
  return obj as SocketJsonContract<T>
}

/**
 * Options for {@link executeCliInScratch}.
 */
export interface CliInScratchOptions extends CliExecutionOptions {
  /**
   * Files to seed into the scratch cwd before running. Keyed by relative path;
   * each value is the file body written verbatim. Use for fixtures the
   * command-under-test needs to read.
   */
  seedFiles?: Record<string, string> | undefined
}

/**
 * Execute Socket CLI inside a fully isolated scratch directory. Pins
 * **everything** the CLI or its spawned subprocesses might read or write
 * outside of cwd into the scratch tree, so an e2e run never touches the
 * developer's system:
 *
 * - `cwd` → fresh `os.tmpdir()/socket-e2e-<n>/`
 * - `HOME` / `USERPROFILE` → fresh `os.tmpdir()/socket-e2e-home-<n>/`
 * - `XDG_CONFIG_HOME` → `<scratchHome>/.config`
 * - `XDG_CACHE_HOME` → `<scratchHome>/.cache`
 * - `XDG_DATA_HOME` → `<scratchHome>/.local/share`
 * - `XDG_STATE_HOME` → `<scratchHome>/.local/state`
 * - `NPM_CONFIG_CACHE` / `npm_config_cache` → `<scratchHome>/.npm`
 * - `NPM_CONFIG_PREFIX` / `npm_config_prefix` → `<scratchHome>/.npm-global`
 * - `NPM_CONFIG_USERCONFIG` / `npm_config_userconfig` → `<scratchHome>/.npmrc`
 * - `PNPM_HOME` → `<scratchHome>/.pnpm`
 * - `YARN_CACHE_FOLDER` → `<scratchHome>/.yarn-cache`
 * - `PIP_CACHE_DIR` → `<scratchHome>/.pip-cache`
 * - `CARGO_HOME` → `<scratchHome>/.cargo`
 * - `GRADLE_USER_HOME` → `<scratchHome>/.gradle`
 *
 * Anything not pinned by the helper (the developer's `SOCKET_API_KEY` env,
 * the real OS keychain for credentials) is **read-only** from the CLI's
 * perspective — the CLI may read the token but the scratch HOME ensures
 * it can't persist a new one back into the dev's config.
 *
 * Cleans up the scratch trees via `safeDelete()` even on failure.
 *
 * @example
 *   const result = await executeCliInScratch(['scan', 'create', '.'], {
 *     seedFiles: { 'package.json': '{"name":"test","version":"0.0.0"}' },
 *   })
 *   expect(result.code).toBe(0)
 */
export async function executeCliInScratch(
  args: string[],
  options?: CliInScratchOptions | undefined,
): Promise<CliExecutionResult> {
  const { seedFiles, env: callerEnv, cwd: callerCwd, ...rest } = {
    __proto__: null,
    ...options,
  } as CliInScratchOptions

  const scratchCwd = mkdtempSync(path.join(tmpdir(), 'socket-e2e-'))
  const scratchHome = mkdtempSync(path.join(tmpdir(), 'socket-e2e-home-'))
  try {
    if (seedFiles) {
      const { writeFileSync, mkdirSync } = await import('node:fs')
      for (const [relPath, body] of Object.entries(seedFiles)) {
        const full = path.join(scratchCwd, relPath)
        mkdirSync(path.dirname(full), { recursive: true })
        writeFileSync(full, body)
      }
    }
    return await executeCliCommand(args, {
      ...rest,
      cwd: callerCwd ?? scratchCwd,
      env: {
        ...process.env,
        // Home dir pins.
        HOME: scratchHome,
        USERPROFILE: scratchHome,
        // XDG base-directory spec.
        XDG_CONFIG_HOME: path.join(scratchHome, '.config'),
        XDG_CACHE_HOME: path.join(scratchHome, '.cache'),
        XDG_DATA_HOME: path.join(scratchHome, '.local', 'share'),
        XDG_STATE_HOME: path.join(scratchHome, '.local', 'state'),
        // npm / npx pins. Both the lowercase `npm_config_*` and uppercase
        // `NPM_CONFIG_*` forms are honored by npm; set both so neither
        // wins from process.env spillover.
        npm_config_cache: path.join(scratchHome, '.npm'),
        NPM_CONFIG_CACHE: path.join(scratchHome, '.npm'),
        npm_config_prefix: path.join(scratchHome, '.npm-global'),
        NPM_CONFIG_PREFIX: path.join(scratchHome, '.npm-global'),
        npm_config_userconfig: path.join(scratchHome, '.npmrc'),
        NPM_CONFIG_USERCONFIG: path.join(scratchHome, '.npmrc'),
        // Sibling package managers.
        PNPM_HOME: path.join(scratchHome, '.pnpm'),
        YARN_CACHE_FOLDER: path.join(scratchHome, '.yarn-cache'),
        // Non-JS toolchains the manifest generators may invoke.
        PIP_CACHE_DIR: path.join(scratchHome, '.pip-cache'),
        CARGO_HOME: path.join(scratchHome, '.cargo'),
        GRADLE_USER_HOME: path.join(scratchHome, '.gradle'),
        // Caller-supplied env wins.
        ...callerEnv,
      },
    })
  } finally {
    await safeDelete(scratchCwd)
    await safeDelete(scratchHome)
  }
}
