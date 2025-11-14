/**
 * Error utilities for Socket CLI.
 * Provides consistent error handling, formatting, and message extraction.
 *
 * Key Classes:
 * - AuthError: Authentication failures (401/403 responses)
 * - InputError: User input validation failures
 *
 * Key Functions:
 * - captureException: Send errors to Sentry for monitoring
 * - formatErrorWithDetail: Format errors with detailed context
 * - getErrorCause: Get error cause with fallback to UNKNOWN_ERROR
 * - getErrorMessage: Extract error message from any thrown value
 *
 * Error Handling Strategy:
 * - Always prefer specific error types over generic errors
 * - Use formatErrorWithDetail for user-facing error messages
 * - Log errors to Sentry in production for monitoring
 */

import { setTimeout as wait } from 'node:timers/promises'

import {
  kInternalsSymbol,
  UNKNOWN_ERROR,
} from '@socketsecurity/lib/constants/core'
import { debugNs } from '@socketsecurity/lib/debug'

import ENV from '../../constants/env.mts'
import {
  SOCKET_DASHBOARD_URL,
  SOCKET_PRICING_URL,
  SOCKET_STATUS_URL,
} from '../../constants/socket.mts'

// Access internals via kInternalsSymbol.
const constants = { ENV, [kInternalsSymbol]: {} as { getSentry?: () => any } }
const internals = constants[kInternalsSymbol]
const getSentry = internals.getSentry

type EventHintOrCaptureContext = { [key: string]: any } | Function

/**
 * Authentication error with recovery suggestions.
 * Thrown when API authentication fails (401/403).
 */
export class AuthError extends Error {
  public readonly recovery: string[]

  constructor(message: string, recovery?: string[]) {
    super(message)
    this.name = 'AuthError'
    this.recovery = recovery || [
      'Run `socket login` to authenticate',
      'Set SOCKET_SECURITY_API_KEY environment variable',
      'Add apiToken to ~/.config/socket/config.toml',
    ]
  }
}

/**
 * User input validation error with details.
 * Thrown when user provides invalid input or arguments.
 */
export class InputError extends Error {
  public readonly body: string | undefined
  public readonly recovery: string[]

  constructor(message: string, body?: string | undefined, recovery?: string[]) {
    super(message)
    this.name = 'InputError'
    this.body = body
    this.recovery = recovery || ['Check command syntax with --help']
  }
}

/**
 * Network error with retry suggestions.
 * Thrown when network requests fail due to connectivity issues.
 */
export class NetworkError extends Error {
  public readonly statusCode?: number | undefined
  public readonly recovery: string[]

  constructor(
    message: string,
    statusCode?: number | undefined,
    recovery?: string[] | undefined,
  ) {
    super(message)
    this.name = 'NetworkError'
    this.statusCode = statusCode
    this.recovery = recovery || [
      'Check your internet connection',
      'Verify proxy settings if using a proxy',
      'Try again in a few moments',
    ]
  }
}

/**
 * API rate limit error with quota information.
 * Thrown when API rate limits are exceeded (429).
 */
export class RateLimitError extends Error {
  public readonly retryAfter?: number | undefined
  public readonly recovery: string[]

  constructor(message: string, retryAfter?: number | undefined) {
    super(message)
    this.name = 'RateLimitError'
    this.retryAfter = retryAfter
    this.recovery = [
      retryAfter
        ? `Wait ${retryAfter} seconds before retrying`
        : 'Wait a few minutes before retrying',
      `Check your API quota at ${SOCKET_DASHBOARD_URL}`,
      `Consider upgrading your plan for higher limits at ${SOCKET_PRICING_URL}`,
    ]
  }
}

/**
 * File system error with path context.
 * Thrown when file operations fail.
 */
export class FileSystemError extends Error {
  public readonly path?: string | undefined
  public readonly code?: string | undefined
  public readonly recovery: string[]

  constructor(
    message: string,
    path?: string | undefined,
    code?: string | undefined,
    recovery?: string[] | undefined,
  ) {
    super(message)
    this.name = 'FileSystemError'
    this.path = path
    this.code = code
    this.recovery = recovery || this.getDefaultRecovery(code)
  }

  private getDefaultRecovery(code?: string): string[] {
    switch (code) {
      case 'ENOENT':
        return [
          'Verify the file or directory exists',
          'Check the path spelling',
          'Ensure you have permission to access the location',
        ]
      case 'EACCES':
      case 'EPERM':
        return [
          'Check file permissions',
          'Run with appropriate user privileges',
          'Verify directory ownership',
        ]
      case 'ENOSPC':
        return [
          'Free up disk space',
          'Check available disk space with `df -h`',
          'Delete unnecessary files',
        ]
      default:
        return ['Check file system permissions and availability']
    }
  }
}

/**
 * Configuration error with setup instructions.
 * Thrown when CLI configuration is invalid or missing.
 */
export class ConfigError extends Error {
  public readonly configKey?: string | undefined
  public readonly recovery: string[]

  constructor(
    message: string,
    configKey?: string | undefined,
    recovery?: string[] | undefined,
  ) {
    super(message)
    this.name = 'ConfigError'
    this.configKey = configKey
    this.recovery = recovery || [
      'Run `socket config list` to view current configuration',
      'Use `socket config set <key> <value>` to update settings',
      'Check ~/.config/socket/config.toml for syntax errors',
    ]
  }
}

/**
 * Timeout error with retry guidance.
 * Thrown when operations exceed time limits.
 */
export class TimeoutError extends Error {
  public readonly timeoutMs?: number | undefined
  public readonly elapsedMs?: number | undefined
  public readonly recovery: string[]

  constructor(
    message: string,
    timeoutMs?: number | undefined,
    elapsedMs?: number | undefined,
    recovery?: string[] | undefined,
  ) {
    super(message)
    this.name = 'TimeoutError'
    this.timeoutMs = timeoutMs
    this.elapsedMs = elapsedMs
    this.recovery = recovery || [
      'Check your internet connection speed',
      'Try again when network conditions improve',
      'Contact support if timeouts persist',
    ]
  }
}

export async function captureException(
  exception: unknown,
  hint?: EventHintOrCaptureContext | undefined,
): Promise<string> {
  const result = captureExceptionSync(exception, hint)
  // "Sleep" for a second, just in case, hopefully enough time to initiate fetch.
  await wait(1000)
  return result
}

export function captureExceptionSync(
  exception: unknown,
  hint?: EventHintOrCaptureContext | undefined,
): string {
  const Sentry = getSentry?.()
  if (!Sentry) {
    return ''
  }
  debugNs('notice', 'send: exception to Sentry')
  return Sentry.captureException(exception, hint) as string
}

export function isErrnoException(
  value: unknown,
): value is NodeJS.ErrnoException {
  if (!(value instanceof Error)) {
    return false
  }
  return (value as NodeJS.ErrnoException).code !== undefined
}

/**
 * Type guard to check if an error has recovery suggestions.
 */
export function hasRecoverySuggestions(
  error: unknown,
): error is Error & { recovery: string[] } {
  return (
    error instanceof Error &&
    'recovery' in error &&
    Array.isArray((error as any).recovery)
  )
}

/**
 * Extract recovery suggestions from an error.
 *
 * @param error - The error object to extract recovery suggestions from
 * @returns Array of recovery suggestion strings, or empty array if none
 */
export function getRecoverySuggestions(error: unknown): string[] {
  if (hasRecoverySuggestions(error)) {
    return error.recovery
  }
  return []
}

/**
 * Extracts an error message from an unknown value.
 * Returns the message if it's an Error object, otherwise returns undefined.
 *
 * @param error - The error object to extract message from
 * @returns The error message or undefined
 */
export function getErrorMessage(error: unknown): string | undefined {
  return (error as Error)?.message
}

/**
 * Extracts an error message from an unknown value with a fallback.
 * Returns the message if it's an Error object, otherwise returns the fallback.
 *
 * @param error - The error object to extract message from
 * @param fallback - The fallback message if no error message is found
 * @returns The error message or fallback
 *
 * @example
 * getErrorMessageOr(error, 'Unknown error occurred')
 * // Returns: "ENOENT: no such file or directory" or "Unknown error occurred"
 */
export function getErrorMessageOr(error: unknown, fallback: string): string {
  return getErrorMessage(error) || fallback
}

/**
 * Extracts an error cause from an unknown value.
 * Returns the error message if available, otherwise UNKNOWN_ERROR.
 * Commonly used for creating CResult error causes.
 *
 * @param error - The error object to extract message from
 * @returns The error message or UNKNOWN_ERROR constant
 *
 * @example
 * return { ok: false, message: 'Operation failed', cause: getErrorCause(e) }
 */
export function getErrorCause(error: unknown): string {
  return getErrorMessageOr(error, UNKNOWN_ERROR)
}

/**
 * Formats an error message with an optional error detail appended.
 * Extracts the message from an unknown error value and appends it
 * to the base message if available.
 *
 * @param baseMessage - The base message to display
 * @param error - The error object to extract message from
 * @returns Formatted message with error detail if available
 *
 * @example
 * formatErrorWithDetail('Failed to delete file', error)
 * // Returns: "Failed to delete file: ENOENT: no such file or directory"
 * // Or just: "Failed to delete file" if no error message
 */
export function formatErrorWithDetail(
  baseMessage: string,
  error: unknown,
): string {
  const errorMessage = getErrorMessage(error)
  return `${baseMessage}${errorMessage ? `: ${errorMessage}` : ''}`
}

/**
 * Build error cause string for SDK error results, preserving detailed quota information for 429 errors.
 * Used by API utilities to format consistent error messages with appropriate context.
 *
 * @param status - HTTP status code from the API response
 * @param message - Primary error message from the API
 * @param reason - Additional error reason/cause from the API
 * @returns Formatted error cause string with appropriate context
 *
 * @example
 * await buildErrorCause(429, 'Quota exceeded', 'Monthly limit reached')
 * // Returns: "Monthly limit reached. API quota exceeded..."
 *
 * await buildErrorCause(400, 'Bad request', 'Invalid parameter')
 * // Returns: "Bad request (reason: Invalid parameter)"
 */
/**
 * Calculate similarity ratio between two strings using word overlap.
 * Returns a value between 0 (no overlap) and 1 (identical).
 */
function calculateStringSimilarity(str1: string, str2: string): number {
  if (str1 === str2) return 1

  const words1 = new Set(
    str1
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length > 2),
  )
  const words2 = new Set(
    str2
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length > 2),
  )

  if (words1.size === 0 || words2.size === 0) return 0

  let overlap = 0
  for (const word of words1) {
    if (words2.has(word)) overlap++
  }

  return (2 * overlap) / (words1.size + words2.size)
}

export async function buildErrorCause(
  status: number,
  message: string,
  reason: string,
): Promise<string> {
  const NO_ERROR_MESSAGE = 'No error message returned'

  // For 429 errors, preserve the detailed quota information.
  if (status === 429) {
    const { getErrorMessageForHttpStatusCode } = await import(
      '../socket/api.mjs'
    )
    const quotaMessage = await getErrorMessageForHttpStatusCode(429)
    if (reason && reason !== NO_ERROR_MESSAGE) {
      return `${reason}. ${quotaMessage}`
    }
    if (message && message !== NO_ERROR_MESSAGE) {
      return `${message}. ${quotaMessage}`
    }
    return quotaMessage
  }

  // Skip adding reason if it's too similar to message (avoid redundancy).
  // Threshold of 0.7 means >70% word overlap indicates redundancy.
  if (reason && message !== reason) {
    const similarity = calculateStringSimilarity(message, reason)
    if (similarity < 0.7) {
      return `${message} (reason: ${reason})`
    }
  }

  return message
}

/**
 * Type guard to check if an error is a network error.
 */
export function isNetworkError(error: unknown): error is NetworkError {
  return error instanceof NetworkError
}

/**
 * Type guard to check if an error is a timeout error.
 */
export function isTimeoutError(error: unknown): error is TimeoutError {
  return error instanceof TimeoutError
}

/**
 * Detect network-related error codes from Node.js errors.
 */
export function getNetworkErrorCode(error: unknown): string | undefined {
  if (!isErrnoException(error)) {
    return undefined
  }
  return error.code
}

/**
 * Get network error diagnostics with actionable guidance.
 * Provides specific recovery steps based on error type.
 *
 * @param error - The error to diagnose
 * @param durationMs - Optional request duration in milliseconds
 * @returns Diagnostic message with recovery suggestions
 *
 * @example
 * const diagnostics = getNetworkErrorDiagnostics(error, 5000)
 * // Returns: "Connection refused. The server may be down..."
 */
export function getNetworkErrorDiagnostics(
  error: unknown,
  durationMs?: number | undefined,
): string {
  const errorCode = getNetworkErrorCode(error)
  const errorMessage = getErrorMessage(error) || String(error)

  // Timeout errors.
  if (
    errorCode === 'ETIMEDOUT' ||
    errorCode === 'ESOCKETTIMEDOUT' ||
    errorCode === 'ECONNRESET' ||
    (durationMs && durationMs > 30_000)
  ) {
    const timeInfo = durationMs
      ? ` after ${Math.round(durationMs / 1000)}s`
      : ''
    return (
      `Request timeout${timeInfo}. The server took too long to respond.\n` +
      '💡 Try:\n' +
      '  • Check your internet connection speed\n' +
      '  • Retry the request - the server may be temporarily slow\n' +
      `  • Check Socket status: ${SOCKET_STATUS_URL}\n` +
      '  • Contact support if timeouts persist'
    )
  }

  // Connection refused.
  if (errorCode === 'ECONNREFUSED') {
    return (
      'Connection refused. The server actively rejected the connection.\n' +
      '💡 Try:\n' +
      '  • Check if you are using a proxy or VPN that may be blocking the connection\n' +
      '  • Verify your firewall settings\n' +
      `  • Check Socket status: ${SOCKET_STATUS_URL}\n` +
      '  • Ensure SOCKET_CLI_API_BASE_URL is set correctly (if configured)'
    )
  }

  // DNS resolution failures.
  if (
    errorCode === 'ENOTFOUND' ||
    errorCode === 'EAI_AGAIN' ||
    errorMessage.includes('getaddrinfo')
  ) {
    return (
      'DNS resolution failed. Unable to resolve the server hostname.\n' +
      '💡 Try:\n' +
      '  • Check your internet connection\n' +
      '  • Verify DNS settings (try 8.8.8.8 or 1.1.1.1)\n' +
      '  • Check if a VPN or proxy is interfering\n' +
      '  • Ensure SOCKET_CLI_API_BASE_URL is correct (if configured)\n' +
      '  • Try again in a few moments'
    )
  }

  // Certificate/SSL errors.
  if (
    errorCode === 'CERT_HAS_EXPIRED' ||
    errorCode === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
    errorCode === 'SELF_SIGNED_CERT_IN_CHAIN' ||
    errorMessage.includes('certificate')
  ) {
    return (
      'SSL/TLS certificate error. Unable to verify server identity.\n' +
      '💡 Try:\n' +
      '  • Check your system date and time are correct\n' +
      '  • Update your system certificates\n' +
      '  • Check if a proxy is intercepting HTTPS traffic\n' +
      '  • Contact your IT department if behind corporate firewall'
    )
  }

  // Network unreachable.
  if (errorCode === 'ENETUNREACH' || errorCode === 'EHOSTUNREACH') {
    return (
      'Network unreachable. Cannot reach the destination network.\n' +
      '💡 Try:\n' +
      '  • Check your internet connection\n' +
      '  • Verify network/WiFi is connected\n' +
      '  • Check if VPN or firewall is blocking access\n' +
      '  • Try a different network'
    )
  }

  // Generic network error with basic guidance.
  return (
    `Network error: ${errorMessage}\n` +
    '💡 Try:\n' +
    '  • Check your internet connection\n' +
    '  • Verify proxy settings if using a proxy\n' +
    `  • Check Socket status: ${SOCKET_STATUS_URL}\n` +
    '  • Try again in a few moments'
  )
}
