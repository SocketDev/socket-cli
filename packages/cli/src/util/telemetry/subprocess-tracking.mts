/**
 * Subprocess-level telemetry tracking for Socket CLI. Tracks spawned command
 * lifecycle: start, completion, error, and combined exit handling.
 */
import process from 'node:process'

import {
  buildContext,
  calculateDuration,
  debug,
  finalizeTelemetry,
  normalizeError,
  normalizeExitCode,
  trackEvent,
} from './integration.mts'

/**
 * Track subprocess/command completion event.
 *
 * Should be called when spawned command completes successfully.
 *
 * @param command Command that was executed.
 * @param startTime Start timestamp from trackSubprocessStart.
 * @param exitCode Process exit code.
 * @param metadata Optional additional metadata (e.g., stdout length, stderr
 *   length).
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

/**
 * Track subprocess exit and finalize telemetry. This is a convenience function
 * that tracks completion/error based on exit code and ensures telemetry is
 * flushed before returning.
 *
 * Note: Only tracks subprocess-level events. CLI-level events (cli_complete,
 * cli_error) are tracked by the main CLI entry point in src/cli.mts.
 *
 * @example
 *   ;```typescript
 *   await trackSubprocessExit(NPM, subprocessStartTime, code)
 *   ```
 *
 * @param command - Command name (e.g., 'npm', 'pip').
 * @param startTime - Start timestamp from trackSubprocessStart.
 * @param exitCode - Process exit code (null treated as error).
 *
 * @returns Promise that resolves when tracking and flush complete.
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

/**
 * Track subprocess/command start event.
 *
 * Use this when spawning external commands like npm, npx, coana, cdxgen, etc.
 *
 * @param command Command being executed (e.g., 'npm', 'npx', 'coana').
 * @param metadata Optional additional metadata (e.g., cwd, purpose).
 *
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
