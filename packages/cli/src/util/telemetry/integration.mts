/**
 * Telemetry integration helpers for Socket CLI. Provides utilities for tracking
 * common CLI events and subprocess executions.
 *
 * Usage:
 *
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
 *   trackSubprocessError,
 * } from './util/telemetry/integration.mts'
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
 * await trackSubprocessComplete('npm', subStart, 0, {
 *   stdout_length: 1234,
 * })
 *
 * // On subprocess error.
 * await trackSubprocessError('npm', subStart, error, 1)
 *
 * // Manual finalization (usually not needed if exit handlers are set up).
 * await finalizeTelemetry() // Async version.
 * finalizeTelemetrySync() // Sync version (best-effort).
 * ```
 */
import os from 'node:os'
import process from 'node:process'

import { debugNs } from '@socketsecurity/lib-stable/debug/output'
import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { isError } from '@socketsecurity/lib-stable/errors/predicates'
import { escapeRegExp } from '@socketsecurity/lib-stable/regexps/escape'

import { TelemetryService } from './service.mts'
import { CONFIG_KEY_DEFAULT_ORG, constants } from '../../constants.mts'
import { getConfigValueOrUndef } from '../config.mts'

import type { TelemetryContext } from './types.mts'

// Track whether exit handlers have been set up to prevent duplicate registration.
let exitHandlersRegistered = false

// Add other subcommands
const WRAPPER_CLI = new Set(['bun', 'npm', 'npx', 'pip', 'pnpm', 'vlt', 'yarn'])

// Add other sensitive flags
const API_TOKEN_FLAGS = new Set(['--api-token', '--token', '-t'])

/**
 * Build context for the current telemetry entry.
 *
 * The context contains the current execution context, in which all CLI
 * invocation should have access to.
 *
 * @param argv Command line arguments.
 *
 * @returns Telemetry context object.
 */
export function buildContext(argv: string[]): TelemetryContext {
  return {
    arch: process.arch,
    argv: sanitizeArgv(argv),
    node_version: process.version,
    platform: process.platform,
    version: constants.ENV.INLINED_VERSION,
  }
}

/**
 * Calculate duration from start timestamp.
 *
 * @param startTime - Start timestamp from Date.now().
 *
 * @returns Duration in milliseconds.
 */
export function calculateDuration(startTime: number): number {
  return Date.now() - startTime
}

/**
 * Debug wrapper for telemetry integration.
 */
export function debug(message: string): void {
  debugNs('socket:telemetry:integration', message)
}

/**
 * Finalize telemetry and clean up resources (async version). This should be
 * called before process.exit to ensure telemetry is sent and resources are
 * cleaned up. Use this in async contexts like beforeExit handlers.
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
 * Finalize telemetry synchronously (best-effort). This triggers a flush without
 * awaiting it. Use this in synchronous contexts like signal handlers where
 * async operations are not possible.
 *
 * Note: This is best-effort only. Events may be lost if the process exits
 * before flush completes. Prefer finalizeTelemetry() (async version) when
 * possible.
 */
export function finalizeTelemetrySync(): void {
  const instance = TelemetryService.getCurrentInstance()
  if (instance) {
    debug('Triggering sync flush (best-effort)')
    void instance.flush()
  }
}

/**
 * Normalize error to Error object.
 *
 * @param error - Unknown error value.
 *
 * @returns Error object.
 */
export function normalizeError(error: unknown): Error {
  return isError(error) ? error : new Error(String(error))
}

/**
 * Normalize exit code to a number with default fallback.
 *
 * @param exitCode - Exit code (may be string, number, null, or undefined).
 * @param defaultValue - Default value if exitCode is not a number.
 *
 * @returns Normalized exit code.
 */
export function normalizeExitCode(
  exitCode: string | number | null | undefined,
  defaultValue: number,
): number {
  return typeof exitCode === 'number' ? exitCode : defaultValue
}

/**
 * Sanitize argv to remove sensitive information. Removes API tokens, file paths
 * with usernames, and other PII. Also strips arguments after wrapper CLIs to
 * avoid leaking package names.
 *
 * @example
 *   // Input: ['node', 'socket', 'npm', 'install', '@my/private-package', '--token', 'fake-token']
 *   // Output: ['npm', 'install']
 *
 * @param argv Raw command line arguments (full process.argv including execPath
 *   and script).
 *
 * @returns Sanitized argv array.
 */
export function sanitizeArgv(argv: string[]): string[] {
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
    const homeDir = os.homedir()
    if (homeDir) {
      return arg.replace(new RegExp(escapeRegExp(homeDir), 'g'), '~')
    }

    return arg
  })
}

/**
 * Sanitize error attribute to remove user specific paths. Replaces user home
 * directory and other sensitive paths.
 *
 * @param input Raw input.
 *
 * @returns Sanitized input.
 */
export function sanitizeErrorAttribute(
  input: string | undefined,
): string | undefined {
  if (!input) {
    return undefined
  }

  // Remove user home directory.
  const homeDir = os.homedir()
  if (homeDir) {
    return input.replace(new RegExp(escapeRegExp(homeDir), 'g'), '~')
  }

  return input
}

/**
 * Set up exit handlers for telemetry finalization. This registers handlers for
 * both normal exits (beforeExit) and common fatal signals.
 *
 * Flushing strategy: - Batch-based: Auto-flush when queue reaches 10 events. -
 * beforeExit: Async handler for clean shutdowns (when event loop empties). -
 * Fatal signals (SIGINT, SIGTERM, SIGHUP): Best-effort sync flush. - Accepts
 * that forced exits (SIGKILL, process.exit()) may lose final events.
 *
 * Call this once during CLI initialization to ensure telemetry is flushed on
 * exit. Safe to call multiple times - only registers handlers once.
 *
 * @example
 *   ;```typescript
 *   // In src/cli.mts
 *   setupTelemetryExitHandlers()
 *   ```
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
    /* c8 ignore start - beforeExit handler body fires only on real process exit; vitest workers don't trigger it */
    debug('beforeExit handler triggered')
    void finalizeTelemetry()
    /* c8 ignore stop */
  })

  // Register handlers for common fatal signals as best-effort fallback.
  // These are synchronous contexts, so we can only trigger flush without awaiting.
  const fatalSignals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP']

  for (let i = 0, { length } = fatalSignals; i < length; i += 1) {
    const signal = fatalSignals[i]!
    try {
      process.on(signal, () => {
        /* c8 ignore start - signal handler body fires only on real signal delivery; tests don't dispatch signals */
        debug(`Signal ${signal} received, attempting sync flush`)
        finalizeTelemetrySync()
        /* c8 ignore stop */
      })
      /* c8 ignore start - process.on rarely throws for SIGINT/SIGTERM/SIGHUP; cross-platform defensive */
    } catch (e) {
      // Some signals may not be available on all platforms.
      debug(
        `Failed to register handler for signal ${signal}: ${errorMessage(e)}`,
      )
    }
    /* c8 ignore stop */
  }

  debug('Telemetry exit handlers registered (beforeExit + common signals)')
}

/**
 * Generic event tracking function. Tracks any telemetry event with optional
 * error details and explicit flush.
 *
 * Events are automatically flushed via batch size or exit handlers. Use the
 * flush option only when immediate submission is required.
 *
 * @param eventType Type of event to track.
 * @param context Event context.
 * @param metadata Event metadata.
 * @param options Optional configuration.
 *
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
  } catch (e) {
    // Telemetry errors should never block CLI execution.
    debug(`Failed to track event ${eventType}: ${errorMessage(e)}`)
  }
}

export {
  trackCliComplete,
  trackCliError,
  trackCliEvent,
  trackCliStart,
} from './cli-tracking.mts'

export {
  trackSubprocessComplete,
  trackSubprocessError,
  trackSubprocessExit,
  trackSubprocessStart,
} from './subprocess-tracking.mts'
