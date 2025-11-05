/**
 * @fileoverview HTTP client utilities for Socket API communication.
 * Provides low-level HTTP request handling with proper error management and response parsing.
 */

import http from 'node:http'
import https from 'node:https'

import { debugLog } from '@socketsecurity/lib/debug'
import { jsonParse } from '@socketsecurity/lib/json'
import { perfTimer } from '@socketsecurity/lib/performance'

import { MAX_RESPONSE_SIZE } from './constants'

import type {
  RequestOptions,
  SendMethod,
  SocketArtifactAlert,
  SocketArtifactWithExtras,
} from './types'
import type { ClientRequest, IncomingMessage } from 'node:http'

/**
 * HTTP response error for Socket API requests.
 * Extends Error with response details for debugging failed API calls.
 */
export class ResponseError extends Error {
  response: IncomingMessage

  /**
   * Create a new ResponseError from an HTTP response.
   * Automatically formats error message with status code and message.
   */
  constructor(response: IncomingMessage, message = '') {
    /* c8 ignore next 2 - statusCode and statusMessage may be undefined in edge cases */
    const statusCode = response.statusCode ?? 'unknown'
    const statusMessage = response.statusMessage ?? 'No status message'
    super(
      /* c8 ignore next - fallback empty message if not provided */
      `Socket API ${message || 'Request failed'} (${statusCode}): ${statusMessage}`,
    )
    this.name = 'ResponseError'
    this.response = response
    Error.captureStackTrace(this, ResponseError)
  }
}

/**
 * Create and execute an HTTP DELETE request.
 * Returns the response stream for further processing.
 *
 * @throws {Error} When network or timeout errors occur
 */
export async function createDeleteRequest(
  baseUrl: string,
  urlPath: string,
  options: RequestOptions,
): Promise<IncomingMessage> {
  const req = getHttpModule(baseUrl)
    .request(`${baseUrl}${urlPath}`, {
      method: 'DELETE',
      ...options,
    })
    .end()
  return await getResponse(req)
}

/**
 * Create and execute an HTTP GET request.
 * Returns the response stream for further processing.
 * Performance tracking enabled with DEBUG=perf.
 *
 * @throws {Error} When network or timeout errors occur
 */
export async function createGetRequest(
  baseUrl: string,
  urlPath: string,
  options: RequestOptions,
): Promise<IncomingMessage> {
  const stopTimer = perfTimer('http:get', { urlPath })
  try {
    const req = getHttpModule(baseUrl)
      .request(`${baseUrl}${urlPath}`, {
        method: 'GET',
        ...options,
      })
      .end()
    const response = await getResponse(req)
    stopTimer({ statusCode: response.statusCode })
    return response
  } catch (error) {
    stopTimer({ error: true })
    throw error
  }
}

/**
 * Create and execute an HTTP request with JSON payload.
 * Automatically sets appropriate content headers and serializes the body.
 * Performance tracking enabled with DEBUG=perf.
 *
 * @throws {Error} When network or timeout errors occur
 */
export async function createRequestWithJson(
  method: SendMethod,
  baseUrl: string,
  urlPath: string,
  json: unknown,
  options: RequestOptions,
): Promise<IncomingMessage> {
  const stopTimer = perfTimer(`http:${method.toLowerCase()}`, {
    urlPath,
  })
  try {
    const body = JSON.stringify(json)
    const req = getHttpModule(baseUrl).request(`${baseUrl}${urlPath}`, {
      method,
      ...options,
      headers: {
        ...options.headers,
        'Content-Length': Buffer.byteLength(body, 'utf8'),
        'Content-Type': 'application/json',
      },
    })

    req.write(body)
    req.end()

    const response = await getResponse(req)
    stopTimer({ statusCode: response.statusCode })
    return response
  } catch (error) {
    stopTimer({ error: true })
    throw error
  }
}

/**
 * Read the response body from an HTTP error response.
 * Accumulates all chunks into a complete string for error handling.
 * Enforces maximum response size to prevent memory exhaustion.
 *
 * @throws {Error} When stream errors occur during reading
 * @throws {Error} When response exceeds maximum size limit
 */
export async function getErrorResponseBody(
  response: IncomingMessage,
): Promise<string> {
  return await new Promise((resolve, reject) => {
    let body = ''
    let totalBytes = 0

    response.setEncoding('utf8')

    response.on('data', (chunk: string) => {
      // Track size in bytes (not characters) for accurate limit enforcement
      const chunkBytes = Buffer.byteLength(chunk, 'utf8')
      totalBytes += chunkBytes

      if (totalBytes > MAX_RESPONSE_SIZE) {
        // Destroy the response stream to stop receiving data
        response.destroy()
        const sizeMB = (totalBytes / (1024 * 1024)).toFixed(2)
        const maxMB = (MAX_RESPONSE_SIZE / (1024 * 1024)).toFixed(2)
        const message = [
          `Response exceeds maximum size limit (${sizeMB}MB > ${maxMB}MB)`,
          '→ The API response is too large to process safely.',
          '→ Try: Use pagination parameters (limit, offset) to reduce response size.',
          '→ Try: Request specific fields instead of full objects.',
          '→ Contact support if you need to process larger responses.',
        ].join('\n')
        reject(new Error(message))
        return
      }

      body += chunk
    })

    response.on('end', () => resolve(body))
    response.on('error', e => reject(e))
  })
}

/**
 * Get the appropriate HTTP module based on URL protocol.
 * Returns http module for http: URLs, https module for https: URLs.
 */
export function getHttpModule(url: string): typeof http | typeof https {
  return url.startsWith('https:') ? https : http
}

/**
 * Wait for and return the HTTP response from a request.
 * Handles timeout and error conditions during request processing.
 *
 * @throws {Error} When request times out or network errors occur
 */
export async function getResponse(
  req: ClientRequest,
): Promise<IncomingMessage> {
  return await new Promise((resolve, reject) => {
    let timedOut = false
    req.on('response', (response: IncomingMessage) => {
      /* c8 ignore next 3 - Race condition where response arrives after timeout. */
      if (timedOut) {
        return
      }
      resolve(response)
    })
    req.on('timeout', () => {
      timedOut = true
      req.destroy()
      // Extract request details for better error context.
      const method = (req as any).method || 'REQUEST'
      const path = (req as any).path || 'unknown'
      const timeout = (req as any).timeout || 'configured timeout'
      const message = [
        `${method} request timed out after ${timeout}ms: ${path}`,
        '→ The Socket API did not respond in time.',
        '→ Try: Increase timeout option or check network connectivity.',
        '→ If problem persists, Socket API may be experiencing issues.',
      ].join('\n')
      reject(new Error(message))
    })
    req.on('error', e => {
      if (!timedOut) {
        const err = e as NodeJS.ErrnoException
        const method = (req as any).method || 'REQUEST'
        const path = (req as any).path || 'unknown'
        let message = `${method} request failed: ${path}`

        // Provide specific guidance based on error code.
        if (err.code === 'ECONNREFUSED') {
          message += [
            '',
            '→ Connection refused. Socket API server is unreachable.',
            '→ Check: Network connectivity and firewall settings.',
            '→ Verify: Base URL is correct (default: https://api.socket.dev)',
          ].join('\n')
        } else if (err.code === 'ENOTFOUND') {
          message += [
            '',
            '→ DNS lookup failed. Cannot resolve hostname.',
            '→ Check: Internet connection and DNS settings.',
            '→ Verify: Base URL hostname is correct.',
          ].join('\n')
        } else if (err.code === 'ETIMEDOUT') {
          message += [
            '',
            '→ Connection timed out. Network or server issue.',
            '→ Try: Check network connectivity and retry.',
            '→ If using proxy, verify proxy configuration.',
          ].join('\n')
        } else if (err.code === 'ECONNRESET') {
          message += [
            '',
            '→ Connection reset by server. Possible network interruption.',
            '→ Try: Retry the request. Enable retries option if not set.',
          ].join('\n')
        } else if (err.code === 'EPIPE') {
          message += [
            '',
            '→ Broken pipe. Server closed connection unexpectedly.',
            '→ Possible: Authentication issue or server error.',
            '→ Check: API token is valid and has required permissions.',
          ].join('\n')
        } else if (
          err.code === 'CERT_HAS_EXPIRED' ||
          err.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'
        ) {
          message += [
            '',
            '→ SSL/TLS certificate error.',
            '→ Check: System time and date are correct.',
            '→ Try: Update CA certificates on your system.',
          ].join('\n')
        } else if (err.code) {
          message += `\n→ Error code: ${err.code}`
        }

        const enhancedError = new Error(message, { cause: e })
        reject(enhancedError)
      }
    })
  })
}

/**
 * Parse HTTP response body as JSON.
 * Validates response status and handles empty responses gracefully.
 * Performance tracking enabled with DEBUG=perf.
 *
 * @throws {ResponseError} When response has non-2xx status code
 * @throws {SyntaxError} When response body contains invalid JSON
 */
export async function getResponseJson(
  response: IncomingMessage,
  method?: string | undefined,
) {
  const stopTimer = perfTimer('http:parse-json')
  try {
    if (!isResponseOk(response)) {
      throw new ResponseError(
        response,
        method ? `${method} Request failed` : undefined,
      )
    }
    const responseBody = await getErrorResponseBody(response)

    // Handle truly empty responses (not whitespace) as valid empty objects.
    if (responseBody === '') {
      debugLog('API response: empty response treated as {}')
      stopTimer({ success: true })
      return {}
    }

    try {
      const responseJson = jsonParse(responseBody)
      debugLog('API response:', responseJson)
      stopTimer({ success: true })
      return responseJson
    } catch (e) {
      stopTimer({ error: true })
      if (e instanceof SyntaxError) {
        // Attach the original response text for better error reporting.
        const contentType = response.headers['content-type']
        const preview =
          responseBody.length > 200
            ? `${responseBody.slice(0, 200)}...`
            : responseBody
        const messageParts = [
          'Socket API returned invalid JSON response',
          `→ Response preview: ${preview}`,
          `→ Parse error: ${e.message}`,
        ]

        // Add helpful hints based on response characteristics.
        if (contentType && !contentType.includes('application/json')) {
          messageParts.push(
            `→ Unexpected Content-Type: ${contentType} (expected application/json)`,
            '→ The API may have returned an error page instead of JSON.',
          )
        } else if (responseBody.startsWith('<')) {
          messageParts.push(
            '→ Response appears to be HTML, not JSON.',
            '→ This may indicate an API endpoint error or network interception.',
          )
        } else if (responseBody.length === 0) {
          messageParts.push('→ Response body is empty when JSON was expected.')
        } else if (
          responseBody.includes('502 Bad Gateway') ||
          responseBody.includes('503 Service')
        ) {
          messageParts.push(
            '→ Response indicates a server error.',
            '→ The Socket API may be temporarily unavailable.',
          )
        }

        const enhancedError = new Error(messageParts.join('\n'), {
          cause: e,
        }) as SyntaxError & {
          originalResponse?: string | undefined
        }
        enhancedError.name = 'SyntaxError'
        enhancedError.originalResponse = responseBody
        Object.setPrototypeOf(enhancedError, SyntaxError.prototype)
        throw enhancedError
      }
      /* c8 ignore start - Error instanceof check and unknown error handling for JSON parsing edge cases. */
      if (e instanceof Error) {
        throw e
      }
      // Handle non-Error objects thrown by JSON parsing.
      const unknownError = new Error('Unknown JSON parsing error', {
        cause: e,
      }) as SyntaxError & {
        originalResponse?: string | undefined
      }
      unknownError.name = 'SyntaxError'
      unknownError.originalResponse = responseBody
      Object.setPrototypeOf(unknownError, SyntaxError.prototype)
      throw unknownError
      /* c8 ignore stop */
    }
  } catch (error) {
    stopTimer({ error: true })
    throw error
  }
}

/**
 * Check if HTTP response has a successful status code (2xx range).
 * Returns true for status codes between 200-299, false otherwise.
 */
export function isResponseOk(response: IncomingMessage): boolean {
  const { statusCode } = response
  /* c8 ignore next - Defensive fallback for edge cases where statusCode might be undefined. */
  return statusCode ? statusCode >= 200 && statusCode < 300 : false
}

/**
 * Transform artifact data based on authentication status.
 * Filters and compacts response data for public/free-tier users.
 */
export function reshapeArtifactForPublicPolicy<
  T extends Record<string, unknown>,
>(data: T, isAuthenticated: boolean, actions?: string | undefined): T {
  /* c8 ignore start - Public policy artifact reshaping for unauthenticated users, difficult to test edge cases. */
  // If user is not authenticated, provide a different response structure
  // optimized for the public free-tier experience.
  if (!isAuthenticated) {
    // Parse actions parameter for alert filtering.
    const allowedActions = actions ? actions.split(',') : undefined

    const reshapeArtifact = (artifact: SocketArtifactWithExtras) => ({
      name: artifact.name,
      version: artifact.version,
      size: artifact.size,
      author: artifact.author,
      type: artifact.type,
      supplyChainRisk: artifact.supplyChainRisk,
      scorecards: artifact.scorecards,
      topLevelAncestors: artifact.topLevelAncestors,
      // Compact the alerts array to reduce response size for non-authenticated
      // requests.
      alerts: artifact.alerts
        ?.filter((alert: SocketArtifactAlert) => {
          // Filter by severity (remove low severity alerts).
          if (alert.severity === 'low') {
            return false
          }
          // Filter by actions if specified.
          if (
            allowedActions &&
            alert.action &&
            !allowedActions.includes(alert.action)
          ) {
            return false
          }
          return true
        })
        .map((alert: SocketArtifactAlert) => ({
          type: alert.type,
          severity: alert.severity,
          key: alert.key,
        })),
    })

    // Handle both single artifacts and objects with artifacts arrays.
    if (data['artifacts']) {
      // Object with artifacts array.
      const artifacts = data['artifacts']
      return {
        ...data,
        artifacts: Array.isArray(artifacts)
          ? artifacts.map(reshapeArtifact)
          : artifacts,
      }
    }
    if (data['alerts']) {
      // Single artifact with alerts.
      return reshapeArtifact(
        data as unknown as SocketArtifactWithExtras,
      ) as unknown as T
    }
  }
  return data
  /* c8 ignore stop */
}

/**
 * Retry helper for HTTP requests with exponential backoff.
 * Wraps any async HTTP function and retries on failure.
 *
 * @param fn - Async function to retry
 * @param retries - Number of retry attempts (default: 0, retries disabled)
 * @param retryDelay - Initial delay in ms (default: 100)
 * @returns Result of the function call
 * @throws {Error} Last error if all retries exhausted
 */
/* c8 ignore start - Retry logic requires real network failures and timing behavior that's difficult to test reliably */
export async function withRetry<T>(
  fn: () => Promise<T>,
  retries = 0,
  retryDelay = 100,
): Promise<T> {
  let lastError: Error | undefined

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      // eslint-disable-next-line no-await-in-loop
      return await fn()
    } catch (error) {
      lastError = error as Error

      // Last attempt - throw error with retry context.
      if (attempt === retries) {
        const enhancedError = new Error(
          `Request failed after ${retries + 1} attempts`,
          { cause: lastError },
        )
        throw enhancedError
      }

      // Check if error is retryable (network errors, 5xx responses).
      if (error instanceof ResponseError) {
        const status = error.response.statusCode
        // Don't retry client errors (4xx).
        if (status && status >= 400 && status < 500) {
          throw error
        }
        debugLog(
          'withRetry',
          `Retrying after ${status} error (attempt ${attempt + 1}/${retries + 1})`,
        )
      } else {
        debugLog(
          'withRetry',
          `Retrying after network error (attempt ${attempt + 1}/${retries + 1})`,
        )
      }

      // Exponential backoff.
      const delayMs = retryDelay * 2 ** attempt
      debugLog('withRetry', `Waiting ${delayMs}ms before retry`)
      // eslint-disable-next-line no-await-in-loop
      await new Promise(resolve => setTimeout(resolve, delayMs))
    }
  }

  // Fallback error if lastError is somehow undefined.
  throw lastError || new Error('Request failed after retries')
}
/* c8 ignore stop */

/**
 * Create GET request with automatic retry logic.
 * Retries on network errors and 5xx responses.
 *
 * @param retries - Number of retry attempts (default: 0, retries disabled)
 * @param retryDelay - Initial delay in ms (default: 100)
 */
/* c8 ignore start - Retry wrapper depends on withRetry which is already ignored */
export async function createGetRequestWithRetry(
  baseUrl: string,
  urlPath: string,
  options: RequestOptions,
  retries = 0,
  retryDelay = 100,
): Promise<IncomingMessage> {
  return await withRetry(
    () => createGetRequest(baseUrl, urlPath, options),
    retries,
    retryDelay,
  )
}
/* c8 ignore stop */

/**
 * Create DELETE request with automatic retry logic.
 * Retries on network errors and 5xx responses.
 *
 * @param retries - Number of retry attempts (default: 0, retries disabled)
 * @param retryDelay - Initial delay in ms (default: 100)
 */
/* c8 ignore start - Retry wrapper depends on withRetry which is already ignored */
export async function createDeleteRequestWithRetry(
  baseUrl: string,
  urlPath: string,
  options: RequestOptions,
  retries = 0,
  retryDelay = 100,
): Promise<IncomingMessage> {
  return await withRetry(
    () => createDeleteRequest(baseUrl, urlPath, options),
    retries,
    retryDelay,
  )
}
/* c8 ignore stop */

/**
 * Create request with JSON payload and automatic retry logic.
 * Retries on network errors and 5xx responses.
 *
 * @param retries - Number of retry attempts (default: 0, retries disabled)
 * @param retryDelay - Initial delay in ms (default: 100)
 */
/* c8 ignore start - Retry wrapper depends on withRetry which is already ignored */
export async function createRequestWithJsonAndRetry(
  method: SendMethod,
  baseUrl: string,
  urlPath: string,
  json: unknown,
  options: RequestOptions,
  retries = 0,
  retryDelay = 100,
): Promise<IncomingMessage> {
  return await withRetry(
    () => createRequestWithJson(method, baseUrl, urlPath, json, options),
    retries,
    retryDelay,
  )
}
/* c8 ignore stop */
