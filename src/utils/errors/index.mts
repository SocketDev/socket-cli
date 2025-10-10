/** @fileoverview Centralized error handling module for Socket CLI */

// Re-export all error types and utilities from a single location
// This reduces cognitive load by providing a single import point for error handling

// Import error types first
import {
  AuthError,
  ConfigError,
  FileSystemError,
  InputError,
  NetworkError,
  RateLimitError
} from '../errors.mts'

// Re-export error types
export {
  AuthError,
  ConfigError,
  FileSystemError,
  InputError,
  NetworkError,
  RateLimitError
}

export {
  formatErrorCompact,
  formatErrorForDisplay,
  formatErrorForJson,
  formatErrorForTerminal
} from '../error-display.mts'
export {
  createErrorFilterStream,
  installErrorFiltering,
  shouldShowFullError
} from '../error-filter.mts'
export { handleError } from '../error-handler.mts'
export { failMsgWithBadge } from '../fail-msg-with-badge.mts'

// Common error messages to reduce duplication
export const ERROR_MESSAGES = {
  NO_API_TOKEN: 'No API token found. Run "socket login" or set SOCKET_SECURITY_API_KEY',
  NO_PACKAGE_JSON: 'No package.json found in the current directory',
  NO_MANIFEST: 'No manifest file found (package.json, requirements.txt, etc.)',
  NO_ORG_SPECIFIED: 'No organization specified. Use --org flag or set a default org',
  INVALID_JSON: 'Invalid JSON format',
  NETWORK_ERROR: 'Network request failed. Check your internet connection',
  RATE_LIMITED: 'API rate limit exceeded. Please try again later',
  UNAUTHORIZED: 'Unauthorized. Check your API token',
  NOT_FOUND: 'Resource not found',
  SERVER_ERROR: 'Server error. Please try again or contact support'
} as const

// Error code constants for consistency
export const ERROR_CODES = {
  SUCCESS: 0,
  GENERAL_ERROR: 1,
  INVALID_INPUT: 2,
  AUTH_FAILED: 3,
  NOT_FOUND: 4,
  NETWORK_ERROR: 5,
  RATE_LIMITED: 6,
  SERVER_ERROR: 7
} as const

// Type guard for network errors
export function isNetworkError(error: unknown): error is NetworkError {
  return error instanceof Error && error.name === 'NetworkError'
}

// Type guard for auth errors
export function isAuthError(error: unknown): error is AuthError {
  return error instanceof Error && error.name === 'AuthError'
}

// Type guard for input errors
export function isInputError(error: unknown): error is InputError {
  return error instanceof Error && error.name === 'InputError'
}