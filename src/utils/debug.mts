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

import { UNKNOWN_ERROR } from '@socketsecurity/registry/constants/core'
import {
  debug,
  debugCache,
  debugDir,
  debugDirNs,
  debugNs,
  isDebug,
  isDebugNs,
} from '@socketsecurity/registry/lib/debug'

/**
 * Debug an API response.
 * Logs essential info without exposing sensitive data.
 */
export function debugApiResponse(
  endpoint: string,
  status?: number | undefined,
  error?: unknown | undefined,
): void {
  if (error) {
    debugDir({
      endpoint,
      error: error instanceof Error ? error.message : UNKNOWN_ERROR,
    })
  } else if (status && status >= 400) {
    debug(`API ${endpoint}: HTTP ${status}`)
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
