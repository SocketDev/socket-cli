/**
 * Debug utilities for Socket CLI. Provides structured debugging with
 * categorized levels and helpers.
 *
 * Debug Categories: DEFAULT (shown with SOCKET_CLI_DEBUG=1):
 *
 * - 'error': Critical errors that prevent operation
 * - 'warn': Important warnings that may affect behavior
 * - 'notice': Notable events and state changes
 * - 'silly': Very verbose debugging info
 *
 * OPT-IN ONLY (require explicit DEBUG='category' even with SOCKET_CLI_DEBUG=1):
 *
 * - 'inspect': Detailed object inspection (DEBUG='inspect' or DEBUG='*')
 * - 'stdio': Command execution logs (DEBUG='stdio' or DEBUG='*')
 *
 * These opt-in categories are intentionally excluded from default debug output
 * to reduce noise. Enable them explicitly when needed for deep debugging.
 */

import {
  debug,
  debugCache,
  debugDir,
  debugDirNs,
  debugNs,
  isDebug,
  isDebugNs,
} from '@socketsecurity/lib-stable/debug'
import { errorMessage } from '@socketsecurity/lib-stable/errors'
export type ApiRequestDebugInfo = {
  durationMs?: number | undefined
  headers?: Record<string, string> | undefined
  method?: string | undefined
  // ISO-8601 timestamp of when the request was initiated. Useful when
  // correlating failures with server-side logs.
  requestedAt?: string | undefined
  // Response body string; truncated by the helper to a safe length so
  // logs don't balloon on megabyte payloads.
  responseBody?: string | undefined
  // Response headers from the failed request. The helper extracts the
  // cf-ray trace id as a first-class field so support can look it up in
  // the Cloudflare dashboard without eyeballing the whole header dump.
  responseHeaders?: Record<string, string> | undefined
  url?: string | undefined
}

const RESPONSE_BODY_TRUNCATE_LENGTH = 2_000

/**
 * Build the structured debug payload shared by the error + failure-status
 * branches of `debugApiResponse`. Extracted so both paths log the same shape.
 */
export function buildApiDebugDetails(
  base: Record<string, unknown>,
  requestInfo?: ApiRequestDebugInfo | undefined,
): Record<string, unknown> {
  // `__proto__: null` keeps the payload free of prototype-chain keys
  // when callers iterate over the debug output.
  const details: Record<string, unknown> = {
    __proto__: null,
    ...base,
  } as Record<string, unknown>
  if (!requestInfo) {
    return details
  }
  if (requestInfo.requestedAt) {
    details['requestedAt'] = requestInfo.requestedAt
  }
  if (requestInfo.method) {
    details['method'] = requestInfo.method
  }
  if (requestInfo.url) {
    details['url'] = requestInfo.url
  }
  if (requestInfo.durationMs !== undefined) {
    details['durationMs'] = requestInfo.durationMs
  }
  if (requestInfo.headers) {
    details['headers'] = sanitizeHeaders(requestInfo.headers)
  }
  if (requestInfo.responseHeaders) {
    const cfRay =
      requestInfo.responseHeaders['cf-ray'] ??
      requestInfo.responseHeaders['CF-Ray']
    if (cfRay) {
      // First-class field so it's obvious when filing a support ticket
      // that points at a Cloudflare trace.
      details['cfRay'] = cfRay
    }
    details['responseHeaders'] = sanitizeHeaders(requestInfo.responseHeaders)
  }
  if (requestInfo.responseBody !== undefined) {
    const body = requestInfo.responseBody
    // `.length` / `.slice` operate on UTF-16 code units, not bytes, so
    // the counter and truncation are both reported in "chars" to stay
    // consistent with what we actually measured.
    details['responseBody'] =
      body.length > RESPONSE_BODY_TRUNCATE_LENGTH
        ? `${body.slice(0, RESPONSE_BODY_TRUNCATE_LENGTH)}… (truncated, ${body.length} chars)`
        : body
  }
  return details
}

/**
 * Debug an API request start. Logs essential info without exposing sensitive
 * data.
 */
export function debugApiRequest(
  method: string,
  endpoint: string,
  timeout?: number | undefined,
): void {
  if (isDebugNs('silly')) {
    const timeoutStr = timeout !== undefined ? ` (timeout: ${timeout}ms)` : ''
    debugNs(
      'silly',
      `[${new Date().toISOString()}] request started: ${method} ${endpoint}${timeoutStr}`,
    )
  }
}

/**
 * Debug an API response. Failed requests (error or status >= 400) log under the
 * `error` namespace; successful responses optionally log a one-liner under
 * `notice`.
 *
 * Request and response headers are sanitized via `sanitizeHeaders` so
 * Authorization and `*api-key*` values are redacted.
 */
export function debugApiResponse(
  endpoint: string,
  status?: number | undefined,
  error?: unknown | undefined,
  requestInfo?: ApiRequestDebugInfo | undefined,
): void {
  if (error) {
    debugDirNs(
      'error',
      buildApiDebugDetails(
        {
          endpoint,
          error: errorMessage(error),
        },
        requestInfo,
      ),
    )
  } else if (status && status >= 400) {
    if (requestInfo) {
      debugDirNs(
        'error',
        buildApiDebugDetails({ endpoint, status }, requestInfo),
      )
    } else {
      debugNs('error', `API ${endpoint}: HTTP ${status}`)
    }
    /* c8 ignore start - notice-level debug ns rarely enabled in tests */
  } else if (isDebugNs('notice')) {
    debugNs('notice', `API ${endpoint}: ${status || 'pending'}`)
  }
  /* c8 ignore stop */
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
      error: errorMessage(error),
    })
  } else if (found) {
    debug(`Config loaded: ${source}`)
    /* c8 ignore start - silly-level debug ns rarely enabled in tests */
  } else if (isDebugNs('silly')) {
    debugNs('silly', `Config not found: ${source}`)
  }
  /* c8 ignore stop */
}

/**
 * Debug file operation. Logs file operations with appropriate level.
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
      error: errorMessage(error),
    })
    /* c8 ignore start - silly-level debug ns rarely enabled in tests */
  } else if (isDebugNs('silly')) {
    debugNs('silly', `File ${operation}: ${filepath}`)
  }
  /* c8 ignore stop */
}

/**
 * Debug git operations. Only logs important git operations, not every command.
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

/**
 * Debug package scanning. Provides insight into security scanning.
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
 * Sanitize headers to remove sensitive information. Redacts Authorization and
 * API key headers.
 *
 * Callers must gate truthy — passing an empty/undefined map skips the loop.
 */
export function sanitizeHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  const sanitized: Record<string, string> = Object.create(null)
  // oxlint-disable-next-line socket/prefer-cached-for-loop -- loop variable is destructured
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

export { debug, debugCache, debugDir, debugDirNs, debugNs, isDebug, isDebugNs }
