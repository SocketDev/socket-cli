/** @fileoverview File upload utilities for Socket API with multipart form data support. */
import events from 'node:events'
import { createReadStream } from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'

import { normalizePath } from '@socketsecurity/lib/path'

import { getHttpModule, getResponse } from './http-client'

import type { RequestOptions } from './types'
import type { ReadStream } from 'node:fs'
import type { ClientRequest, IncomingMessage } from 'node:http'
import type { RequestOptions as HttpsRequestOptions } from 'node:https'

/**
 * Create multipart form-data body parts for file uploads.
 * Converts file paths to readable streams with proper multipart headers.
 *
 * @throws {Error} When file cannot be read (ENOENT, EACCES, EISDIR, etc.)
 */
export function createRequestBodyForFilepaths(
  filepaths: string[],
  basePath: string,
): Array<Array<string | ReadStream>> {
  const requestBody: Array<Array<string | ReadStream>> = []
  for (const absPath of filepaths) {
    const relPath = normalizePath(path.relative(basePath, absPath))
    const filename = path.basename(absPath)
    let stream: ReadStream
    try {
      stream = createReadStream(absPath, { highWaterMark: 1024 * 1024 })
    } catch (error) {
      const err = error as NodeJS.ErrnoException
      let message = `Failed to read file: ${absPath}`
      if (err.code === 'ENOENT') {
        message += '\n→ File does not exist. Check the file path and try again.'
      } else if (err.code === 'EACCES') {
        message += `\n→ Permission denied. Run: chmod +r "${absPath}"`
      } else if (err.code === 'EISDIR') {
        message += '\n→ Expected a file but found a directory.'
      } else if (err.code) {
        message += `\n→ Error code: ${err.code}`
      }
      throw new Error(message, { cause: error })
    }
    requestBody.push([
      `Content-Disposition: form-data; name="${relPath}"; filename="${filename}"\r\n`,
      'Content-Type: application/octet-stream\r\n\r\n',
      stream,
    ])
  }
  return requestBody
}

/**
 * Create multipart form-data body part for JSON data.
 * Converts JSON object to readable stream with appropriate headers.
 */
export function createRequestBodyForJson(
  jsonData: unknown,
  basename = 'data.json',
): Array<string | Readable> {
  const ext = path.extname(basename)
  const name = path.basename(basename, ext)
  return [
    `Content-Disposition: form-data; name="${name}"; filename="${basename}"\r\n` +
      'Content-Type: application/json\r\n\r\n',
    Readable.from(JSON.stringify(jsonData), { highWaterMark: 1024 * 1024 }),
    '\r\n',
  ]
}

/**
 * Create and execute a multipart/form-data upload request.
 * Streams large files efficiently with backpressure handling and early server validation.
 *
 * @throws {Error} When network errors occur or stream processing fails
 */
export async function createUploadRequest(
  baseUrl: string,
  urlPath: string,
  requestBodyNoBoundaries: Array<string | Readable | Array<string | Readable>>,
  options: RequestOptions,
): Promise<IncomingMessage> {
  // This function constructs and sends a multipart/form-data HTTP POST request
  // where each part is streamed to the server. It supports string payloads
  // and readable streams (e.g., large file uploads).

  // The body is streamed manually with proper backpressure support to avoid
  // overwhelming Node.js memory (i.e., avoiding out-of-memory crashes for large inputs).

  // We call `flushHeaders()` early to ensure headers are sent before body transmission
  // begins. If the server rejects the request (e.g., bad org or auth), it will likely
  // respond immediately. We listen for that response while still streaming the body.
  //
  // This protects against cases where the server closes the connection (EPIPE/ECONNRESET)
  // mid-stream, which would otherwise cause hard-to-diagnose failures during file upload.
  //
  // Example failure this mitigates: `socket scan create --org badorg`

  // eslint-disable-next-line no-async-promise-executor
  return await new Promise(async (pass, fail) => {
    const boundary = `NodeMultipartBoundary${Date.now()}`
    const boundarySep = `--${boundary}\r\n`
    const finalBoundary = `--${boundary}--\r\n`

    const requestBody = [
      ...requestBodyNoBoundaries.flatMap(part => [
        boundarySep,
        /* c8 ignore next - Array.isArray branch for part is defensive coding for edge cases. */
        ...(Array.isArray(part) ? part : [part]),
      ]),
      finalBoundary,
    ]

    const url = new URL(urlPath, baseUrl)
    const req: ClientRequest = getHttpModule(baseUrl).request(url, {
      method: 'POST',
      ...options,
      headers: {
        ...(options as HttpsRequestOptions)?.headers,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
    })

    // Send headers early to prompt server validation (auth, URL, quota, etc.).
    req.flushHeaders()

    // Concurrently wait for response while we stream body.
    getResponse(req).then(pass, fail)

    let aborted = false
    req.on('error', () => (aborted = true))
    req.on('close', () => (aborted = true))

    try {
      for (const part of requestBody) {
        /* c8 ignore next 3 - aborted state is difficult to test reliably */
        if (aborted) {
          break
        }
        if (typeof part === 'string') {
          /* c8 ignore next 5 - backpressure handling requires specific stream conditions */
          if (!req.write(part)) {
            // Wait for 'drain' if backpressure is signaled.
            // eslint-disable-next-line no-await-in-loop
            await events.once(req, 'drain')
          }
        } else if (typeof part?.pipe === 'function') {
          // Stream data chunk-by-chunk with backpressure support.
          const stream = part as Readable
          try {
            // eslint-disable-next-line no-await-in-loop
            for await (const chunk of stream) {
              /* c8 ignore next 3 - aborted state during streaming is difficult to test reliably */
              if (aborted) {
                break
              }
              /* c8 ignore next 3 - backpressure handling requires specific stream conditions */
              if (!req.write(chunk)) {
                await events.once(req, 'drain')
              }
            }
          } catch (streamError) {
            const err = streamError as NodeJS.ErrnoException
            let message = 'Failed to read file during upload'
            if (err.code === 'ENOENT') {
              message +=
                '\n→ File was deleted during upload. Ensure files remain accessible during the upload process.'
            } else if (err.code === 'EACCES') {
              message +=
                '\n→ Permission denied while reading file. Check file permissions.'
            } else if (err.code) {
              message += `\n→ Error code: ${err.code}`
            }
            throw new Error(message, { cause: streamError })
          }
          // Ensure trailing CRLF after file part.
          /* c8 ignore next 4 - trailing CRLF backpressure handling is edge case */
          if (!aborted && !req.write('\r\n')) {
            // eslint-disable-next-line no-await-in-loop
            await events.once(req, 'drain')
          }
          // Cleanup stream to free memory buffers.
          if (typeof part.destroy === 'function') {
            part.destroy()
          }
          /* c8 ignore next 3 - defensive check for non-string/stream types */
        } else {
          throw new TypeError('Expected "string" or "stream" type')
        }
      }
    } catch (e) {
      req.destroy(e as Error)
      fail(e)
    } finally {
      if (!aborted) {
        req.end()
      }
    }
  })
}
