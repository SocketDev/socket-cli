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

import { debugFn } from '@socketsecurity/registry/lib/debug'

import constants, { UNKNOWN_ERROR } from '../constants.mts'

const {
  kInternalsSymbol,
  [kInternalsSymbol as unknown as 'Symbol(kInternalsSymbol)']: { getSentry },
} = constants

type EventHintOrCaptureContext = { [key: string]: any } | Function

export class AuthError extends Error {}

export class InputError extends Error {
  public body: string | undefined

  constructor(message: string, body?: string | undefined) {
    super(message)
    this.body = body
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
  debugFn('notice', 'send: exception to Sentry')
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
