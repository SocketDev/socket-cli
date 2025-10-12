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

import { debugNs } from '@socketsecurity/registry/lib/debug'

import constants, { UNKNOWN_ERROR } from '../constants.mts'

const {
  kInternalsSymbol,
  [kInternalsSymbol as unknown as 'Symbol(kInternalsSymbol)']: { getSentry },
} = constants

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
      'Check your API quota at https://socket.dev/dashboard',
      'Consider upgrading your plan for higher limits',
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
  const Sentry = getSentry()
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
export async function buildErrorCause(
  status: number,
  message: string,
  reason: string,
): Promise<string> {
  const NO_ERROR_MESSAGE = 'No error message returned'

  // For 429 errors, preserve the detailed quota information.
  if (status === 429) {
    const { getErrorMessageForHttpStatusCode } = await import('./api.mts')
    const quotaMessage = await getErrorMessageForHttpStatusCode(429)
    if (reason && reason !== NO_ERROR_MESSAGE) {
      return `${reason}. ${quotaMessage}`
    }
    if (message && message !== NO_ERROR_MESSAGE) {
      return `${message}. ${quotaMessage}`
    }
    return quotaMessage
  }

  return reason && message !== reason
    ? `${message} (reason: ${reason})`
    : message
}
