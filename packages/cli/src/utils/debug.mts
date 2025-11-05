/**
 * Debug utilities for Socket CLI.
 * Provides structured debugging with categorized levels and helpers.
 *
 * Debug Categories:
 * DEFAULT (shown with SOCKET_CLI_DEBUG=1):
 * - 'error': Critical errors that prevent operation
 * - 'warn': Important warnings that may affect behavior
 * - 'notice': Notable events and state changes
 * - 'silly': Very verbose debugging info
 *
 * OPT-IN ONLY (require explicit DEBUG='category' even with SOCKET_CLI_DEBUG=1):
 * - 'inspect': Detailed object inspection (DEBUG='inspect' or DEBUG='*')
 * - 'stdio': Command execution logs (DEBUG='stdio' or DEBUG='*')
 *
 * These opt-in categories are intentionally excluded from default debug output
 * to reduce noise. Enable them explicitly when needed for deep debugging.
 */

import { UNKNOWN_ERROR } from '@socketsecurity/lib/constants/core'
import {
  debug,
  debugCache,
  debugDir,
  debugDirNs,
  debugNs,
  isDebug,
  isDebugNs,
} from '@socketsecurity/lib/debug'

export type ApiRequestDebugInfo = {
  method?: string | undefined
  url?: string | undefined
  headers?: Record<string, string> | undefined
  durationMs?: number | undefined
}

/**
 * Sanitize headers to remove sensitive information.
 * Redacts Authorization and API key headers.
 */
function sanitizeHeaders(
  headers?: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!headers) {
    return undefined
  }

  const sanitized: Record<string, string> = Object.create(null)
  for (const [key, value] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase()
    if (lowerKey === 'authorization' || lowerKey.includes('api-key')) {
      sanitized[key] = '[REDACTED]'
    } else {
      sanitized[key] = value
    }
  }
  return sanitized
}

/**
 * Debug an API response with detailed request information.
 * Logs essential info without exposing sensitive data.
 *
 * For failed requests (status >= 400 or error), logs:
 * - HTTP method (GET, POST, etc.)
 * - Full URL
 * - Response status code
 * - Sanitized headers (Authorization redacted)
 * - Request duration in milliseconds
 */
export function debugApiResponse(
  endpoint: string,
  status?: number | undefined,
  error?: unknown | undefined,
  requestInfo?: ApiRequestDebugInfo | undefined,
): void {
  if (error) {
    const errorDetails = {
      __proto__: null,
      endpoint,
      error: error instanceof Error ? error.message : UNKNOWN_ERROR,
      ...(requestInfo?.method ? { method: requestInfo.method } : {}),
      ...(requestInfo?.url ? { url: requestInfo.url } : {}),
      ...(requestInfo?.durationMs !== undefined
        ? { durationMs: requestInfo.durationMs }
        : {}),
      ...(requestInfo?.headers
        ? { headers: sanitizeHeaders(requestInfo.headers) }
        : {}),
    }
    debugDir(errorDetails)
  } else if (status && status >= 400) {
    // For failed requests, log detailed information.
    if (requestInfo) {
      const failureDetails = {
        __proto__: null,
        endpoint,
        status,
        ...(requestInfo.method ? { method: requestInfo.method } : {}),
        ...(requestInfo.url ? { url: requestInfo.url } : {}),
        ...(requestInfo.durationMs !== undefined
          ? { durationMs: requestInfo.durationMs }
          : {}),
        ...(requestInfo.headers
          ? { headers: sanitizeHeaders(requestInfo.headers) }
          : {}),
      }
      debugDir(failureDetails)
    } else {
      debug(`API ${endpoint}: HTTP ${status}`)
    }
    /* c8 ignore next 3 */
  } else if (isDebugNs('notice')) {
    debugNs('notice', `API ${endpoint}: ${status || 'pending'}`)
  }
}

/**
 * Debug file operation.
 * Logs file operations with appropriate level.
 */
export function debugFileOp(
  operation: 'read' | 'write' | 'delete' | 'create',
  filepath: string,
  error?: unknown | undefined,
): void {
  if (error) {
    debugDir({
      operation,
      filepath,
      error: error instanceof Error ? error.message : UNKNOWN_ERROR,
    })
    /* c8 ignore next 3 */
  } else if (isDebugNs('silly')) {
    debugNs('silly', `File ${operation}: ${filepath}`)
  }
}

/**
 * Debug package scanning.
 * Provides insight into security scanning.
 */
export function debugScan(
  phase: 'start' | 'progress' | 'complete' | 'error',
  packageCount?: number | undefined,
  details?: unknown | undefined,
): void {
  switch (phase) {
    case 'start':
      if (packageCount) {
        debug(`Scanning ${packageCount} packages`)
      }
      break
    case 'progress':
      if (isDebugNs('silly') && packageCount) {
        debugNs('silly', `Scan progress: ${packageCount} packages processed`)
      }
      break
    case 'complete':
      debugNs(
        'notice',
        `Scan complete${packageCount ? `: ${packageCount} packages` : ''}`,
      )
      break
    case 'error':
      debugDir({
        phase: 'scan_error',
        details,
      })
      break
  }
}

/**
 * Debug configuration loading.
 */
export function debugConfig(
  source: string,
  found: boolean,
  error?: unknown | undefined,
): void {
  if (error) {
    debugDir({
      source,
      error: error instanceof Error ? error.message : UNKNOWN_ERROR,
    })
  } else if (found) {
    debug(`Config loaded: ${source}`)
    /* c8 ignore next 3 */
  } else if (isDebugNs('silly')) {
    debugNs('silly', `Config not found: ${source}`)
  }
}

/**
 * Debug git operations.
 * Only logs important git operations, not every command.
 */
export function debugGit(
  operation: string,
  success: boolean,
  details?: Record<string, unknown> | undefined,
): void {
  if (!success) {
    debugDir({
      git_op: operation,
      ...details,
    })
  } else if (
    (isDebugNs('notice') && operation.includes('push')) ||
    operation.includes('commit')
  ) {
    // Only log important operations like push and commit.
    debugNs('notice', `Git ${operation} succeeded`)
  } else if (isDebugNs('silly')) {
    debugNs('silly', `Git ${operation}`)
  }
}

export { debug, debugCache, debugDir, debugDirNs, debugNs, isDebug, isDebugNs }
