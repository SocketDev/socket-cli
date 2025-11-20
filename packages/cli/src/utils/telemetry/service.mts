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
 * - Event batching (configurable batch size)
 * - Periodic flush (configurable interval)
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
 * // Flush is automatic on batch size, but can be called manually
 * await telemetry.flush()
 *
 * // Always call destroy() before exit to flush remaining events
 * await telemetry.destroy()
 * ```
 */

import { randomUUID } from 'node:crypto'

import { debug, debugDir } from '@socketsecurity/lib/debug'

import { setupSdk } from '../socket/sdk.mts'

import type { TelemetryEvent } from './types.mts'
import type {
  PostOrgTelemetryPayload,
  TelemetryConfig,
} from '@socketsecurity/sdk'

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
  batch_size: 10,
  flush_interval: 1_000, // 1 second.
  flush_timeout: 5_000, // 5 seconds maximum for flush operations.
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
 */
export class TelemetryService {
  private readonly orgSlug: string
  private config: TelemetryConfig | null = null
  private eventQueue: TelemetryEvent[] = []
  private flushTimer: NodeJS.Timeout | null = null
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
      const configResult = await sdk.getTelemetryConfig(orgSlug)

      if (configResult.success) {
        instance.config = configResult.data
        debug(
          `Telemetry configuration fetched successfully: enabled=${instance.config.telemetry.enabled}`,
        )
        debugDir({ config: instance.config })

        // Start periodic flush if enabled.
        if (instance.config.telemetry.enabled) {
          instance.startPeriodicFlush()
        }
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
    debugDir(completeEvent)

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
      debug('No events to flush')
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

    try {
      await withTimeout(
        this.sendEvents(eventsToSend),
        TELEMETRY_SERVICE_CONFIG.flush_timeout,
        `Telemetry flush timed out after ${TELEMETRY_SERVICE_CONFIG.flush_timeout}ms`,
      )

      debug(
        `Telemetry events sent successfully (${eventsToSend.length} events)`,
      )
    } catch (e) {
      debug(`Error flushing telemetry: ${e}`)
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

    // Send events individually (no batch endpoint available).
    for (const event of events) {
      const result = await sdk.postOrgTelemetry(
        this.orgSlug,
        event as unknown as PostOrgTelemetryPayload,
      )

      if (result.success) {
        debug('Telemetry sent to telemetry:')
        debugDir(event)
      } else {
        debug(`Failed to send telemetry event: ${result.error}`)
      }
    }
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

    // Stop periodic flush.
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
    }

    // Flush remaining events with timeout.
    const eventsToFlush = [...this.eventQueue]
    this.eventQueue = []

    if (eventsToFlush.length > 0 && this.config?.telemetry.enabled) {
      debug(`Flushing ${eventsToFlush.length} events before destroy`)
      try {
        await withTimeout(
          this.sendEvents(eventsToFlush),
          TELEMETRY_SERVICE_CONFIG.flush_timeout,
          `Telemetry flush during destroy timed out after ${TELEMETRY_SERVICE_CONFIG.flush_timeout}ms`,
        )
        debug('Events flushed successfully during destroy')
      } catch (e) {
        debug(`Error flushing telemetry during destroy: ${e}`)
      }
    }

    this.config = null

    // Clear singleton instance.
    telemetryServiceInstance.current = null

    debug(`Telemetry service destroyed for org: ${this.orgSlug}`)
  }

  /**
   * Start periodic flush timer.
   */
  private startPeriodicFlush(): void {
    if (this.flushTimer) {
      return
    }

    const flushInterval = TELEMETRY_SERVICE_CONFIG.flush_interval

    this.flushTimer = setInterval(() => {
      debug('Periodic flush triggered')
      void this.flush()
    }, flushInterval)

    // Don't keep process alive for telemetry.
    this.flushTimer.unref()

    debug(`Periodic flush started with interval: ${flushInterval}ms`)
  }
}
