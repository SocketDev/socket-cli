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

import { debugDir, debugFn, isDebug } from '@socketsecurity/registry/lib/debug'
import { logger } from '@socketsecurity/registry/lib/logger'

import constants from '../constants.mts'

/**
 * Debug an API request start.
 * Logs essential info without exposing sensitive data.
 */
export function debugApiRequest(
  method: string,
  endpoint: string,
  timeout?: number | undefined,
): void {
  if (constants.ENV.SOCKET_CLI_DEBUG) {
    const timeoutStr = timeout !== undefined ? ` (timeout: ${timeout}ms)` : ''
    logger.info(
      `[DEBUG] ${new Date().toISOString()} request started: ${method} ${endpoint}${timeoutStr}`,
    )
  }
}

/**
 * Debug an API response end.
 * Logs essential info without exposing sensitive data.
 */
export function debugApiResponse(
  method: string,
  endpoint: string,
  status?: number | undefined,
  error?: unknown | undefined,
  duration?: number | undefined,
  headers?: Record<string, string> | undefined,
): void {
  if (!constants.ENV.SOCKET_CLI_DEBUG) {
    return
  }

  if (error) {
    logger.fail(
      `[DEBUG] ${new Date().toISOString()} request error: ${method} ${endpoint} - ${error instanceof Error ? error.message : 'Unknown error'}${duration !== undefined ? ` (${duration}ms)` : ''}`,
    )
    if (headers) {
      logger.info(
        `[DEBUG] response headers: ${JSON.stringify(headers, null, 2)}`,
      )
    }
  } else {
    const durationStr = duration !== undefined ? ` (${duration}ms)` : ''
    logger.info(
      `[DEBUG] ${new Date().toISOString()} request ended: ${method} ${endpoint}: HTTP ${status}${durationStr}`,
    )
    if (headers && status && status >= 400) {
      logger.info(
        `[DEBUG] response headers: ${JSON.stringify(headers, null, 2)}`,
      )
    }
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
    debugDir('warn', {
      operation,
      filepath,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
  } else if (isDebug('silly')) {
    debugFn('silly', `File ${operation}: ${filepath}`)
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
        debugFn('notice', `Scanning ${packageCount} packages`)
      }
      break
    case 'progress':
      if (isDebug('silly') && packageCount) {
        debugFn('silly', `Scan progress: ${packageCount} packages processed`)
      }
      break
    case 'complete':
      debugFn(
        'notice',
        `Scan complete${packageCount ? `: ${packageCount} packages` : ''}`,
      )
      break
    case 'error':
      debugDir('error', {
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
    debugDir('warn', {
      source,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
  } else if (found) {
    debugFn('notice', `Config loaded: ${source}`)
  } else if (isDebug('silly')) {
    debugFn('silly', `Config not found: ${source}`)
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
    debugDir('warn', {
      git_op: operation,
      ...details,
    })
  } else if (
    (isDebug('notice') && operation.includes('push')) ||
    operation.includes('commit')
  ) {
    // Only log important operations like push and commit.
    debugFn('notice', `Git ${operation} succeeded`)
  } else if (isDebug('silly')) {
    debugFn('silly', `Git ${operation}`)
  }
}

export { debugDir, debugFn, isDebug }
