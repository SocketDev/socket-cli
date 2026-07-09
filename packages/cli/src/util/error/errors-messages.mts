/**
 * Error message extraction and formatting for Socket CLI. Provides helpers
 * for pulling a display message out of any thrown value, building detailed
 * error causes, and surfacing recovery suggestions.
 */

import { UNKNOWN_ERROR } from '@socketsecurity/lib-stable/constants/sentinels'
import { isError } from '@socketsecurity/lib-stable/errors/predicates'

/**
 * Build error cause string for SDK error results, preserving detailed quota
 * information for 429 errors. Used by API utilities to format consistent error
 * messages with appropriate context.
 *
 * @example
 *   await buildErrorCause(429, 'Quota exceeded', 'Monthly limit reached')
 *   // Returns: "Monthly limit reached. API quota exceeded..."
 *
 *   await buildErrorCause(400, 'Bad request', 'Invalid parameter')
 *   // Returns: "Bad request (reason: Invalid parameter)"
 *
 * @param status - HTTP status code from the API response.
 * @param message - Primary error message from the API.
 * @param reason - Additional error reason/cause from the API.
 *
 * @returns Formatted error cause string with appropriate context
 */
export async function buildErrorCause(
  status: number,
  message: string,
  reason: string,
): Promise<string> {
  const NO_ERROR_MESSAGE = 'No error message returned'

  // For 429 errors, preserve the detailed quota information.
  if (status === 429) {
    const { getErrorMessageForHttpStatusCode } =
      await import('../socket/api.mjs')
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
 * Calculate similarity ratio between two strings using word overlap. Returns a
 * value between 0 (no overlap) and 1 (identical).
 */
export function calculateStringSimilarity(str1: string, str2: string): number {
  if (str1 === str2) {
    return 1
  }

  const words1 = new Set(
    str1
      .toLowerCase()
      .split(/\W+/)
      .filter(w => w.length > 2),
  )
  const words2 = new Set(
    str2
      .toLowerCase()
      .split(/\W+/)
      .filter(w => w.length > 2),
  )

  if (words1.size === 0 || words2.size === 0) {
    return 0
  }

  let overlap = 0
  for (const word of words1) {
    if (words2.has(word)) {
      overlap += 1
    }
  }

  return (2 * overlap) / (words1.size + words2.size)
}

/**
 * Formats an error message with an optional error detail appended. Extracts the
 * message from an unknown error value and appends it to the base message if
 * available.
 *
 * @example
 *   formatErrorWithDetail('Failed to clear the cache', error)
 *   // Returns: "Failed to clear the cache: ENOENT: no such file or directory"
 *   // Or just: "Failed to clear the cache" if no error message
 *
 * @param baseMessage - The base message to display.
 * @param error - The error object to extract message from.
 *
 * @returns Formatted message with error detail if available
 */
export function formatErrorWithDetail(
  baseMessage: string,
  error: unknown,
): string {
  const errorMessage = getErrorMessage(error)
  return `${baseMessage}${errorMessage ? `: ${errorMessage}` : ''}`
}

/**
 * Extracts an error cause from an unknown value. Returns the error message if
 * available, otherwise UNKNOWN_ERROR. Commonly used for creating CResult error
 * causes.
 *
 * @example
 *   return { ok: false, message: 'Operation failed', cause: getErrorCause(e) }
 *
 * @param error - The error object to extract message from.
 *
 * @returns The error message or UNKNOWN_ERROR constant
 */
export function getErrorCause(error: unknown): string {
  return getErrorMessageOr(error, UNKNOWN_ERROR)
}

/**
 * Extracts an error message from an unknown value. Returns the message if it's
 * an Error object, otherwise returns undefined.
 *
 * @param error - The error object to extract message from.
 *
 * @returns The error message or undefined
 */
export function getErrorMessage(error: unknown): string | undefined {
  return (error as Error)?.message
}

/**
 * Extracts an error message from an unknown value with a fallback. Returns the
 * message if it's an Error object, otherwise returns the fallback.
 *
 * @example
 *   getErrorMessageOr(error, 'Unknown error occurred')
 *   // Returns: "ENOENT: no such file or directory" or "Unknown error occurred"
 *
 * @param error - The error object to extract message from.
 * @param fallback - The fallback message if no error message is found.
 *
 * @returns The error message or fallback
 */
export function getErrorMessageOr(error: unknown, fallback: string): string {
  return getErrorMessage(error) || fallback
}

/**
 * Extract recovery suggestions from an error.
 *
 * @param error - The error object to extract recovery suggestions from.
 *
 * @returns Array of recovery suggestion strings, or empty array if none
 */
export function getRecoverySuggestions(error: unknown): string[] {
  if (hasRecoverySuggestions(error)) {
    return error.recovery
  }
  return []
}

/**
 * Type guard to check if an error has recovery suggestions.
 */
export function hasRecoverySuggestions(
  error: unknown,
): error is Error & { recovery: string[] } {
  return (
    isError(error) &&
    'recovery' in error &&
    Array.isArray((error as { recovery?: unknown | undefined }).recovery)
  )
}
