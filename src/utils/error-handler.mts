/** @fileoverview Standardized error handling utilities */

import { logger } from '@socketsecurity/registry/lib/logger'

import { displayErrorWithStackTrace } from './errors.mts'

export interface ErrorHandlerOptions {
  exitCode?: number
  showStack?: boolean
  expandable?: boolean
  prefix?: string
  recovery?: string[]
}

/**
 * Standardized error handler for commands
 */
export function handleError(
  error: unknown,
  message: string,
  options: ErrorHandlerOptions = {}
): void {
  const {
    exitCode = 1,
    expandable = true,
    prefix = 'Error',
    recovery,
    showStack = false
  } = options

  // Set exit code
  process.exitCode = exitCode

  // Format the error message
  const fullMessage = `${prefix}: ${message}`

  // Display error based on options
  if (expandable && error instanceof Error) {
    displayErrorWithStackTrace(fullMessage, error, { showStack })
  } else {
    logger.error(fullMessage)
    if (error) {
      logger.error(String(error))
    }
  }

  // Show recovery suggestions if provided
  if (recovery && recovery.length > 0) {
    logger.log('')
    logger.log('Possible solutions:')
    for (const suggestion of recovery) {
      logger.log(`  • ${suggestion}`)
    }
  }
}

/**
 * Handle API errors consistently
 */
export function handleApiError(
  error: unknown,
  operation: string,
  options: Omit<ErrorHandlerOptions, 'prefix'> = {}
): void {
  const message = `Failed to ${operation}`

  // Check for specific error types
  if (error && typeof error === 'object') {
    const err = error as Record<string, unknown>

    // Check for 401/403 authentication errors
    if (err['statusCode'] === 401 || err['statusCode'] === 403) {
      handleError(error, message, {
        ...options,
        prefix: 'Authentication Error',
        recovery: [
          'Run `socket login` to authenticate',
          'Check your API token is valid',
          'Verify organization access permissions'
        ]
      })
      return
    }

    // Check for 429 rate limit
    if (err['statusCode'] === 429) {
      handleError(error, message, {
        ...options,
        prefix: 'Rate Limit Error',
        recovery: [
          'Wait a few minutes before retrying',
          'Check your API quota at https://socket.dev/dashboard',
          'Consider upgrading your plan for higher limits'
        ]
      })
      return
    }

    // Check for network errors
    if (err['code'] === 'ENOTFOUND' || err['code'] === 'ECONNREFUSED') {
      handleError(error, message, {
        ...options,
        prefix: 'Network Error',
        recovery: [
          'Check your internet connection',
          'Verify Socket API is accessible',
          'Check proxy settings if behind a firewall'
        ]
      })
      return
    }
  }

  // Default error handling
  handleError(error, message, { ...options, prefix: 'API Error' })
}

/**
 * Handle validation errors
 */
export function handleValidationError(
  field: string,
  value: unknown,
  requirements: string
): void {
  process.exitCode = 1
  logger.error(`Invalid ${field}: ${value}`)
  logger.log(`Requirements: ${requirements}`)
}

/**
 * Wrap async command handlers with error handling
 */
export function withErrorHandling<T extends (...args: any[]) => Promise<void>>(
  handler: T,
  operation: string
): T {
  return (async (...args) => {
    try {
      await handler(...args)
    } catch (error) {
      handleApiError(error, operation)
    }
  }) as T
}

/**
 * Create a result handler that sets exit code on failure
 */
export function handleResult<T>(
  result: { ok: boolean; message?: string; data?: T },
  operation: string,
  onSuccess?: (data: T) => void
): void {
  if (!result.ok) {
    process.exitCode = 1
    const message = result.message || `Failed to ${operation}`
    logger.error(message)
    return
  }

  if (onSuccess && result.data) {
    onSuccess(result.data)
  }
}