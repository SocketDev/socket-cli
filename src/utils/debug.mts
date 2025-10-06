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
 * OPT-IN ONLY (require explicit DEBUG='category'):
 * - 'inspect': Detailed object inspection
 * - 'stdio': Command execution logs
 * - 'cache': Cache hit/miss operations
 * - 'network': HTTP requests with timing
 * - 'command': External command execution
 * - 'auth': Authentication flow
 * - 'perf': Performance timing
 * - 'spinner': Spinner state changes
 *
 * Usage Examples:
 * - DEBUG=cache socket scan         # Cache debugging only
 * - DEBUG=network,cache socket scan # Multiple categories
 * - DEBUG=* socket scan              # All categories
 * - SOCKET_CLI_DEBUG=1 socket scan  # Default categories
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
function debugFn(namespace: string, ...args: unknown[]): void {
  const debug = debugFnOriginal(namespace)
  if (debug?.enabled) {
    debug(...args)
  }
}

/**
 * Wrapper for debugDir that maintains backward compatibility.
 * The new API doesn't take a namespace, so we log it separately if needed.
 */
function debugDir(namespace: string, obj: unknown): void {
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
 * Format HTTP error information for debugging.
 * Logs date/time, method, URL, status, body, and cf-ray header.
 */
export function debugHttpError(error: unknown): void {
  if (!isDebug('error')) {
    return
  }

  const timestamp = new Date().toISOString()
  const errorInfo: Record<string, unknown> = {
    timestamp,
  }

  // Extract request information
  if (error && typeof error === 'object') {
    const err = error as any

    // Request details
    if (err.request) {
      errorInfo['method'] = err.request.method || 'GET'
      errorInfo['url'] = err.request.url || err.request.uri || 'unknown'
    } else if (err.config) {
      // Axios-style error
      errorInfo['method'] = err.config.method?.toUpperCase() || 'GET'
      errorInfo['url'] = err.config.url || 'unknown'
    }

    // Response details
    if (err.response) {
      errorInfo['status'] = err.response.status || err.response.statusCode
      errorInfo['statusText'] = err.response.statusText || ''

      // Response body
      if (err.response.data) {
        errorInfo['body'] = err.response.data
      } else if (err.response.body) {
        errorInfo['body'] = err.response.body
      }

      // Cloudflare ray ID for debugging
      if (err.response.headers) {
        const cfRay =
          err.response.headers['cf-ray'] || err.response.headers['CF-RAY']
        if (cfRay) {
          errorInfo['cfRay'] = cfRay
        }
      }
    } else if (err.statusCode) {
      errorInfo['status'] = err.statusCode
    }

    // Error message
    if (err.message) {
      errorInfo['message'] = err.message
    }
  }

  debugFn('error', 'HTTP request failed:')
  debugDir('error', errorInfo)
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

/**
 * Performance timer for measuring operation duration.
 * Returns a stop function that logs the elapsed time.
 *
 * @example
 * const stop = debugTimer('api-call', 'Fetching packages')
 * await fetchPackages()
 * stop() // Logs: "api-call: Fetching packages completed in 234ms"
 */
export function debugTimer(namespace: string, label: string): () => void {
  if (!isDebug(namespace) && !isDebug('perf')) {
    // No-op if debug disabled
    return () => {}
  }

  const start = performance.now()
  debugFn(namespace, `${label} started...`)

  return () => {
    const duration = Math.round(performance.now() - start)
    debugFn(namespace, `${label} completed in ${duration}ms`)
  }
}

/**
 * Debug cache operations with hit/miss tracking.
 */
export function debugCache(
  operation: 'hit' | 'miss' | 'set' | 'clear',
  key: string,
  details?: Record<string, unknown> | undefined,
): void {
  if (!isDebug('cache')) {
    return
  }

  const message = `Cache ${operation}: ${key}`

  if (details) {
    debugDir('cache', { operation, key, ...details })
  } else {
    debugFn('cache', message)
  }
}

/**
 * Debug command execution with timing.
 */
export function debugCommand(
  command: string,
  args: string[],
  result?: { exitCode?: number; duration?: number } | undefined,
): void {
  if (!isDebug('command')) {
    return
  }

  const fullCommand = `${command} ${args.join(' ')}`

  if (result) {
    const { duration, exitCode = 0 } = result
    const status = exitCode === 0 ? 'success' : 'failed'
    const timing = duration ? ` (${Math.round(duration)}ms)` : ''
    debugFn('command', `Command ${status}: ${fullCommand}${timing}`)
  } else {
    debugFn('command', `Executing: ${fullCommand}`)
  }
}

/**
 * Debug authentication flow.
 */
export function debugAuth(
  stage: 'start' | 'token_found' | 'token_missing' | 'validated' | 'failed',
  details?: Record<string, unknown> | undefined,
): void {
  if (!isDebug('auth')) {
    return
  }

  const messages = {
    start: 'Authentication check started',
    token_found: 'API token found',
    token_missing: 'API token not found',
    validated: 'API token validated successfully',
    failed: 'Authentication failed',
  }

  debugFn('auth', messages[stage])

  if (details) {
    debugDir('auth', details)
  }
}

/**
 * Debug network requests with detailed timing.
 */
export function debugNetwork(
  method: string,
  url: string,
  result?:
    | {
        status?: number
        duration?: number
        cached?: boolean
        error?: unknown
      }
    | undefined,
): void {
  if (!isDebug('network')) {
    return
  }

  const request = `${method} ${url}`

  if (result) {
    const { cached, duration, error, status } = result

    if (error) {
      debugDir('network', {
        request,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    } else {
      const cacheStatus = cached ? ' [cached]' : ''
      const timing = duration ? ` (${Math.round(duration)}ms)` : ''
      debugFn('network', `${request} → ${status}${cacheStatus}${timing}`)
    }
  } else {
    debugFn('network', `→ ${request}`)
  }
}

/**
 * Debug spinner state changes.
 */
export function debugSpinner(
  action: 'start' | 'update' | 'stop' | 'fail' | 'succeed',
  text?: string | undefined,
): void {
  if (!isDebug('spinner')) {
    return
  }

  const message = text ? `Spinner ${action}: ${text}` : `Spinner ${action}`
  debugFn('spinner', message)
}

export { debugDir, debugFn, debugLog, isDebug }
