/** @fileoverview HTTP request utilities using Node's native http/https modules. Provides fetch-like API for making HTTP requests without depending on global fetch. Supports redirects, progress callbacks, and streaming. */

import { createWriteStream } from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import { URL } from 'node:url'

import type { CResult } from '../types.mts'
import type { IncomingMessage } from 'node:http'

export interface HttpRequestOptions {
  method?: string | undefined
  headers?: Record<string, string> | undefined
  body?: string | Buffer | undefined
  timeout?: number | undefined
  followRedirects?: boolean | undefined
  maxRedirects?: number | undefined
  retries?: number | undefined
  retryDelay?: number | undefined
}

export interface HttpResponse {
  ok: boolean
  status: number
  statusText: string
  headers: Record<string, string | string[] | undefined>
  body: Buffer
  text(): string
  json<T = unknown>(): T
  arrayBuffer(): ArrayBuffer
}

/**
 * Make an HTTP request using Node's native http/https modules.
 * Provides a fetch-like API without depending on global fetch.
 * Supports automatic retries with exponential backoff.
 */
export async function httpRequest(
  url: string,
  options: HttpRequestOptions = {},
): Promise<CResult<HttpResponse>> {
  const {
    body,
    followRedirects = true,
    headers = {},
    maxRedirects = 5,
    method = 'GET',
    retries = 0,
    retryDelay = 1000,
    timeout = 30000,
  } = { __proto__: null, ...options } as HttpRequestOptions

  // Retry logic with exponential backoff
  let lastError: CResult<HttpResponse> | undefined
  for (let attempt = 0; attempt <= retries; attempt++) {
    const result = await httpRequestAttempt(url, {
      body,
      followRedirects,
      headers,
      maxRedirects,
      method,
      timeout,
    })

    // Success - return immediately
    if (result.ok) {
      return result
    }

    // Last attempt - return error
    if (attempt === retries) {
      lastError = result
      break
    }

    // Retry with exponential backoff
    const delayMs = retryDelay * Math.pow(2, attempt)
    await new Promise(resolve => setTimeout(resolve, delayMs))
  }

  return lastError || {
    ok: false,
    message: 'Request failed',
    cause: 'Unknown error after retries',
  }
}

/**
 * Single HTTP request attempt (used internally by httpRequest with retry logic).
 */
async function httpRequestAttempt(
  url: string,
  options: HttpRequestOptions,
): Promise<CResult<HttpResponse>> {
  const {
    body,
    followRedirects = true,
    headers = {},
    maxRedirects = 5,
    method = 'GET',
    timeout = 30000,
  } = { __proto__: null, ...options } as HttpRequestOptions

  return await new Promise(resolve => {
    const parsedUrl = new URL(url)
    const isHttps = parsedUrl.protocol === 'https:'
    const httpModule = isHttps ? https : http

    const requestOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.path,
      method,
      headers: {
        'User-Agent': 'socket-cli/1.0',
        ...headers,
      },
      timeout,
    }

    const req = httpModule.request(requestOptions, (res: IncomingMessage) => {
      // Handle redirects
      if (
        followRedirects &&
        res.statusCode &&
        res.statusCode >= 300 &&
        res.statusCode < 400 &&
        res.headers.location
      ) {
        if (maxRedirects <= 0) {
          resolve({
            ok: false,
            message: 'Too many redirects',
            cause: `Exceeded maximum redirects (${maxRedirects})`,
          })
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
          ok,
          status: res.statusCode || 0,
          statusText: res.statusMessage || '',
          headers: res.headers as Record<string, string | string[] | undefined>,
          body: responseBody,
          text(): string {
            return responseBody.toString('utf8')
          },
          json<T = unknown>(): T {
            return JSON.parse(responseBody.toString('utf8')) as T
          },
          arrayBuffer(): ArrayBuffer {
            return responseBody.buffer.slice(
              responseBody.byteOffset,
              responseBody.byteOffset + responseBody.byteLength,
            )
          },
        }

        resolve({ ok: true, data: response })
      })
    })

    req.on('error', (error: Error) => {
      resolve({
        ok: false,
        message: `HTTP request failed: ${error.message}`,
        cause: error.stack || error.message,
      })
    })

    req.on('timeout', () => {
      req.destroy()
      resolve({
        ok: false,
        message: 'Request timeout',
        cause: `Request timed out after ${timeout}ms`,
      })
    })

    // Send body if present
    if (body) {
      req.write(body)
    }

    req.end()
  })
}

/**
 * Download a file from a URL to a local path using Node's native http/https modules.
 * Supports progress callbacks and streaming to avoid loading entire file in memory.
 * Supports automatic retries with exponential backoff.
 */
export async function httpDownload(
  url: string,
  destPath: string,
  options: {
    headers?: Record<string, string> | undefined
    timeout?: number | undefined
    retries?: number | undefined
    retryDelay?: number | undefined
    onProgress?: ((downloaded: number, total: number) => void) | undefined
  } = {},
): Promise<CResult<{ path: string; size: number }>> {
  const {
    headers = {},
    onProgress,
    retries = 0,
    retryDelay = 1000,
    timeout = 120000,
  } = { __proto__: null, ...options }

  // Retry logic with exponential backoff
  let lastError: CResult<{ path: string; size: number }> | undefined
  for (let attempt = 0; attempt <= retries; attempt++) {
    const result = await httpDownloadAttempt(url, destPath, {
      headers,
      timeout,
      onProgress,
    })

    // Success - return immediately
    if (result.ok) {
      return result
    }

    // Last attempt - return error
    if (attempt === retries) {
      lastError = result
      break
    }

    // Retry with exponential backoff
    const delayMs = retryDelay * Math.pow(2, attempt)
    await new Promise(resolve => setTimeout(resolve, delayMs))
  }

  return lastError || {
    ok: false,
    message: 'Download failed',
    cause: 'Unknown error after retries',
  }
}

/**
 * Single download attempt (used internally by httpDownload with retry logic).
 */
async function httpDownloadAttempt(
  url: string,
  destPath: string,
  options: {
    headers?: Record<string, string> | undefined
    timeout?: number | undefined
    onProgress?: ((downloaded: number, total: number) => void) | undefined
  } = {},
): Promise<CResult<{ path: string; size: number }>> {
  const {
    headers = {},
    onProgress,
    timeout = 120000,
  } = { __proto__: null, ...options }

  return await new Promise(resolve => {
    const parsedUrl = new URL(url)
    const isHttps = parsedUrl.protocol === 'https:'
    const httpModule = isHttps ? https : http

    const requestOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.path,
      method: 'GET',
      headers: {
        'User-Agent': 'socket-cli/1.0',
        ...headers,
      },
      timeout,
    }

    const req = httpModule.request(requestOptions, (res: IncomingMessage) => {
      // Check status code
      if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
        resolve({
          ok: false,
          message: `Download failed: HTTP ${res.statusCode}`,
          cause: res.statusMessage,
        })
        return
      }

      const totalSize = parseInt(res.headers['content-length'] || '0', 10)
      let downloadedSize = 0

      // Create write stream
      const fileStream = createWriteStream(destPath)

      fileStream.on('error', (error: Error) => {
        resolve({
          ok: false,
          message: `Failed to write file: ${error.message}`,
          cause: error.stack || error.message,
        })
      })

      res.on('data', (chunk: Buffer) => {
        downloadedSize += chunk.length
        if (onProgress && totalSize > 0) {
          onProgress(downloadedSize, totalSize)
        }
      })

      res.on('end', () => {
        fileStream.close(() => {
          resolve({
            ok: true,
            data: { path: destPath, size: downloadedSize },
          })
        })
      })

      // Pipe response to file
      res.pipe(fileStream)
    })

    req.on('error', (error: Error) => {
      resolve({
        ok: false,
        message: `HTTP download failed: ${error.message}`,
        cause: error.stack || error.message,
      })
    })

    req.on('timeout', () => {
      req.destroy()
      resolve({
        ok: false,
        message: 'Download timeout',
        cause: `Download timed out after ${timeout}ms`,
      })
    })

    req.end()
  })
}

/**
 * Perform a GET request and parse JSON response.
 */
export async function httpGetJson<T = unknown>(
  url: string,
  options: HttpRequestOptions = {},
): Promise<CResult<T>> {
  const result = await httpRequest(url, { ...options, method: 'GET' })

  if (!result.ok) {
    return result as CResult<T>
  }

  try {
    const data = result.data!.json<T>()
    return { ok: true, data }
  } catch (error) {
    return {
      ok: false,
      message: 'Failed to parse JSON response',
      cause: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Perform a GET request and return text response.
 */
export async function httpGetText(
  url: string,
  options: HttpRequestOptions = {},
): Promise<CResult<string>> {
  const result = await httpRequest(url, { ...options, method: 'GET' })

  if (!result.ok) {
    return result as CResult<string>
  }

  return { ok: true, data: result.data!.text() }
}
