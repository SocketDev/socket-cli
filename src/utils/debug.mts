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

import {
  debugDir as debugDirOriginal,
  debugFn as debugFnOriginal,
  debugLog,
  isDebug as isDebugOriginal,
} from '@socketsecurity/registry/lib/debug'

/**
 * Wrapper for isDebug that maintains backward compatibility.
 * isDebugOriginal is a function that returns boolean.
 */
function isDebug(_namespace: string): boolean {
  return isDebugOriginal()
}

/**
 * Wrapper for debugFn that maintains backward compatibility.
 * The new API returns a function, so we call it immediately with the message.
 */
function debugFn(namespace: string, ...args: any[]): void {
  const debug = debugFnOriginal(namespace)
  if (debug?.enabled) {
    debug(...args)
  }
}

/**
 * Wrapper for debugDir that maintains backward compatibility.
 * The new API doesn't take a namespace, so we log it separately if needed.
 */
function debugDir(namespace: string, obj: any): void {
  if (isDebug(namespace)) {
    debugLog(`[${namespace}]`)
    debugDirOriginal(obj)
  }
}

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
    debugDir('error', {
      endpoint,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
  } else if (status && status >= 400) {
    debugFn('warn', `API ${endpoint}: HTTP ${status}`)
    /* c8 ignore next 3 */
  } else if (isDebug('notice')) {
    debugFn('notice', `API ${endpoint}: ${status || 'pending'}`)
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
    /* c8 ignore next 3 */
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
    /* c8 ignore next 3 */
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

export { debugDir, debugFn, debugLog, isDebug }
