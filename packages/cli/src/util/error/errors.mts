/**
 * Error utilities for Socket CLI. Provides consistent error handling,
 * formatting, and message extraction.
 *
 * Key Classes:
 *
 * - AuthError: Authentication failures (401/403 responses)
 * - InputError: User input validation failures
 *
 * Key Functions:
 *
 * - CaptureException: Send errors to Sentry for monitoring
 * - FormatErrorWithDetail: Format errors with detailed context
 * - GetErrorCause: Get error cause with fallback to UNKNOWN_ERROR
 * - GetErrorMessage: Extract error message from any thrown value
 *
 * Error Handling Strategy:
 *
 * - Always prefer specific error types over generic errors
 * - Use formatErrorWithDetail for user-facing error messages
 * - Log errors to Sentry in production for monitoring
 */

export { isErrnoException } from '@socketsecurity/lib-stable/errors/predicates'

export {
  AuthError,
  ConfigError,
  FileSystemError,
  InputError,
  NetworkError,
  RateLimitError,
  TimeoutError,
} from './errors-types.mts'

export {
  getNetworkErrorCode,
  getNetworkErrorDiagnostics,
} from './errors-network.mts'

export {
  buildErrorCause,
  calculateStringSimilarity,
  formatErrorWithDetail,
  getErrorCause,
  getErrorMessage,
  getErrorMessageOr,
  getRecoverySuggestions,
  hasRecoverySuggestions,
} from './errors-messages.mts'

export { captureException, captureExceptionSync } from './errors-sentry.mts'

export type {
  EventHintOrCaptureContext,
  SentryClient,
} from './errors-sentry.mts'
