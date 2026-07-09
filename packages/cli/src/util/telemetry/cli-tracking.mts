/**
 * CLI-level telemetry tracking for Socket CLI. Tracks the lifecycle of a
 * single CLI invocation: start, custom events, completion, and error.
 */
import {
  buildContext,
  calculateDuration,
  debug,
  normalizeError,
  normalizeExitCode,
  trackEvent,
} from './integration.mts'

/**
 * Track CLI completion event. Should be called on successful CLI exit. Flushes
 * immediately since this is typically the last event before process exit.
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
 * Track CLI error event. Should be called when CLI exits with an error. Flushes
 * immediately since this is typically the last event before process exit.
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
 * Track a generic CLI event with optional metadata. Use this for tracking
 * custom events during CLI execution.
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
 * Track CLI initialization event. Should be called at the start of CLI
 * execution.
 *
 * @param argv Command line arguments (process.argv).
 *
 * @returns Start timestamp for duration calculation.
 */
export async function trackCliStart(argv: string[]): Promise<number> {
  debug('Capture start of command')

  const startTime = Date.now()

  await trackEvent('cli_start', buildContext(argv))

  return startTime
}
