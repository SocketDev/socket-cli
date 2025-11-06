/**
 * @fileoverview HTTP/HTTPS request utilities using Node.js built-in modules with retry logic, redirects, and download support.
 *
 * This module provides a fetch-like API built on top of Node.js native `http` and `https` modules.
 * It supports automatic retries with exponential backoff, redirect following, streaming downloads,
 * and provides a familiar fetch-style response interface.
 *
 * Key Features:
 * - Automatic retries with exponential backoff for failed requests.
 * - Redirect following with configurable max redirects.
 * - Streaming downloads with progress callbacks.
 * - Fetch-like response interface (`.json()`, `.text()`, `.arrayBuffer()`).
 * - Timeout support for all operations.
 * - Zero dependencies on external HTTP libraries.
 */

import { createWriteStream } from 'fs'

import type { IncomingMessage } from 'http'

let _http: typeof import('http') | undefined
let _https: typeof import('https') | undefined
/**
 * Lazily load http and https modules to avoid Webpack errors.
 * @private
 */
/*@__NO_SIDE_EFFECTS__*/
function getHttp() {
  if (_http === undefined) {
    // Use non-'node:' prefixed require to avoid Webpack errors.

    _http = /*@__PURE__*/ require('node:http')
  }
  return _http as typeof import('http')
}

/*@__NO_SIDE_EFFECTS__*/
function getHttps() {
  if (_https === undefined) {
    // Use non-'node:' prefixed require to avoid Webpack errors.

    _https = /*@__PURE__*/ require('node:https')
  }
  return _https as typeof import('https')
}

/**
 * Configuration options for HTTP/HTTPS requests.
 */
export interface HttpRequestOptions {
  /**
   * Request body to send.
   * Can be a string (e.g., JSON) or Buffer (e.g., binary data).
   *
   * @example
   * ```ts
   * // Send JSON data
   * await httpRequest('https://api.example.com/data', {
   *   method: 'POST',
   *   body: JSON.stringify({ name: 'Alice' }),
   *   headers: { 'Content-Type': 'application/json' }
   * })
   *
   * // Send binary data
   * const buffer = Buffer.from([0x00, 0x01, 0x02])
   * await httpRequest('https://api.example.com/upload', {
   *   method: 'POST',
   *   body: buffer
   * })
   * ```
   */
  body?: Buffer | string | undefined
  /**
   * Whether to automatically follow HTTP redirects (3xx status codes).
   *
   * @default true
   *
   * @example
   * ```ts
   * // Follow redirects (default)
   * await httpRequest('https://example.com/redirect')
   *
   * // Don't follow redirects
   * const response = await httpRequest('https://example.com/redirect', {
   *   followRedirects: false
   * })
   * console.log(response.status) // 301 or 302
   * ```
   */
  followRedirects?: boolean | undefined
  /**
   * HTTP headers to send with the request.
   * A `User-Agent` header is automatically added if not provided.
   *
   * @example
   * ```ts
   * await httpRequest('https://api.example.com/data', {
   *   headers: {
   *     'Authorization': 'Bearer token123',
   *     'Content-Type': 'application/json',
   *     'Accept': 'application/json'
   *   }
   * })
   * ```
   */
  headers?: Record<string, string> | undefined
  /**
   * Maximum number of redirects to follow before throwing an error.
   * Only relevant when `followRedirects` is `true`.
   *
   * @default 5
   *
   * @example
   * ```ts
   * // Allow up to 10 redirects
   * await httpRequest('https://example.com/many-redirects', {
   *   maxRedirects: 10
   * })
   * ```
   */
  maxRedirects?: number | undefined
  /**
   * HTTP method to use for the request.
   *
   * @default 'GET'
   *
   * @example
   * ```ts
   * // GET request (default)
   * await httpRequest('https://api.example.com/data')
   *
   * // POST request
   * await httpRequest('https://api.example.com/data', {
   *   method: 'POST',
   *   body: JSON.stringify({ name: 'Alice' })
   * })
   *
   * // DELETE request
   * await httpRequest('https://api.example.com/data/123', {
   *   method: 'DELETE'
   * })
   * ```
   */
  method?: string | undefined
  /**
   * Number of retry attempts for failed requests.
   * Uses exponential backoff: delay = `retryDelay` * 2^attempt.
   *
   * @default 0
   *
   * @example
   * ```ts
   * // Retry up to 3 times with exponential backoff
   * await httpRequest('https://api.example.com/data', {
   *   retries: 3,
   *   retryDelay: 1000 // 1s, then 2s, then 4s
   * })
   * ```
   */
  retries?: number | undefined
  /**
   * Initial delay in milliseconds before first retry.
   * Subsequent retries use exponential backoff.
   *
   * @default 1000
   *
   * @example
   * ```ts
   * // Start with 2 second delay, then 4s, 8s, etc.
   * await httpRequest('https://api.example.com/data', {
   *   retries: 3,
   *   retryDelay: 2000
   * })
   * ```
   */
  retryDelay?: number | undefined
  /**
   * Request timeout in milliseconds.
   * If the request takes longer than this, it will be aborted.
   *
   * @default 30000
   *
   * @example
   * ```ts
   * // 60 second timeout
   * await httpRequest('https://api.example.com/slow-endpoint', {
   *   timeout: 60000
   * })
   * ```
   */
  timeout?: number | undefined
}

/**
 * HTTP response object with fetch-like interface.
 * Provides multiple ways to access the response body.
 */
export interface HttpResponse {
  /**
   * Get response body as ArrayBuffer.
   * Useful for binary data or when you need compatibility with browser APIs.
   *
   * @returns The response body as an ArrayBuffer
   *
   * @example
   * ```ts
   * const response = await httpRequest('https://example.com/image.png')
   * const arrayBuffer = response.arrayBuffer()
   * console.log(arrayBuffer.byteLength)
   * ```
   */
  arrayBuffer(): ArrayBuffer
  /**
   * Raw response body as Buffer.
   * Direct access to the underlying Node.js Buffer.
   *
   * @example
   * ```ts
   * const response = await httpRequest('https://example.com/data')
   * console.log(response.body.length) // Size in bytes
   * console.log(response.body.toString('hex')) // View as hex
   * ```
   */
  body: Buffer
  /**
   * HTTP response headers.
   * Keys are lowercase header names, values can be strings or string arrays.
   *
   * @example
   * ```ts
   * const response = await httpRequest('https://example.com')
   * console.log(response.headers['content-type'])
   * console.log(response.headers['set-cookie']) // May be string[]
   * ```
   */
  headers: Record<string, string | string[] | undefined>
  /**
   * Parse response body as JSON.
   * Type parameter `T` allows specifying the expected JSON structure.
   *
   * @template T - Expected JSON type (defaults to `unknown`)
   * @returns Parsed JSON data
   * @throws {SyntaxError} When response body is not valid JSON
   *
   * @example
   * ```ts
   * interface User { name: string; id: number }
   * const response = await httpRequest('https://api.example.com/user')
   * const user = response.json<User>()
   * console.log(user.name, user.id)
   * ```
   */
  json<T = unknown>(): T
  /**
   * Whether the request was successful (status code 200-299).
   *
   * @example
   * ```ts
   * const response = await httpRequest('https://example.com/data')
   * if (response.ok) {
   *   console.log('Success:', response.json())
   * } else {
   *   console.error('Failed:', response.status, response.statusText)
   * }
   * ```
   */
  ok: boolean
  /**
   * HTTP status code (e.g., 200, 404, 500).
   *
   * @example
   * ```ts
   * const response = await httpRequest('https://example.com')
   * console.log(response.status) // 200, 404, etc.
   * ```
   */
  status: number
  /**
   * HTTP status message (e.g., "OK", "Not Found", "Internal Server Error").
   *
   * @example
   * ```ts
   * const response = await httpRequest('https://example.com')
   * console.log(response.statusText) // "OK"
   * ```
   */
  statusText: string
  /**
   * Get response body as UTF-8 text string.
   *
   * @returns The response body as a string
   *
   * @example
   * ```ts
   * const response = await httpRequest('https://example.com')
   * const html = response.text()
   * console.log(html.includes('<html>'))
   * ```
   */
  text(): string
}

/**
 * Configuration options for file downloads.
 */
export interface HttpDownloadOptions {
  /**
   * HTTP headers to send with the download request.
   * A `User-Agent` header is automatically added if not provided.
   *
   * @example
   * ```ts
   * await httpDownload('https://example.com/file.zip', '/tmp/file.zip', {
   *   headers: {
   *     'Authorization': 'Bearer token123'
   *   }
   * })
   * ```
   */
  headers?: Record<string, string> | undefined
  /**
   * Callback for tracking download progress.
   * Called periodically as data is received.
   *
   * @param downloaded - Number of bytes downloaded so far
   * @param total - Total file size in bytes (from Content-Length header)
   *
   * @example
   * ```ts
   * await httpDownload('https://example.com/large-file.zip', '/tmp/file.zip', {
   *   onProgress: (downloaded, total) => {
   *     const percent = ((downloaded / total) * 100).toFixed(1)
   *     console.log(`Progress: ${percent}%`)
   *   }
   * })
   * ```
   */
  onProgress?: ((downloaded: number, total: number) => void) | undefined
  /**
   * Number of retry attempts for failed downloads.
   * Uses exponential backoff: delay = `retryDelay` * 2^attempt.
   *
   * @default 0
   *
   * @example
   * ```ts
   * // Retry up to 3 times for unreliable connections
   * await httpDownload('https://example.com/file.zip', '/tmp/file.zip', {
   *   retries: 3,
   *   retryDelay: 2000
   * })
   * ```
   */
  retries?: number | undefined
  /**
   * Initial delay in milliseconds before first retry.
   * Subsequent retries use exponential backoff.
   *
   * @default 1000
   */
  retryDelay?: number | undefined
  /**
   * Download timeout in milliseconds.
   * If the download takes longer than this, it will be aborted.
   *
   * @default 120000
   *
   * @example
   * ```ts
   * // 5 minute timeout for large files
   * await httpDownload('https://example.com/huge-file.zip', '/tmp/file.zip', {
   *   timeout: 300000
   * })
   * ```
   */
  timeout?: number | undefined
}

/**
 * Result of a successful file download.
 */
export interface HttpDownloadResult {
  /**
   * Absolute path where the file was saved.
   *
   * @example
   * ```ts
   * const result = await httpDownload('https://example.com/file.zip', '/tmp/file.zip')
   * console.log(`Downloaded to: ${result.path}`)
   * ```
   */
  path: string
  /**
   * Total size of downloaded file in bytes.
   *
   * @example
   * ```ts
   * const result = await httpDownload('https://example.com/file.zip', '/tmp/file.zip')
   * console.log(`Downloaded ${result.size} bytes`)
   * ```
   */
  size: number
}

/**
 * Make an HTTP/HTTPS request with retry logic and redirect support.
 * Provides a fetch-like API using Node.js native http/https modules.
 *
 * This is the main entry point for making HTTP requests. It handles retries,
 * redirects, timeouts, and provides a fetch-compatible response interface.
 *
 * @param url - The URL to request (must start with http:// or https://)
 * @param options - Request configuration options
 * @returns Promise resolving to response object with `.json()`, `.text()`, etc.
 * @throws {Error} When all retries are exhausted, timeout occurs, or non-retryable error happens
 *
 * @example
 * ```ts
 * // Simple GET request
 * const response = await httpRequest('https://api.example.com/data')
 * const data = response.json()
 *
 * // POST with JSON body
 * const response = await httpRequest('https://api.example.com/users', {
 *   method: 'POST',
 *   headers: { 'Content-Type': 'application/json' },
 *   body: JSON.stringify({ name: 'Alice', email: 'alice@example.com' })
 * })
 *
 * // With retries and timeout
 * const response = await httpRequest('https://api.example.com/data', {
 *   retries: 3,
 *   retryDelay: 1000,
 *   timeout: 60000
 * })
 *
 * // Don't follow redirects
 * const response = await httpRequest('https://example.com/redirect', {
 *   followRedirects: false
 * })
 * console.log(response.status) // 301, 302, etc.
 * ```
 */
export async function httpRequest(
  url: string,
  options?: HttpRequestOptions | undefined,
): Promise<HttpResponse> {
  const {
    body,
    followRedirects = true,
    headers = {},
    maxRedirects = 5,
    method = 'GET',
    retries = 0,
    retryDelay = 1000,
    timeout = 30_000,
  } = { __proto__: null, ...options } as HttpRequestOptions

  // Retry logic with exponential backoff
  let lastError: Error | undefined
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      // eslint-disable-next-line no-await-in-loop
      return await httpRequestAttempt(url, {
        body,
        followRedirects,
        headers,
        maxRedirects,
        method,
        timeout,
      })
    } catch (e) {
      lastError = e as Error

      // Last attempt - throw error
      if (attempt === retries) {
        break
      }

      // Retry with exponential backoff
      const delayMs = retryDelay * 2 ** attempt
      // eslint-disable-next-line no-await-in-loop
      await new Promise(resolve => setTimeout(resolve, delayMs))
    }
  }

  throw lastError || new Error('Request failed after retries')
}

/**
 * Single HTTP request attempt (used internally by httpRequest with retry logic).
 * @private
 */
async function httpRequestAttempt(
  url: string,
  options: HttpRequestOptions,
): Promise<HttpResponse> {
  const {
    body,
    followRedirects = true,
    headers = {},
    maxRedirects = 5,
    method = 'GET',
    timeout = 30_000,
  } = { __proto__: null, ...options } as HttpRequestOptions

  return await new Promise((resolve, reject) => {
    const parsedUrl = new URL(url)
    const isHttps = parsedUrl.protocol === 'https:'
    const httpModule = isHttps ? getHttps() : getHttp()

    const requestOptions = {
      headers: {
        'User-Agent': 'socket-registry/1.0',
        ...headers,
      },
      hostname: parsedUrl.hostname,
      method,
      path: parsedUrl.pathname + parsedUrl.search,
      port: parsedUrl.port,
      timeout,
    }

    const request = httpModule.request(
      requestOptions,
      (res: IncomingMessage) => {
        // Handle redirects
        if (
          followRedirects &&
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          if (maxRedirects <= 0) {
            reject(
              new Error(
                `Too many redirects (exceeded maximum: ${maxRedirects})`,
              ),
            )
            return
          }

          // Follow redirect
          const redirectUrl = res.headers.location.startsWith('http')
            ? res.headers.location
            : new URL(res.headers.location, url).toString()

          resolve(
            httpRequestAttempt(redirectUrl, {
              body,
              followRedirects,
              headers,
              maxRedirects: maxRedirects - 1,
              method,
              timeout,
            }),
          )
          return
        }

        // Collect response data
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => {
          chunks.push(chunk)
        })

        res.on('end', () => {
          const responseBody = Buffer.concat(chunks)
          const ok =
            res.statusCode !== undefined &&
            res.statusCode >= 200 &&
            res.statusCode < 300

          const response: HttpResponse = {
            arrayBuffer(): ArrayBuffer {
              return responseBody.buffer.slice(
                responseBody.byteOffset,
                responseBody.byteOffset + responseBody.byteLength,
              )
            },
            body: responseBody,
            headers: res.headers as Record<
              string,
              string | string[] | undefined
            >,
            json<T = unknown>(): T {
              return JSON.parse(responseBody.toString('utf8')) as T
            },
            ok,
            status: res.statusCode || 0,
            statusText: res.statusMessage || '',
            text(): string {
              return responseBody.toString('utf8')
            },
          }

          resolve(response)
        })
      },
    )

    request.on('error', (error: Error) => {
      const code = (error as NodeJS.ErrnoException).code
      let message = `HTTP request failed for ${url}: ${error.message}\n`

      if (code === 'ENOTFOUND') {
        message +=
          'DNS lookup failed. Check the hostname and your network connection.'
      } else if (code === 'ECONNREFUSED') {
        message +=
          'Connection refused. Verify the server is running and accessible.'
      } else if (code === 'ETIMEDOUT') {
        message +=
          'Request timed out. Check your network or increase the timeout value.'
      } else if (code === 'ECONNRESET') {
        message +=
          'Connection reset. The server may have closed the connection unexpectedly.'
      } else {
        message +=
          'Check your network connection and verify the URL is correct.'
      }

      reject(new Error(message, { cause: error }))
    })

    request.on('timeout', () => {
      request.destroy()
      reject(new Error(`Request timed out after ${timeout}ms`))
    })

    // Send body if present
    if (body) {
      request.write(body)
    }

    request.end()
  })
}

/**
 * Download a file from a URL to a local path with retry logic and progress callbacks.
 * Uses streaming to avoid loading entire file in memory.
 *
 * The download is streamed directly to disk, making it memory-efficient even for
 * large files. Progress callbacks allow for real-time download status updates.
 *
 * @param url - The URL to download from (must start with http:// or https://)
 * @param destPath - Absolute path where the file should be saved
 * @param options - Download configuration options
 * @returns Promise resolving to download result with path and size
 * @throws {Error} When all retries are exhausted, download fails, or file cannot be written
 *
 * @example
 * ```ts
 * // Simple download
 * const result = await httpDownload(
 *   'https://example.com/file.zip',
 *   '/tmp/file.zip'
 * )
 * console.log(`Downloaded ${result.size} bytes to ${result.path}`)
 *
 * // With progress tracking
 * await httpDownload(
 *   'https://example.com/large-file.zip',
 *   '/tmp/file.zip',
 *   {
 *     onProgress: (downloaded, total) => {
 *       const percent = ((downloaded / total) * 100).toFixed(1)
 *       console.log(`Progress: ${percent}% (${downloaded}/${total} bytes)`)
 *     }
 *   }
 * )
 *
 * // With retries and custom timeout
 * await httpDownload(
 *   'https://example.com/file.zip',
 *   '/tmp/file.zip',
 *   {
 *     retries: 3,
 *     retryDelay: 2000,
 *     timeout: 300000, // 5 minutes
 *     headers: { 'Authorization': 'Bearer token123' }
 *   }
 * )
 * ```
 */
export async function httpDownload(
  url: string,
  destPath: string,
  options?: HttpDownloadOptions | undefined,
): Promise<HttpDownloadResult> {
  const {
    headers = {},
    onProgress,
    retries = 0,
    retryDelay = 1000,
    timeout = 120_000,
  } = { __proto__: null, ...options } as HttpDownloadOptions

  // Retry logic with exponential backoff
  let lastError: Error | undefined
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      // eslint-disable-next-line no-await-in-loop
      return await httpDownloadAttempt(url, destPath, {
        headers,
        onProgress,
        timeout,
      })
    } catch (e) {
      lastError = e as Error

      // Last attempt - throw error
      if (attempt === retries) {
        break
      }

      // Retry with exponential backoff
      const delayMs = retryDelay * 2 ** attempt
      // eslint-disable-next-line no-await-in-loop
      await new Promise(resolve => setTimeout(resolve, delayMs))
    }
  }

  throw lastError || new Error('Download failed after retries')
}

/**
 * Single download attempt (used internally by httpDownload with retry logic).
 * @private
 */
async function httpDownloadAttempt(
  url: string,
  destPath: string,
  options: HttpDownloadOptions,
): Promise<HttpDownloadResult> {
  const {
    headers = {},
    onProgress,
    timeout = 120_000,
  } = { __proto__: null, ...options } as HttpDownloadOptions

  return await new Promise((resolve, reject) => {
    const parsedUrl = new URL(url)
    const isHttps = parsedUrl.protocol === 'https:'
    const httpModule = isHttps ? getHttps() : getHttp()

    const requestOptions = {
      headers: {
        'User-Agent': 'socket-registry/1.0',
        ...headers,
      },
      hostname: parsedUrl.hostname,
      method: 'GET',
      path: parsedUrl.pathname + parsedUrl.search,
      port: parsedUrl.port,
      timeout,
    }

    let fileStream: ReturnType<typeof createWriteStream> | undefined
    let streamClosed = false

    const closeStream = () => {
      if (!streamClosed && fileStream) {
        streamClosed = true
        fileStream.close()
      }
    }

    const request = httpModule.request(
      requestOptions,
      (res: IncomingMessage) => {
        // Check status code
        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          closeStream()
          reject(
            new Error(
              `Download failed: HTTP ${res.statusCode} ${res.statusMessage}`,
            ),
          )
          return
        }

        const totalSize = Number.parseInt(
          res.headers['content-length'] || '0',
          10,
        )
        let downloadedSize = 0

        // Create write stream
        fileStream = createWriteStream(destPath)

        fileStream.on('error', (error: Error) => {
          closeStream()
          const err = new Error(`Failed to write file: ${error.message}`, {
            cause: error,
          })
          reject(err)
        })

        res.on('data', (chunk: Buffer) => {
          downloadedSize += chunk.length
          if (onProgress && totalSize > 0) {
            onProgress(downloadedSize, totalSize)
          }
        })

        res.on('end', () => {
          fileStream?.close(() => {
            streamClosed = true
            resolve({
              path: destPath,
              size: downloadedSize,
            })
          })
        })

        res.on('error', (error: Error) => {
          closeStream()
          reject(error)
        })

        // Pipe response to file
        res.pipe(fileStream)
      },
    )

    request.on('error', (error: Error) => {
      closeStream()
      const code = (error as NodeJS.ErrnoException).code
      let message = `HTTP download failed for ${url}: ${error.message}\n`

      if (code === 'ENOTFOUND') {
        message +=
          'DNS lookup failed. Check the hostname and your network connection.'
      } else if (code === 'ECONNREFUSED') {
        message +=
          'Connection refused. Verify the server is running and accessible.'
      } else if (code === 'ETIMEDOUT') {
        message +=
          'Request timed out. Check your network or increase the timeout value.'
      } else if (code === 'ECONNRESET') {
        message +=
          'Connection reset. The server may have closed the connection unexpectedly.'
      } else {
        message +=
          'Check your network connection and verify the URL is correct.'
      }

      reject(new Error(message, { cause: error }))
    })

    request.on('timeout', () => {
      request.destroy()
      closeStream()
      reject(new Error(`Download timed out after ${timeout}ms`))
    })

    request.end()
  })
}

/**
 * Perform a GET request and parse JSON response.
 * Convenience wrapper around `httpRequest` for common JSON API calls.
 *
 * @template T - Expected JSON response type (defaults to `unknown`)
 * @param url - The URL to request (must start with http:// or https://)
 * @param options - Request configuration options
 * @returns Promise resolving to parsed JSON data
 * @throws {Error} When request fails, response is not ok (status < 200 or >= 300), or JSON parsing fails
 *
 * @example
 * ```ts
 * // Simple JSON GET
 * const data = await httpGetJson('https://api.example.com/data')
 * console.log(data)
 *
 * // With type safety
 * interface User { id: number; name: string; email: string }
 * const user = await httpGetJson<User>('https://api.example.com/user/123')
 * console.log(user.name, user.email)
 *
 * // With custom headers
 * const data = await httpGetJson('https://api.example.com/data', {
 *   headers: {
 *     'Authorization': 'Bearer token123',
 *     'Accept': 'application/json'
 *   }
 * })
 *
 * // With retries
 * const data = await httpGetJson('https://api.example.com/data', {
 *   retries: 3,
 *   retryDelay: 1000
 * })
 * ```
 */
export async function httpGetJson<T = unknown>(
  url: string,
  options?: HttpRequestOptions | undefined,
): Promise<T> {
  const response = await httpRequest(url, { ...options, method: 'GET' })

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`)
  }

  try {
    return response.json<T>()
  } catch (e) {
    throw new Error('Failed to parse JSON response', { cause: e })
  }
}

/**
 * Perform a GET request and return text response.
 * Convenience wrapper around `httpRequest` for fetching text content.
 *
 * @param url - The URL to request (must start with http:// or https://)
 * @param options - Request configuration options
 * @returns Promise resolving to response body as UTF-8 string
 * @throws {Error} When request fails or response is not ok (status < 200 or >= 300)
 *
 * @example
 * ```ts
 * // Fetch HTML
 * const html = await httpGetText('https://example.com')
 * console.log(html.includes('<!DOCTYPE html>'))
 *
 * // Fetch plain text
 * const text = await httpGetText('https://example.com/file.txt')
 * console.log(text)
 *
 * // With custom headers
 * const text = await httpGetText('https://example.com/data.txt', {
 *   headers: {
 *     'Authorization': 'Bearer token123'
 *   }
 * })
 *
 * // With timeout
 * const text = await httpGetText('https://example.com/large-file.txt', {
 *   timeout: 60000 // 1 minute
 * })
 * ```
 */
export async function httpGetText(
  url: string,
  options?: HttpRequestOptions | undefined,
): Promise<string> {
  const response = await httpRequest(url, { ...options, method: 'GET' })

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`)
  }

  return response.text()
}
