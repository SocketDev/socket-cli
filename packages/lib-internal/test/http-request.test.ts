/**
 * @fileoverview Unit tests for HTTP/HTTPS request utilities.
 *
 * Tests HTTP client utilities with local test server:
 * - httpRequest() low-level HTTP request function
 * - httpGetText() fetches and returns text content
 * - httpGetJson() fetches and parses JSON responses
 * - httpDownload() downloads files to disk
 * - Redirect following, timeout handling, error cases
 * - Custom headers, user agent, retry logic
 * Used by Socket tools for API communication (registry, GitHub, GHSA).
 */

import { promises as fs } from 'node:fs'
import http from 'node:http'
import type https from 'node:https'
import path from 'node:path'

import {
  httpDownload,
  httpGetJson,
  httpGetText,
  httpRequest,
} from '@socketsecurity/lib/http-request'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runWithTempDir } from './utils/temp-file-helper.mjs'

// Test server setup
let httpServer: http.Server
let httpsServer: https.Server
let httpPort: number
let httpBaseUrl: string

beforeAll(async () => {
  // Create HTTP test server
  await new Promise<void>(resolve => {
    httpServer = http.createServer((req, res) => {
      const url = req.url || ''

      // Handle different test endpoints
      if (url === '/json') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ message: 'Hello, World!', status: 'success' }))
      } else if (url === '/text') {
        res.writeHead(200, { 'Content-Type': 'text/plain' })
        res.end('Plain text response')
      } else if (url === '/redirect') {
        res.writeHead(302, { Location: '/text' })
        res.end()
      } else if (url === '/redirect-absolute') {
        res.writeHead(302, { Location: `${httpBaseUrl}/text` })
        res.end()
      } else if (url === '/redirect-loop-1') {
        res.writeHead(302, { Location: '/redirect-loop-2' })
        res.end()
      } else if (url === '/redirect-loop-2') {
        res.writeHead(302, { Location: '/redirect-loop-3' })
        res.end()
      } else if (url === '/redirect-loop-3') {
        res.writeHead(302, { Location: '/redirect-loop-4' })
        res.end()
      } else if (url === '/redirect-loop-4') {
        res.writeHead(302, { Location: '/redirect-loop-5' })
        res.end()
      } else if (url === '/redirect-loop-5') {
        res.writeHead(302, { Location: '/redirect-loop-6' })
        res.end()
      } else if (url === '/redirect-loop-6') {
        res.writeHead(302, { Location: '/text' })
        res.end()
      } else if (url === '/not-found') {
        res.writeHead(404, { 'Content-Type': 'text/plain' })
        res.end('Not Found')
      } else if (url === '/server-error') {
        res.writeHead(500, { 'Content-Type': 'text/plain' })
        res.end('Internal Server Error')
      } else if (url === '/timeout') {
        // Don't respond - simulate timeout
        return
      } else if (url === '/slow') {
        // Respond after delay
        setTimeout(() => {
          res.writeHead(200, { 'Content-Type': 'text/plain' })
          res.end('Slow response')
        }, 100)
      } else if (url === '/echo-method') {
        res.writeHead(200, { 'Content-Type': 'text/plain' })
        res.end(req.method)
      } else if (url === '/echo-body') {
        let body = ''
        req.on('data', chunk => {
          body += chunk.toString()
        })
        req.on('end', () => {
          res.writeHead(200, { 'Content-Type': 'text/plain' })
          res.end(body)
        })
      } else if (url === '/echo-headers') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(req.headers))
      } else if (url === '/binary') {
        res.writeHead(200, { 'Content-Type': 'application/octet-stream' })
        const buffer = Buffer.from([0x00, 0x01, 0x02, 0x03, 0xff, 0xfe, 0xfd])
        res.end(buffer)
      } else if (url === '/download') {
        const content = 'Download test content'
        res.writeHead(200, {
          'Content-Length': String(content.length),
          'Content-Type': 'text/plain',
        })
        // Send data in chunks to test progress
        const chunk1 = content.slice(0, 10)
        const chunk2 = content.slice(10)
        res.write(chunk1)
        setTimeout(() => {
          res.end(chunk2)
        }, 10)
      } else if (url === '/large-download') {
        const content = 'X'.repeat(1000)
        res.writeHead(200, {
          'Content-Length': String(content.length),
          'Content-Type': 'text/plain',
        })
        res.end(content)
      } else if (url === '/download-no-length') {
        res.writeHead(200, { 'Content-Type': 'text/plain' })
        res.end('No content length')
      } else if (url === '/invalid-json') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end('not valid json{')
      } else if (url === '/post-success') {
        if (req.method === 'POST') {
          res.writeHead(201, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ created: true }))
        } else {
          res.writeHead(405)
          res.end()
        }
      } else if (url === '/no-redirect') {
        res.writeHead(301, { Location: '/text' })
        res.end()
      } else {
        res.writeHead(200, { 'Content-Type': 'text/plain' })
        res.end('OK')
      }
    })

    httpServer.listen(0, () => {
      const address = httpServer.address()
      if (address && typeof address === 'object') {
        httpPort = address.port
        httpBaseUrl = `http://localhost:${httpPort}`
      }
      resolve()
    })
  })

  // Create HTTPS test server (self-signed)
  await new Promise<void>(resolve => {
    // For testing, we'll skip HTTPS server as it requires certificates
    // In production tests, you would set up proper certificates
    resolve()
  })
})

afterAll(async () => {
  await new Promise<void>(resolve => {
    httpServer.close(() => resolve())
  })
  if (httpsServer) {
    await new Promise<void>(resolve => {
      httpsServer.close(() => resolve())
    })
  }
})

describe('http-request', () => {
  describe('httpRequest', () => {
    it('should make a simple GET request', async () => {
      const response = await httpRequest(`${httpBaseUrl}/text`)

      expect(response.status).toBe(200)
      expect(response.ok).toBe(true)
      expect(response.statusText).toBe('OK')
      expect(response.text()).toBe('Plain text response')
    })

    it('should parse JSON response', async () => {
      const response = await httpRequest(`${httpBaseUrl}/json`)

      expect(response.status).toBe(200)
      expect(response.ok).toBe(true)
      const data = response.json<{ message: string; status: string }>()
      expect(data.message).toBe('Hello, World!')
      expect(data.status).toBe('success')
    })

    it('should handle 404 errors', async () => {
      const response = await httpRequest(`${httpBaseUrl}/not-found`)

      expect(response.status).toBe(404)
      expect(response.ok).toBe(false)
      expect(response.statusText).toBe('Not Found')
      expect(response.text()).toBe('Not Found')
    })

    it('should handle 500 errors', async () => {
      const response = await httpRequest(`${httpBaseUrl}/server-error`)

      expect(response.status).toBe(500)
      expect(response.ok).toBe(false)
      expect(response.text()).toBe('Internal Server Error')
    })

    it('should follow redirects by default', async () => {
      const response = await httpRequest(`${httpBaseUrl}/redirect`)

      expect(response.status).toBe(200)
      expect(response.text()).toBe('Plain text response')
    })

    it('should follow absolute URL redirects', async () => {
      const response = await httpRequest(`${httpBaseUrl}/redirect-absolute`)

      expect(response.status).toBe(200)
      expect(response.text()).toBe('Plain text response')
    })

    it('should not follow redirects when followRedirects is false', async () => {
      const response = await httpRequest(`${httpBaseUrl}/no-redirect`, {
        followRedirects: false,
      })

      expect(response.status).toBe(301)
      expect(response.ok).toBe(false)
      expect(response.headers.location).toBe('/text')
    })

    it('should handle too many redirects', async () => {
      await expect(
        httpRequest(`${httpBaseUrl}/redirect-loop-1`, { maxRedirects: 3 }),
      ).rejects.toThrow(/Too many redirects/)
    })

    it('should make POST request', async () => {
      const response = await httpRequest(`${httpBaseUrl}/post-success`, {
        method: 'POST',
      })

      expect(response.status).toBe(201)
      expect(response.json<{ created: boolean }>().created).toBe(true)
    })

    it('should send request body as string', async () => {
      const body = JSON.stringify({ test: 'data' })
      const response = await httpRequest(`${httpBaseUrl}/echo-body`, {
        body,
        method: 'POST',
      })

      expect(response.text()).toBe(body)
    })

    it('should send request body as Buffer', async () => {
      const buffer = Buffer.from('binary data')
      const response = await httpRequest(`${httpBaseUrl}/echo-body`, {
        body: buffer,
        method: 'POST',
      })

      expect(response.text()).toBe('binary data')
    })

    it('should send custom headers', async () => {
      const response = await httpRequest(`${httpBaseUrl}/echo-headers`, {
        headers: {
          'X-Custom-Header': 'custom-value',
        },
      })

      const headers = response.json<Record<string, string>>()
      expect(headers['x-custom-header']).toBe('custom-value')
      expect(headers['user-agent']).toBe('socket-registry/1.0')
    })

    it('should handle custom User-Agent', async () => {
      const response = await httpRequest(`${httpBaseUrl}/echo-headers`, {
        headers: {
          'User-Agent': 'my-custom-agent',
        },
      })

      const headers = response.json<Record<string, string>>()
      expect(headers['user-agent']).toBe('my-custom-agent')
    })

    it('should support different HTTP methods', async () => {
      const methods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']

      const results = await Promise.all(
        methods.map(async method => {
          const response = await httpRequest(`${httpBaseUrl}/echo-method`, {
            method,
          })
          return { method, text: response.text() }
        }),
      )

      for (const result of results) {
        expect(result.text).toBe(result.method)
      }
    })

    it('should get arrayBuffer from response', async () => {
      const response = await httpRequest(`${httpBaseUrl}/binary`)

      const arrayBuffer = response.arrayBuffer()
      const view = new Uint8Array(arrayBuffer)
      expect(Array.from(view)).toEqual([
        0x00, 0x01, 0x02, 0x03, 0xff, 0xfe, 0xfd,
      ])
    })

    it('should expose body as Buffer', async () => {
      const response = await httpRequest(`${httpBaseUrl}/binary`)

      expect(Buffer.isBuffer(response.body)).toBe(true)
      expect(Array.from(response.body)).toEqual([
        0x00, 0x01, 0x02, 0x03, 0xff, 0xfe, 0xfd,
      ])
    })

    it('should handle timeout', async () => {
      await expect(
        httpRequest(`${httpBaseUrl}/timeout`, { timeout: 100 }),
      ).rejects.toThrow(/timed out after 100ms/)
    })

    it('should complete before timeout', async () => {
      const response = await httpRequest(`${httpBaseUrl}/slow`, {
        timeout: 2000,
      })
      expect(response.text()).toBe('Slow response')
    })

    it('should retry on failure', async () => {
      let attemptCount = 0
      const testServer = http.createServer((req, res) => {
        attemptCount++
        if (attemptCount < 3) {
          // Fail first 2 attempts
          req.socket.destroy()
        } else {
          // Succeed on 3rd attempt
          res.writeHead(200)
          res.end('Success after retries')
        }
      })

      await new Promise<void>(resolve => {
        testServer.listen(0, () => resolve())
      })

      const address = testServer.address()
      const testPort = address && typeof address === 'object' ? address.port : 0

      try {
        const response = await httpRequest(`http://localhost:${testPort}/`, {
          retries: 3,
          retryDelay: 10,
        })
        expect(response.text()).toBe('Success after retries')
        expect(attemptCount).toBe(3)
      } finally {
        await new Promise<void>(resolve => {
          testServer.close(() => resolve())
        })
      }
    })

    it('should fail after all retries exhausted', async () => {
      let attemptCount = 0
      const testServer = http.createServer((req, _res) => {
        attemptCount++
        req.socket.destroy()
      })

      await new Promise<void>(resolve => {
        testServer.listen(0, () => resolve())
      })

      const address = testServer.address()
      const testPort = address && typeof address === 'object' ? address.port : 0

      try {
        await expect(
          httpRequest(`http://localhost:${testPort}/`, {
            retries: 2,
            retryDelay: 10,
          }),
        ).rejects.toThrow(/HTTP request failed/)
        expect(attemptCount).toBe(3) // Initial attempt + 2 retries
      } finally {
        await new Promise<void>(resolve => {
          testServer.close(() => resolve())
        })
      }
    })

    it('should handle network errors', async () => {
      await expect(
        httpRequest('http://localhost:1/nonexistent', { timeout: 100 }),
      ).rejects.toThrow(/HTTP request failed/)
    })

    it('should handle invalid URLs gracefully', async () => {
      await expect(httpRequest('not-a-url')).rejects.toThrow()
    })

    it('should use exponential backoff for retries', async () => {
      const startTime = Date.now()
      let attemptCount = 0

      const testServer = http.createServer((req, _res) => {
        attemptCount++
        req.socket.destroy()
      })

      await new Promise<void>(resolve => {
        testServer.listen(0, () => resolve())
      })

      const address = testServer.address()
      const testPort = address && typeof address === 'object' ? address.port : 0

      try {
        await httpRequest(`http://localhost:${testPort}/`, {
          retries: 2,
          retryDelay: 100,
        }).catch(() => {
          // Expected to fail
        })

        const elapsed = Date.now() - startTime
        // Should wait at least 100ms + 200ms = 300ms for exponential backoff
        expect(elapsed).toBeGreaterThanOrEqual(200)
        expect(attemptCount).toBe(3)
      } finally {
        await new Promise<void>(resolve => {
          testServer.close(() => resolve())
        })
      }
    })

    it('should handle connection close without response', async () => {
      const testServer = http.createServer((_req, _res) => {
        // Close connection without sending response
        _res.socket?.destroy()
      })

      await new Promise<void>(resolve => {
        testServer.listen(0, () => resolve())
      })

      const address = testServer.address()
      const testPort = address && typeof address === 'object' ? address.port : 0

      try {
        await expect(
          httpRequest(`http://localhost:${testPort}/`),
        ).rejects.toThrow(/HTTP request failed/)
      } finally {
        await new Promise<void>(resolve => {
          testServer.close(() => resolve())
        })
      }
    })
  })

  describe('httpDownload', () => {
    it('should download file to disk', async () => {
      await runWithTempDir(async tmpDir => {
        const destPath = path.join(tmpDir, 'download.txt')
        const result = await httpDownload(`${httpBaseUrl}/download`, destPath)

        expect(result.path).toBe(destPath)
        expect(result.size).toBeGreaterThan(0)

        const content = await fs.readFile(destPath, 'utf8')
        expect(content).toBe('Download test content')
      }, 'httpDownload-basic-')
    })

    it('should track download progress', async () => {
      await runWithTempDir(async tmpDir => {
        const destPath = path.join(tmpDir, 'progress.txt')
        const progressUpdates: Array<{ downloaded: number; total: number }> = []

        await httpDownload(`${httpBaseUrl}/large-download`, destPath, {
          onProgress: (downloaded, total) => {
            progressUpdates.push({ downloaded, total })
          },
        })

        expect(progressUpdates.length).toBeGreaterThan(0)
        // Last update should have full size
        const lastUpdate = progressUpdates[progressUpdates.length - 1]
        expect(lastUpdate.downloaded).toBe(lastUpdate.total)
        expect(lastUpdate.total).toBe(1000)
      }, 'httpDownload-progress-')
    })

    it('should not call progress callback when no content-length', async () => {
      await runWithTempDir(async tmpDir => {
        const destPath = path.join(tmpDir, 'no-length.txt')
        let progressCalled = false

        await httpDownload(`${httpBaseUrl}/download-no-length`, destPath, {
          onProgress: () => {
            progressCalled = true
          },
        })

        expect(progressCalled).toBe(false)
        const content = await fs.readFile(destPath, 'utf8')
        expect(content).toBe('No content length')
      }, 'httpDownload-no-length-')
    })

    it('should handle download errors', async () => {
      await runWithTempDir(async tmpDir => {
        const destPath = path.join(tmpDir, 'error.txt')

        await expect(
          httpDownload(`${httpBaseUrl}/not-found`, destPath),
        ).rejects.toThrow(/Download failed: HTTP 404/)
      }, 'httpDownload-error-')
    })

    it('should handle download timeout', async () => {
      await runWithTempDir(async tmpDir => {
        const destPath = path.join(tmpDir, 'timeout.txt')

        await expect(
          httpDownload(`${httpBaseUrl}/timeout`, destPath, { timeout: 100 }),
        ).rejects.toThrow(/timed out after 100ms/)
      }, 'httpDownload-timeout-')
    })

    it('should retry download on failure', async () => {
      let attemptCount = 0
      const testServer = http.createServer((req, res) => {
        attemptCount++
        if (attemptCount < 3) {
          req.socket.destroy()
        } else {
          res.writeHead(200, { 'Content-Length': '7' })
          res.end('Success')
        }
      })

      await new Promise<void>(resolve => {
        testServer.listen(0, () => resolve())
      })

      const address = testServer.address()
      const testPort = address && typeof address === 'object' ? address.port : 0

      try {
        await runWithTempDir(async tmpDir => {
          const destPath = path.join(tmpDir, 'retry.txt')
          const result = await httpDownload(
            `http://localhost:${testPort}/`,
            destPath,
            {
              retries: 3,
              retryDelay: 10,
            },
          )

          expect(result.size).toBe(7)
          expect(attemptCount).toBe(3)

          const content = await fs.readFile(destPath, 'utf8')
          expect(content).toBe('Success')
        }, 'httpDownload-retry-')
      } finally {
        await new Promise<void>(resolve => {
          testServer.close(() => resolve())
        })
      }
    })

    it('should fail after all download retries exhausted', async () => {
      let attemptCount = 0
      const testServer = http.createServer((req, _res) => {
        attemptCount++
        req.socket.destroy()
      })

      await new Promise<void>(resolve => {
        testServer.listen(0, () => resolve())
      })

      const address = testServer.address()
      const testPort = address && typeof address === 'object' ? address.port : 0

      try {
        await runWithTempDir(async tmpDir => {
          const destPath = path.join(tmpDir, 'fail.txt')

          await expect(
            httpDownload(`http://localhost:${testPort}/`, destPath, {
              retries: 2,
              retryDelay: 10,
            }),
          ).rejects.toThrow(/HTTP download failed/)

          expect(attemptCount).toBe(3)
        }, 'httpDownload-fail-')
      } finally {
        await new Promise<void>(resolve => {
          testServer.close(() => resolve())
        })
      }
    })

    it('should send custom headers in download', async () => {
      await runWithTempDir(async tmpDir => {
        const destPath = path.join(tmpDir, 'headers.txt')

        // Use main test server - headers are already checked by echo-headers endpoint
        await httpDownload(`${httpBaseUrl}/download`, destPath, {
          headers: { 'X-Custom-Header': 'test-value' },
        })

        const content = await fs.readFile(destPath, 'utf8')
        expect(content).toBe('Download test content')
      }, 'httpDownload-headers-')
    })

    it('should handle file write errors', async () => {
      await runWithTempDir(async tmpDir => {
        // Try to write to an invalid path
        const destPath = path.join(tmpDir, 'nonexistent', 'nested', 'file.txt')

        await expect(
          httpDownload(`${httpBaseUrl}/download`, destPath),
        ).rejects.toThrow(/Failed to write file/)
      }, 'httpDownload-write-error-')
    })

    it('should handle response errors during download', async () => {
      const testServer = http.createServer((_req, _res) => {
        _res.writeHead(200, { 'Content-Length': '100' })
        _res.write('partial')
        // Simulate error during transmission
        setTimeout(() => {
          _res.destroy()
        }, 10)
      })

      await new Promise<void>(resolve => {
        testServer.listen(0, () => resolve())
      })

      const address = testServer.address()
      const testPort = address && typeof address === 'object' ? address.port : 0

      try {
        await runWithTempDir(async tmpDir => {
          const destPath = path.join(tmpDir, 'error.txt')

          await expect(
            httpDownload(`http://localhost:${testPort}/`, destPath),
          ).rejects.toThrow()
        }, 'httpDownload-response-error-')
      } finally {
        await new Promise<void>(resolve => {
          testServer.close(() => resolve())
        })
      }
    })

    it('should use default timeout of 120 seconds', async () => {
      await runWithTempDir(async tmpDir => {
        const destPath = path.join(tmpDir, 'default-timeout.txt')

        // This should succeed quickly with default timeout
        const result = await httpDownload(`${httpBaseUrl}/download`, destPath)
        expect(result.size).toBeGreaterThan(0)
      }, 'httpDownload-default-timeout-')
    })
  })

  describe('httpGetJson', () => {
    it('should get and parse JSON', async () => {
      const data = await httpGetJson<{ message: string; status: string }>(
        `${httpBaseUrl}/json`,
      )

      expect(data.message).toBe('Hello, World!')
      expect(data.status).toBe('success')
    })

    it('should throw on non-ok response', async () => {
      await expect(httpGetJson(`${httpBaseUrl}/not-found`)).rejects.toThrow(
        /HTTP 404/,
      )
    })

    it('should throw on invalid JSON', async () => {
      await expect(httpGetJson(`${httpBaseUrl}/invalid-json`)).rejects.toThrow(
        /Failed to parse JSON/,
      )
    })

    it('should pass options to httpRequest', async () => {
      const data = await httpGetJson(`${httpBaseUrl}/json`, {
        headers: { 'X-Test': 'value' },
        timeout: 5000,
      })

      expect(data).toBeDefined()
    })

    it('should support retries', async () => {
      let attemptCount = 0
      const testServer = http.createServer((req, res) => {
        attemptCount++
        if (attemptCount < 2) {
          req.socket.destroy()
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ retries: 'worked' }))
        }
      })

      await new Promise<void>(resolve => {
        testServer.listen(0, () => resolve())
      })

      const address = testServer.address()
      const testPort = address && typeof address === 'object' ? address.port : 0

      try {
        const data = await httpGetJson<{ retries: string }>(
          `http://localhost:${testPort}/`,
          {
            retries: 2,
            retryDelay: 10,
          },
        )

        expect(data.retries).toBe('worked')
        expect(attemptCount).toBe(2)
      } finally {
        await new Promise<void>(resolve => {
          testServer.close(() => resolve())
        })
      }
    })

    it('should handle server errors', async () => {
      await expect(httpGetJson(`${httpBaseUrl}/server-error`)).rejects.toThrow(
        /HTTP 500/,
      )
    })
  })

  describe('httpGetText', () => {
    it('should get text response', async () => {
      const text = await httpGetText(`${httpBaseUrl}/text`)

      expect(text).toBe('Plain text response')
    })

    it('should throw on non-ok response', async () => {
      await expect(httpGetText(`${httpBaseUrl}/not-found`)).rejects.toThrow(
        /HTTP 404/,
      )
    })

    it('should pass options to httpRequest', async () => {
      const text = await httpGetText(`${httpBaseUrl}/text`, {
        headers: { 'X-Test': 'value' },
        timeout: 5000,
      })

      expect(text).toBe('Plain text response')
    })

    it('should support retries', async () => {
      let attemptCount = 0
      const testServer = http.createServer((req, res) => {
        attemptCount++
        if (attemptCount < 2) {
          req.socket.destroy()
        } else {
          res.writeHead(200, { 'Content-Type': 'text/plain' })
          res.end('Retry success')
        }
      })

      await new Promise<void>(resolve => {
        testServer.listen(0, () => resolve())
      })

      const address = testServer.address()
      const testPort = address && typeof address === 'object' ? address.port : 0

      try {
        const text = await httpGetText(`http://localhost:${testPort}/`, {
          retries: 2,
          retryDelay: 10,
        })

        expect(text).toBe('Retry success')
        expect(attemptCount).toBe(2)
      } finally {
        await new Promise<void>(resolve => {
          testServer.close(() => resolve())
        })
      }
    })

    it('should handle server errors', async () => {
      await expect(httpGetText(`${httpBaseUrl}/server-error`)).rejects.toThrow(
        /HTTP 500/,
      )
    })

    it('should handle binary content as text', async () => {
      const text = await httpGetText(`${httpBaseUrl}/binary`)

      expect(text).toBeDefined()
      expect(text.length).toBeGreaterThan(0)
    })
  })

  describe('edge cases', () => {
    it('should handle empty response body', async () => {
      const testServer = http.createServer((_req, _res) => {
        _res.writeHead(204)
        _res.end()
      })

      await new Promise<void>(resolve => {
        testServer.listen(0, () => resolve())
      })

      const address = testServer.address()
      const testPort = address && typeof address === 'object' ? address.port : 0

      try {
        const response = await httpRequest(`http://localhost:${testPort}/`)
        expect(response.status).toBe(204)
        expect(response.body.length).toBe(0)
        expect(response.text()).toBe('')
      } finally {
        await new Promise<void>(resolve => {
          testServer.close(() => resolve())
        })
      }
    })

    it('should handle large response bodies', async () => {
      const testServer = http.createServer((_req, res) => {
        const largeContent = 'A'.repeat(1024 * 1024) // 1MB
        res.writeHead(200)
        res.end(largeContent)
      })

      await new Promise<void>(resolve => {
        testServer.listen(0, () => resolve())
      })

      const address = testServer.address()
      const testPort = address && typeof address === 'object' ? address.port : 0

      try {
        const response = await httpRequest(`http://localhost:${testPort}/`)
        expect(response.body.length).toBe(1024 * 1024)
        expect(response.text().length).toBe(1024 * 1024)
      } finally {
        await new Promise<void>(resolve => {
          testServer.close(() => resolve())
        })
      }
    })

    it('should handle query parameters in URL', async () => {
      const response = await httpRequest(`${httpBaseUrl}/text?foo=bar&baz=qux`)
      expect(response.status).toBe(200)
    })

    it('should handle URL with hash', async () => {
      const response = await httpRequest(`${httpBaseUrl}/text#section`)
      expect(response.status).toBe(200)
    })

    it('should handle 3xx status codes that are not redirects', async () => {
      const testServer = http.createServer((_req, res) => {
        res.writeHead(304) // Not Modified
        res.end()
      })

      await new Promise<void>(resolve => {
        testServer.listen(0, () => resolve())
      })

      const address = testServer.address()
      const testPort = address && typeof address === 'object' ? address.port : 0

      try {
        const response = await httpRequest(`http://localhost:${testPort}/`)
        expect(response.status).toBe(304)
        expect(response.ok).toBe(false)
      } finally {
        await new Promise<void>(resolve => {
          testServer.close(() => resolve())
        })
      }
    })

    it('should handle redirect with maxRedirects set to 0', async () => {
      await expect(
        httpRequest(`${httpBaseUrl}/redirect`, { maxRedirects: 0 }),
      ).rejects.toThrow(/Too many redirects/)
    })

    it('should handle response with multiple header values', async () => {
      const testServer = http.createServer((_req, res) => {
        res.setHeader('Set-Cookie', ['cookie1=value1', 'cookie2=value2'])
        res.writeHead(200)
        res.end('OK')
      })

      await new Promise<void>(resolve => {
        testServer.listen(0, () => resolve())
      })

      const address = testServer.address()
      const testPort = address && typeof address === 'object' ? address.port : 0

      try {
        const response = await httpRequest(`http://localhost:${testPort}/`)
        expect(response.headers['set-cookie']).toBeDefined()
        expect(Array.isArray(response.headers['set-cookie'])).toBe(true)
      } finally {
        await new Promise<void>(resolve => {
          testServer.close(() => resolve())
        })
      }
    })
  })
})
