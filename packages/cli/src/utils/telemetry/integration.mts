/**
 * Telemetry integration helpers for Socket CLI.
 * Provides utilities for tracking common CLI events and subprocess executions.
 *
 * Usage:
 * ```typescript
 * import {
 *   trackCliStart,
 *   trackCliEvent,
 *   trackCliComplete,
 *   trackCliError,
 *   trackSubprocessStart,
 *   trackSubprocessComplete,
 *   trackSubprocessError
 * } from './utils/telemetry/integration.mts'
 *
 * // Track main CLI execution.
 * const startTime = await trackCliStart(process.argv)
 * await trackCliComplete(process.argv, startTime, 0)
 *
 * // Track custom event with optional metadata.
 * await trackCliEvent('custom_event', process.argv, { key: 'value' })
 *
 * // Track subprocess/forked CLI execution.
 * const subStart = await trackSubprocessStart('npm', { cwd: '/path' })
 * await trackSubprocessComplete('npm', subStart, 0, { stdout_length: 1234 })
 *
 * // On subprocess error.
 * await trackSubprocessError('npm', subStart, error, 1)
 * ```
 */
import { homedir } from 'node:os'
import process from 'node:process'

import { debug } from '@socketsecurity/lib/debug'

import { TelemetryService } from './service.mts'
import { CONFIG_KEY_DEFAULT_ORG } from '../../constants/config.mjs'
import { getCliVersion } from '../../constants/env.mts'
import { getConfigValueOrUndef } from '../config.mts'

import type { TelemetryContext } from './types.mts'

/**
 * Flush any pending telemetry events.
 * This should be called before process.exit to ensure telemetry is sent.
 *
 * @returns Promise that resolves when flush completes.
 */
export async function finalizeTelemetry(): Promise<void> {
  const instance = TelemetryService.getCurrentInstance()
  if (instance) {
    debug('Flushing telemetry before exit')
    await instance.flush()
  }
}

/**
 * Track subprocess exit and finalize telemetry.
 * This is a convenience function that tracks completion/error based on exit code
 * and ensures telemetry is flushed before returning.
 *
 * @param command - Command name (e.g., 'npm', 'pip').
 * @param startTime - Start timestamp from trackSubprocessStart.
 * @param exitCode - Process exit code (null treated as error).
 * @returns Promise that resolves when tracking and flush complete.
 *
 * @example
 * ```typescript
 * await trackSubprocessExit(NPM, subprocessStartTime, code)
 * ```
 */
export async function trackSubprocessExit(
  command: string,
  startTime: number,
  exitCode: number | null,
): Promise<void> {
  // Track subprocess completion or error based on exit code.
  if (exitCode !== null && exitCode !== 0) {
    const error = new Error(`${command} exited with code ${exitCode}`)
    await trackSubprocessError(command, startTime, error, exitCode)
  } else if (exitCode === 0) {
    await trackSubprocessComplete(command, startTime, exitCode)
  }

  // Flush telemetry to ensure events are sent before exit.
  await finalizeTelemetry()
}

const WRAPPER_CLI = ['npm', 'yarn', 'pip']

const API_TOKEN_FLAGS = ['--api-token', '--token', '-t']

/**
 * Calculate duration from start timestamp.
 *
 * @param startTime - Start timestamp from Date.now().
 * @returns Duration in milliseconds.
 */
function calculateDuration(startTime: number): number {
  return Date.now() - startTime
}

/**
 * Normalize exit code to a number with default fallback.
 *
 * @param exitCode - Exit code (may be string, number, null, or undefined).
 * @param defaultValue - Default value if exitCode is not a number.
 * @returns Normalized exit code.
 */
function normalizeExitCode(
  exitCode: string | number | null | undefined,
  defaultValue: number,
): number {
  return typeof exitCode === 'number' ? exitCode : defaultValue
}

/**
 * Normalize error to Error object.
 *
 * @param error - Unknown error value.
 * @returns Error object.
 */
function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

/**
 * Build context for the current telemetry entry.
 *
 * The context contains the current execution context, in which all CLI invocation should have access to.
 *
 * @param argv Command line arguments.
 * @returns Telemetry context object.
 */
function buildContext(argv: string[]): TelemetryContext {
  return {
    arch: process.arch,
    argv: sanitizeArgv(argv),
    node_version: process.version,
    platform: process.platform,
    version: getCliVersion(),
  }
}

/**
 * Sanitize argv to remove sensitive information.
 * Removes API tokens, file paths with usernames, and other PII.
 * Also strips arguments after wrapper CLIs to avoid leaking package names.
 *
 * @param argv Raw command line arguments (full process.argv including execPath and script).
 * @returns Sanitized argv array.
 *
 * @example
 * // Input: ['node', 'socket', 'npm', 'install', '@my/private-package', '--token', 'sktsec_abc123']
 * // Output: ['npm', 'install']
 */
function sanitizeArgv(argv: string[]): string[] {
  // Strip the first two values to drop the execPath and script.
  const withoutPathAndScript = argv.slice(2)

  // Then strip arguments after wrapper CLIs to avoid leaking package names.
  const wrapperIndex = withoutPathAndScript.findIndex(arg =>
    WRAPPER_CLI.includes(arg),
  )
  let strippedArgv = withoutPathAndScript

  if (wrapperIndex !== -1) {
    // Keep only wrapper + first command (e.g., ['npm']).
    const endIndex = wrapperIndex + 1
    strippedArgv = withoutPathAndScript.slice(0, endIndex)
  }

  // Then sanitize remaining arguments.
  return strippedArgv.map((arg, index) => {
    // Check if previous arg was an API token flag.
    if (index > 0) {
      const prevArg = strippedArgv[index - 1]
      if (prevArg && API_TOKEN_FLAGS.includes(prevArg)) {
        return '[REDACTED]'
      }
    }

    // Redact anything that looks like a socket API token.
    if (arg.startsWith('sktsec_') || arg.match(/^[a-f0-9]{32,}$/i)) {
      return '[REDACTED]'
    }

    // Remove user home directory from file paths.
    const homeDir = homedir()
    if (homeDir) {
      return arg.replace(new RegExp(homeDir, 'g'), '~')
    }

    return arg
  })
}

/**
 * Sanitize error attribute to remove user specific paths.
 * Replaces user home directory and other sensitive paths.
 *
 * @param input Raw input.
 * @returns Sanitized input.
 */
function sanitizeErrorAttribute(input: string | undefined): string | undefined {
  if (!input) {
    return undefined
  }

  // Remove user home directory.
  const homeDir = homedir()
  if (homeDir) {
    return input.replace(new RegExp(homeDir, 'g'), '~')
  }

  return input
}

/**
 * Generic event tracking function.
 * Tracks any telemetry event with optional error details and flush.
 *
 * @param eventType Type of event to track.
 * @param context Event context.
 * @param metadata Event metadata.
 * @param options Optional configuration.
 * @returns Promise that resolves when tracking completes.
 */
export async function trackEvent(
  eventType: string,
  context: TelemetryContext,
  metadata: Record<string, unknown> = {},
  options: {
    error?: Error | undefined
    flush?: boolean | undefined
  } = {},
): Promise<void> {
  try {
    const orgSlug = getConfigValueOrUndef(CONFIG_KEY_DEFAULT_ORG)

    if (orgSlug) {
      const telemetry = await TelemetryService.getTelemetryClient(orgSlug)
      debug(`Got telemetry service for org: ${orgSlug}`)

      const event = {
        context,
        event_sender_created_at: new Date().toISOString(),
        event_type: eventType,
        ...(Object.keys(metadata).length > 0 && { metadata }),
        ...(options.error && {
          error: {
            message: sanitizeErrorAttribute(options.error.message),
            stack: sanitizeErrorAttribute(options.error.stack),
            type: options.error.constructor.name,
          },
        }),
      }

      telemetry.track(event)

      // Flush events if requested.
      if (options.flush) {
        await telemetry.flush()
      }
    }
  } catch (err) {
    // Telemetry errors should never block CLI execution.
    debug(`Failed to track event ${eventType}: ${err}`)
  }
}

/**
 * Track CLI initialization event.
 * Should be called at the start of CLI execution.
 *
 * @param argv Command line arguments (process.argv).
 * @returns Start timestamp for duration calculation.
 */
export async function trackCliStart(argv: string[]): Promise<number> {
  debug('Capture start of command')

  const startTime = Date.now()

  await trackEvent('cli_start', buildContext(argv))

  return startTime
}

/**
 * Track a generic CLI event with optional metadata.
 * Use this for tracking custom events during CLI execution.
 *
 * @param eventType Type of event to track.
 * @param argv Command line arguments (process.argv).
 * @param metadata Optional additional metadata to include with the event.
 */
export async function trackCliEvent(
  eventType: string,
  argv: string[],
  metadata?: Record<string, unknown> | undefined,
): Promise<void> {
  debug(`Tracking CLI event: ${eventType}`)

  await trackEvent(eventType, buildContext(argv), metadata)
}

/**
 * Track CLI completion event.
 * Should be called on successful CLI exit.
 *
 * @param argv
 * @param startTime Start timestamp from trackCliStart.
 * @param exitCode Process exit code (default: 0).
 */
export async function trackCliComplete(
  argv: string[],
  startTime: number,
  exitCode?: string | number | undefined | null,
): Promise<void> {
  debug('Capture end of command')

  await trackEvent(
    'cli_complete',
    buildContext(argv),
    {
      duration: calculateDuration(startTime),
      exit_code: normalizeExitCode(exitCode, 0),
    },
    {
      flush: true,
    },
  )
}

/**
 * Track CLI error event.
 * Should be called when CLI exits with an error.
 *
 * @param argv
 * @param startTime Start timestamp from trackCliStart.
 * @param error Error that occurred.
 * @param exitCode Process exit code (default: 1).
 */
export async function trackCliError(
  argv: string[],
  startTime: number,
  error: unknown,
  exitCode?: number | string | undefined | null,
): Promise<void> {
  debug('Capture error and stack trace of command')

  await trackEvent(
    'cli_error',
    buildContext(argv),
    {
      duration: calculateDuration(startTime),
      exit_code: normalizeExitCode(exitCode, 1),
    },
    {
      error: normalizeError(error),
      flush: true,
    },
  )
}

/**
 * Track subprocess/command start event.
 *
 * Use this when spawning external commands like npm, npx, coana, cdxgen, etc.
 *
 * @param command Command being executed (e.g., 'npm', 'npx', 'coana').
 * @param metadata Optional additional metadata (e.g., cwd, purpose).
 * @returns Start timestamp for duration calculation.
 */
export async function trackSubprocessStart(
  command: string,
  metadata?: Record<string, unknown> | undefined,
): Promise<number> {
  debug(`Tracking subprocess start: ${command}`)

  const startTime = Date.now()

  await trackEvent('subprocess_start', buildContext(process.argv), {
    command,
    ...metadata,
  })

  return startTime
}

/**
 * Track subprocess/command completion event.
 *
 * Should be called when spawned command completes successfully.
 *
 * @param command Command that was executed.
 * @param startTime Start timestamp from trackSubprocessStart.
 * @param exitCode Process exit code.
 * @param metadata Optional additional metadata (e.g., stdout length, stderr length).
 */
export async function trackSubprocessComplete(
  command: string,
  startTime: number,
  exitCode: number | null,
  metadata?: Record<string, unknown> | undefined,
): Promise<void> {
  debug(`Tracking subprocess complete: ${command}`)

  await trackEvent('subprocess_complete', buildContext(process.argv), {
    command,
    duration: calculateDuration(startTime),
    exit_code: normalizeExitCode(exitCode, 0),
    ...metadata,
  })
}

/**
 * Track subprocess/command error event.
 *
 * Should be called when spawned command fails or throws error.
 *
 * @param command Command that was executed.
 * @param startTime Start timestamp from trackSubprocessStart.
 * @param error Error that occurred.
 * @param exitCode Process exit code.
 * @param metadata Optional additional metadata.
 */
export async function trackSubprocessError(
  command: string,
  startTime: number,
  error: unknown,
  exitCode?: number | null | undefined,
  metadata?: Record<string, unknown> | undefined,
): Promise<void> {
  debug(`Tracking subprocess error: ${command}`)

  await trackEvent(
    'subprocess_error',
    buildContext(process.argv),
    {
      command,
      duration: calculateDuration(startTime),
      exit_code: normalizeExitCode(exitCode, 1),
      ...metadata,
    },
    {
      error: normalizeError(error),
    },
  )
}
