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

import type { SpawnResult } from '@socketsecurity/registry/lib/spawn'

/**
 * Debug result of a spawn command.
 * Only logs if stdio debugging is explicitly enabled.
 */
export function debugSpawnResult(
  command: string,
  args: string[],
  result?: SpawnResult | Error,
): void {
  if (!isDebug('stdio')) {
    return
  }

  const cmd = `${command} ${args.join(' ')}`
  if (result instanceof Error) {
    debugDir('stdio', {
      cmd,
      error: result.message,
      code: (result as any).code,
    })
  } else if (result) {
    debugDir('stdio', {
      cmd,
      stdout: result.stdout?.slice(0, 200),
      stderr: result.stderr?.slice(0, 200),
      exitCode: result.exitCode,
    })
  }
}

/**
 * Debug an operation with timing information.
 * Useful for performance debugging.
 */
export function debugTiming(
  operation: string,
  startTime: number,
  success = true,
): void {
  const duration = Date.now() - startTime
  if (duration > 1000) {
    // Log slow operations as warnings.
    debugFn('warn', `Slow operation: ${operation} took ${duration}ms`)
  } else if (isDebug('notice')) {
    debugFn('notice', `${operation}: ${duration}ms ${success ? '✓' : '✗'}`)
  }
}

/**
 * Debug an API response.
 * Logs essential info without exposing sensitive data.
 */
export function debugApiResponse(
  endpoint: string,
  status?: number,
  error?: unknown,
): void {
  if (error) {
    debugDir('error', {
      endpoint,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
  } else if (status && status >= 400) {
    debugFn('warn', `API ${endpoint}: HTTP ${status}`)
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
  error?: unknown,
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
 * Debug a cache hit/miss.
 * Useful for understanding cache behavior.
 */
export function debugCache(
  key: string,
  hit: boolean,
  details?: Record<string, unknown>,
): void {
  if (isDebug('notice')) {
    if (hit) {
      debugFn('notice', `Cache hit: ${key}`)
    } else {
      debugFn('notice', `Cache miss: ${key}`)
      if (details && isDebug('inspect')) {
        debugDir('inspect', details)
      }
    }
  }
}

/**
 * Debug package scanning.
 * Provides insight into security scanning.
 */
export function debugScan(
  phase: 'start' | 'progress' | 'complete' | 'error',
  packageCount?: number,
  details?: unknown,
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
      debugFn('notice', `Scan complete${packageCount ? `: ${packageCount} packages` : ''}`)
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
  error?: unknown,
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
  details?: Record<string, unknown>,
): void {
  if (!success) {
    debugDir('warn', {
      git_op: operation,
      ...details,
    })
  } else if (isDebug('notice') && operation.includes('push') || operation.includes('commit')) {
    // Only log important operations like push and commit.
    debugFn('notice', `Git ${operation} succeeded`)
  } else if (isDebug('silly')) {
    debugFn('silly', `Git ${operation}`)
  }
}

/**
 * Create a debug context for complex operations.
 * Tracks operation lifecycle with consistent logging.
 */
export class DebugContext {
  private startTime: number
  private phase = 'init'

  constructor(private operation: string) {
    this.startTime = Date.now()
    if (isDebug('notice')) {
      debugFn('notice', `${operation}: starting`)
    }
  }

  progress(message: string, details?: unknown): void {
    this.phase = 'progress'
    if (isDebug('silly')) {
      debugFn('silly', `${this.operation}: ${message}`)
      if (details && isDebug('inspect')) {
        debugDir('inspect', details)
      }
    }
  }

  warn(message: string, error?: unknown): void {
    debugFn('warn', `${this.operation}: ${message}`)
    if (error) {
      debugDir('warn', error)
    }
  }

  error(message: string, error: unknown): void {
    this.phase = 'error'
    debugFn('error', `${this.operation}: ${message}`)
    debugDir('error', {
      operation: this.operation,
      phase: this.phase,
      error,
    })
  }

  complete(success = true, summary?: string): void {
    this.phase = 'complete'
    const duration = Date.now() - this.startTime

    if (duration > 5000) {
      debugFn('warn', `${this.operation}: slow (${duration}ms)`)
    } else if (isDebug('notice')) {
      const status = success ? 'completed' : 'failed'
      const message = summary
        ? `${this.operation}: ${status} - ${summary} (${duration}ms)`
        : `${this.operation}: ${status} (${duration}ms)`
      debugFn('notice', message)
    }
  }
}

export { debugDir, debugFn, isDebug }