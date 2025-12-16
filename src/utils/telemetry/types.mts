/**
 * Telemetry types for Socket CLI.
 * Defines the structure of telemetry events and related data.
 */

/**
 * Error details for telemetry events.
 */
export interface TelemetryEventError {
  /** Error class/type name. */
  type: string
  /** Error message. */
  message: string | undefined
  /** Stack trace (sanitized). */
  stack?: string | undefined
}

/**
 * Telemetry Context.
 *
 * This represent how the cli was invoked and met.
 */
export interface TelemetryContext {
  version: string
  platform: string
  node_version: string
  arch: string
  argv: string[]
}

/**
 * Telemetry event structure.
 * All telemetry events must follow this schema.
 */
export interface TelemetryEvent {
  event_sender_created_at: string
  event_type: string
  context: TelemetryContext
  session_id?: string
  metadata?: Record<string, unknown>
  error?: TelemetryEventError | undefined
}
