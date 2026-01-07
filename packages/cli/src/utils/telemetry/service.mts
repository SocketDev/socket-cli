/**
 * Telemetry service for Socket CLI.
 * Manages event collection, batching, and submission to Socket API.
 *
 * IMPORTANT: Telemetry is ALWAYS scoped to an organization.
 * Cannot track telemetry without an org context.
 *
 * Features:
 * - Singleton pattern (one instance per process)
 * - Organization-scoped tracking (required)
 * - Event batching (auto-flush at batch size)
 * - Exit handlers (auto-flush on process exit)
 * - Automatic session ID assignment
 * - Explicit finalization via destroy() for controlled cleanup
 * - Graceful degradation (errors don't block CLI)
 *
 * @example
 * ```typescript
 * // Get telemetry client (returns singleton instance)
 * const telemetry = await TelemetryService.getTelemetryClient('my-org')
 *
 * // Track an event (session_id is auto-set)
 * telemetry.track({
 *   event_sender_created_at: new Date().toISOString(),
 *   event_type: 'cli_start',
 *   context: {
 *     version: '2.2.15',
 *     platform: process.platform,
 *     node_version: process.version,
 *     arch: process.arch,
 *     argv: process.argv.slice(2)
 *   }
 * })
 *
 * // Flush happens automatically on batch size and exit
 * // Can also be called manually if needed
 * await telemetry.flush()
 *
 * // Always call destroy() before exit to flush remaining events
 * await telemetry.destroy()
 * ```
 */

import { randomUUID } from 'node:crypto'

import { debugDir, debugFn } from '@socketsecurity/registry/lib/debug'

import { setupSdk } from '../sdk.mts'

import type { TelemetryEvent } from './types.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

type TelemetryConfig = SocketSdkSuccessResult<'getOrgTelemetryConfig'>['data']

/**
 * Debug wrapper for telemetry service.
 * Wraps debugFn to provide a simpler API.
 */
const debug = (message: string): void => {
  debugFn('socket:telemetry:service', message)
}

/**
 * DebugDir wrapper for telemetry service.
 */
const debugDirWrapper = (obj: unknown): void => {
  debugDir('socket:telemetry:service', obj)
}

/**
 * Process-wide session ID.
 * Generated once per CLI invocation and shared across all telemetry instances.
 */
const SESSION_ID = randomUUID()

/**
 * Default telemetry configuration.
 * Used as fallback if API config fetch fails.
 */
const DEFAULT_TELEMETRY_CONFIG = {
  telemetry: {
    enabled: false,
  },
} as TelemetryConfig

/**
 * Static configuration for telemetry service behavior.
 */
const TELEMETRY_SERVICE_CONFIG = {
  batch_size: 10, // Auto-flush when queue reaches this size.
  flush_timeout: 2_000, // 2 second maximum for flush operations.
} as const

/**
 * Singleton instance holder.
 */
interface TelemetryServiceInstance {
  current: TelemetryService | null
}

/**
 * Singleton telemetry service instance holder.
 * Only one instance exists per process.
 */
const telemetryServiceInstance: TelemetryServiceInstance = {
  current: null,
}

/**
 * Wrap a promise with a timeout.
 * Rejects if promise doesn't resolve within timeout.
 *
 * @param promise Promise to wrap.
 * @param timeoutMs Timeout in milliseconds.
 * @param errorMessage Error message if timeout occurs.
 * @returns Promise that resolves or times out.
 */
function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage: string,
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => {
        reject(new Error(errorMessage))
      }, timeoutMs)
    }),
  ])
}

/**
 * Centralized telemetry service for Socket CLI.
 * Telemetry is always scoped to an organization.
 * Singleton pattern ensures only one instance exists per process.
 *
 * NOTE: Only one telemetry instance exists per process.
 * If getTelemetryClient() is called with a different organization slug,
 * it returns the existing instance for the original organization.
 * Switching organizations mid-execution is not supported - the first
 * organization to initialize telemetry will be used for the entire process.
 *
 * This is intended, since we can't switch an org during command execution.
 */
export class TelemetryService {
  private readonly orgSlug: string
  private config: TelemetryConfig | null = null
  private eventQueue: TelemetryEvent[] = []
  private isDestroyed = false

  /**
   * Private constructor.
   * Requires organization slug.
   *
   * @param orgSlug - Organization identifier.
   */
  private constructor(orgSlug: string) {
    this.orgSlug = orgSlug
    debug(
      `Telemetry service created for org '${orgSlug}' with session ID: ${SESSION_ID}`,
    )
  }

  /**
   * Get the current telemetry instance if one exists.
   * Does not create a new instance.
   *
   * @returns Current telemetry instance or null if none exists.
   */
  static getCurrentInstance(): TelemetryService | null {
    return telemetryServiceInstance.current
  }

  /**
   * Get telemetry client for an organization.
   * Creates and initializes client if it doesn't exist.
   * Returns existing instance if already initialized.
   *
   * @param orgSlug - Organization identifier (required).
   * @returns Initialized telemetry service instance.
   */
  static async getTelemetryClient(orgSlug: string): Promise<TelemetryService> {
    // Return existing instance if already initialized.
    if (telemetryServiceInstance.current) {
      debug(
        `Telemetry already initialized for org: ${telemetryServiceInstance.current.orgSlug}`,
      )
      return telemetryServiceInstance.current
    }

    const instance = new TelemetryService(orgSlug)

    try {
      const sdkResult = await setupSdk()
      if (!sdkResult.ok) {
        debug('Failed to setup SDK for telemetry, using default config')
        instance.config = DEFAULT_TELEMETRY_CONFIG
        telemetryServiceInstance.current = instance
        return instance
      }

      const sdk = sdkResult.data
      const configResult = await sdk.getOrgTelemetryConfig(orgSlug)

      if (configResult.success) {
        instance.config = configResult.data
        debug(
          `Telemetry configuration fetched successfully: enabled=${instance.config.telemetry.enabled}`,
        )
        debugDirWrapper({ config: instance.config })

        // Periodic flush will start automatically when first event is tracked.
      } else {
        debug(`Failed to fetch telemetry config: ${configResult.error}`)
        instance.config = DEFAULT_TELEMETRY_CONFIG
      }
    } catch (e) {
      debug(`Error initializing telemetry: ${e}`)
      instance.config = DEFAULT_TELEMETRY_CONFIG
    }

    // Only set singleton instance after full initialization.
    telemetryServiceInstance.current = instance
    return instance
  }

  /**
   * Track a telemetry event.
   * Adds event to queue for batching and eventual submission.
   * Auto-flushes when batch size is reached.
   *
   * @param event - Telemetry event to track (session_id is optional and will be auto-set).
   */
  track(event: Omit<TelemetryEvent, 'session_id'>): void {
    debug('Incoming track event request')

    if (this.isDestroyed) {
      debug('Telemetry service destroyed, ignoring event')
      return
    }

    if (!this.config?.telemetry.enabled) {
      debug(`Telemetry disabled, skipping event: ${event.event_type}`)
      return
    }

    // Create complete event with session_id and org_slug.
    const completeEvent: TelemetryEvent = {
      ...event,
      session_id: SESSION_ID,
    }

    debug(`Tracking telemetry event: ${completeEvent.event_type}`)
    debugDirWrapper(completeEvent)

    this.eventQueue.push(completeEvent)

    // Auto-flush if batch size reached.
    const batchSize = TELEMETRY_SERVICE_CONFIG.batch_size
    if (this.eventQueue.length >= batchSize) {
      debug(`Batch size reached (${batchSize}), flushing events`)
      void this.flush()
    }
  }

  /**
   * Flush all queued events to the API.
   * Returns immediately if no events queued or telemetry disabled.
   * Times out after configured flush_timeout to prevent blocking CLI exit.
   */
  async flush(): Promise<void> {
    if (this.isDestroyed) {
      debug('Telemetry service destroyed, cannot flush')
      return
    }

    if (this.eventQueue.length === 0) {
      return
    }

    if (!this.config?.telemetry.enabled) {
      debug('Telemetry disabled, clearing queue without sending')
      this.eventQueue = []
      return
    }

    const eventsToSend = [...this.eventQueue]
    this.eventQueue = []

    debug(`Flushing ${eventsToSend.length} telemetry events`)

    const flushStartTime = Date.now()

    try {
      await withTimeout(
        this.sendEvents(eventsToSend),
        TELEMETRY_SERVICE_CONFIG.flush_timeout,
        `Telemetry flush timed out after ${TELEMETRY_SERVICE_CONFIG.flush_timeout}ms`,
      )

      const flushDuration = Date.now() - flushStartTime
      debug(
        `Telemetry events sent successfully (${eventsToSend.length} events in ${flushDuration}ms)`,
      )
    } catch (e) {
      const flushDuration = Date.now() - flushStartTime
      const errorMessage = e instanceof Error ? e.message : String(e)

      // Check if this is a timeout error.
      if (
        errorMessage.includes('timed out') ||
        flushDuration >= TELEMETRY_SERVICE_CONFIG.flush_timeout
      ) {
        debug(
          `Telemetry flush timed out after ${TELEMETRY_SERVICE_CONFIG.flush_timeout}ms`,
        )
        debug(`Failed to send ${eventsToSend.length} events due to timeout`)
      } else {
        debug(`Error flushing telemetry: ${errorMessage}`)
        debug(`Failed to send ${eventsToSend.length} events due to error`)
      }
      // Events are discarded on error to prevent infinite growth.
    }
  }

  /**
   * Send events to the API.
   * Extracted as separate method for timeout wrapping.
   *
   * @param events Events to send.
   */
  private async sendEvents(events: TelemetryEvent[]): Promise<void> {
    const sdkResult = await setupSdk()
    if (!sdkResult.ok) {
      debug('Failed to setup SDK for flush, events discarded')
      return
    }

    const sdk = sdkResult.data

    // Track flush statistics.
    let successCount = 0
    let failureCount = 0

    // Send events in parallel for faster flush.
    // Use allSettled to ensure all sends are attempted even if some fail.
    const results = await Promise.allSettled(
      events.map(async event => {
        const result = await sdk.postOrgTelemetry(
          this.orgSlug,
          event as unknown as Record<string, unknown>,
        )
        return { event, result }
      }),
    )

    // Log results and collect statistics.
    for (const settledResult of results) {
      if (settledResult.status === 'fulfilled') {
        const { event, result } = settledResult.value
        if (result.success) {
          successCount++
          debug('Telemetry sent to telemetry:')
          debugDirWrapper(event)
        } else {
          failureCount++
          debug(`Failed to send telemetry event: ${result.error}`)
        }
      } else {
        failureCount++
        debug(`Telemetry request failed: ${settledResult.reason}`)
      }
    }

    // Log flush statistics.
    debug(
      `Flush stats: ${successCount} succeeded, ${failureCount} failed out of ${events.length} total`,
    )
  }

  /**
   * Destroy the telemetry service for this organization.
   * Flushes remaining events and clears all state.
   * Idempotent - safe to call multiple times.
   */
  async destroy(): Promise<void> {
    if (this.isDestroyed) {
      debug('Telemetry service already destroyed, skipping')
      return
    }

    debug(`Destroying telemetry service for org: ${this.orgSlug}`)

    // Mark as destroyed immediately to prevent concurrent destroy() calls.
    this.isDestroyed = true

    // Flush remaining events with timeout.
    const eventsToFlush = [...this.eventQueue]
    this.eventQueue = []

    if (eventsToFlush.length > 0 && this.config?.telemetry.enabled) {
      debug(`Flushing ${eventsToFlush.length} events before destroy`)
      const flushStartTime = Date.now()

      try {
        await withTimeout(
          this.sendEvents(eventsToFlush),
          TELEMETRY_SERVICE_CONFIG.flush_timeout,
          `Telemetry flush during destroy timed out after ${TELEMETRY_SERVICE_CONFIG.flush_timeout}ms`,
        )
        const flushDuration = Date.now() - flushStartTime
        debug(`Events flushed successfully during destroy (${flushDuration}ms)`)
      } catch (e) {
        const flushDuration = Date.now() - flushStartTime
        const errorMessage = e instanceof Error ? e.message : String(e)

        // Check if this is a timeout error.
        if (
          errorMessage.includes('timed out') ||
          flushDuration >= TELEMETRY_SERVICE_CONFIG.flush_timeout
        ) {
          debug(
            `Telemetry flush during destroy timed out after ${TELEMETRY_SERVICE_CONFIG.flush_timeout}ms`,
          )
          debug(
            `Failed to send ${eventsToFlush.length} events during destroy due to timeout`,
          )
        } else {
          debug(`Error flushing telemetry during destroy: ${errorMessage}`)
          debug(
            `Failed to send ${eventsToFlush.length} events during destroy due to error`,
          )
        }
      }
    }

    this.config = null

    // Clear singleton instance.
    telemetryServiceInstance.current = null

    debug(`Telemetry service destroyed for org: ${this.orgSlug}`)
  }
}
