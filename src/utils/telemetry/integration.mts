/**
 * Telemetry integration helpers for Socket CLI.
 * Provides utilities for tracking common CLI events and subprocess executions.
 *
 * Usage:
 * ```typescript
 * import {
 *   setupTelemetryExitHandlers,
 *   finalizeTelemetry,
 *   finalizeTelemetrySync,
 *   trackCliStart,
 *   trackCliEvent,
 *   trackCliComplete,
 *   trackCliError,
 *   trackSubprocessStart,
 *   trackSubprocessComplete,
 *   trackSubprocessError
 * } from './utils/telemetry/integration.mts'
 *
 * // Set up exit handlers once during CLI initialization.
 * setupTelemetryExitHandlers()
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
 *
 * // Manual finalization (usually not needed if exit handlers are set up).
 * await finalizeTelemetry() // Async version.
 * finalizeTelemetrySync()    // Sync version (best-effort).
 * ```
 */
import { homedir } from 'node:os'
import process from 'node:process'

import { debugFn } from '@socketsecurity/registry/lib/debug'
import { escapeRegExp } from '@socketsecurity/registry/lib/regexps'

import { TelemetryService } from './service.mts'
import constants, { CONFIG_KEY_DEFAULT_ORG } from '../../constants.mts'
import { getConfigValueOrUndef } from '../config.mts'

import type { TelemetryContext } from './types.mts'

/**
 * Debug wrapper for telemetry integration.
 */
const debug = (message: string): void => {
  debugFn('socket:telemetry:integration', message)
}

/**
 * Finalize telemetry and clean up resources (async version).
 * This should be called before process.exit to ensure telemetry is sent and resources are cleaned up.
 * Use this in async contexts like beforeExit handlers.
 *
 * @returns Promise that resolves when finalization completes.
 */
export async function finalizeTelemetry(): Promise<void> {
  const instance = TelemetryService.getCurrentInstance()
  if (instance) {
    debug('Flushing telemetry')
    await instance.flush()
  }
}

/**
 * Finalize telemetry synchronously (best-effort).
 * This triggers a flush without awaiting it.
 * Use this in synchronous contexts like signal handlers where async operations are not possible.
 *
 * Note: This is best-effort only. Events may be lost if the process exits before flush completes.
 * Prefer finalizeTelemetry() (async version) when possible.
 */
export function finalizeTelemetrySync(): void {
  const instance = TelemetryService.getCurrentInstance()
  if (instance) {
    debug('Triggering sync flush (best-effort)')
    void instance.flush()
  }
}

// Track whether exit handlers have been set up to prevent duplicate registration.
let exitHandlersRegistered = false

/**
 * Set up exit handlers for telemetry finalization.
 * This registers handlers for both normal exits (beforeExit) and common fatal signals.
 *
 * Flushing strategy:
 * - Batch-based: Auto-flush when queue reaches 10 events.
 * - beforeExit: Async handler for clean shutdowns (when event loop empties).
 * - Fatal signals (SIGINT, SIGTERM, SIGHUP): Best-effort sync flush.
 * - Accepts that forced exits (SIGKILL, process.exit()) may lose final events.
 *
 * Call this once during CLI initialization to ensure telemetry is flushed on exit.
 * Safe to call multiple times - only registers handlers once.
 *
 * @example
 * ```typescript
 * // In src/cli.mts
 * setupTelemetryExitHandlers()
 * ```
 */
export function setupTelemetryExitHandlers(): void {
  // Prevent duplicate handler registration.
  if (exitHandlersRegistered) {
    debug('Telemetry exit handlers already registered, skipping')
    return
  }

  exitHandlersRegistered = true

  // Use beforeExit for async finalization during clean shutdowns.
  // This fires when the event loop empties but before process actually exits.
  process.on('beforeExit', () => {
    debug('beforeExit handler triggered')
    void finalizeTelemetry()
  })

  // Register handlers for common fatal signals as best-effort fallback.
  // These are synchronous contexts, so we can only trigger flush without awaiting.
  const fatalSignals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP']

  for (const signal of fatalSignals) {
    try {
      process.on(signal, () => {
        debug(`Signal ${signal} received, attempting sync flush`)
        finalizeTelemetrySync()
      })
    } catch (e) {
      // Some signals may not be available on all platforms.
      debug(`Failed to register handler for signal ${signal}: ${e}`)
    }
  }

  debug('Telemetry exit handlers registered (beforeExit + common signals)')
}

/**
 * Track subprocess exit and finalize telemetry.
 * This is a convenience function that tracks completion/error based on exit code
 * and ensures telemetry is flushed before returning.
 *
 * Note: Only tracks subprocess-level events. CLI-level events (cli_complete, cli_error)
 * are tracked by the main CLI entry point in src/cli.mts.
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

// Add other subcommands
const WRAPPER_CLI = new Set(['bun', 'npm', 'npx', 'pip', 'pnpm', 'vlt', 'yarn'])

// Add other sensitive flags
const API_TOKEN_FLAGS = new Set(['--api-token', '--token', '-t'])

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
    version: constants.ENV.INLINED_SOCKET_CLI_VERSION,
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
    WRAPPER_CLI.has(arg),
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
      if (prevArg && API_TOKEN_FLAGS.has(prevArg)) {
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
      return arg.replace(new RegExp(escapeRegExp(homeDir), 'g'), '~')
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
    return input.replace(new RegExp(escapeRegExp(homeDir), 'g'), '~')
  }

  return input
}

/**
 * Generic event tracking function.
 * Tracks any telemetry event with optional error details and explicit flush.
 *
 * Events are automatically flushed via batch size or exit handlers.
 * Use the flush option only when immediate submission is required.
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
  // Skip telemetry in test environments.
  if (constants.ENV.VITEST) {
    return
  }

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
 * Flushes immediately since this is typically the last event before process exit.
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
 * Flushes immediately since this is typically the last event before process exit.
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
