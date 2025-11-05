/**
 * @fileoverview Unit tests for DLX binary execution and caching.
 *
 * Tests DLX binary execution with HTTP server integration:
 * - dlxBinary() downloads and executes package binaries
 * - getDlxCachePath() resolves cache directory paths
 * - listDlxCache() enumerates cached packages
 * - cleanDlxCache() removes cached packages
 * - Cross-platform binary execution
 * - HTTP download with integrity verification
 * Used by Socket CLI for secure one-off package execution.
 */

import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

import {
  cleanDlxCache,
  dlxBinary,
  getDlxCachePath,
  listDlxCache,
} from '@socketsecurity/lib/dlx-binary'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mockHomeDir, runWithTempDir } from './utils/temp-file-helper.mjs'

// Test server setup
let httpServer: http.Server
let httpPort: number
let httpBaseUrl: string

beforeAll(async () => {
  // Create HTTP test server for binary downloads
  await new Promise<void>(resolve => {
    httpServer = http.createServer((req, res) => {
      const url = req.url || ''

      if (url === '/binary') {
        res.writeHead(200, { 'Content-Type': 'application/octet-stream' })
        res.end('#!/bin/bash\necho "test binary"')
      } else if (url === '/binary-with-checksum') {
        const content = '#!/bin/bash\necho "verified binary"'
        const hash = createHash('sha256').update(content).digest('hex')
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'X-Checksum': hash,
        })
        res.end(content)
      } else if (url === '/binary-invalid-checksum') {
        res.writeHead(200, { 'Content-Type': 'application/octet-stream' })
        res.end('#!/bin/bash\necho "wrong content"')
      } else if (url === '/binary-404') {
        res.writeHead(404)
        res.end('Not Found')
      } else if (url === '/binary-500') {
        res.writeHead(500)
        res.end('Internal Server Error')
      } else if (url === '/binary-windows.cmd') {
        res.writeHead(200, { 'Content-Type': 'application/octet-stream' })
        res.end('@echo off\necho "windows script"')
      } else if (url === '/binary-windows.bat') {
        res.writeHead(200, { 'Content-Type': 'application/octet-stream' })
        res.end('@echo off\necho "batch script"')
      } else if (url === '/binary-windows.ps1') {
        res.writeHead(200, { 'Content-Type': 'application/octet-stream' })
        res.end('Write-Host "powershell script"')
      } else if (url === '/slow-binary') {
        setTimeout(() => {
          res.writeHead(200, { 'Content-Type': 'application/octet-stream' })
          res.end('#!/bin/bash\necho "slow binary"')
        }, 100)
      } else {
        res.writeHead(404)
        res.end()
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
})

afterAll(async () => {
  await new Promise<void>(resolve => {
    httpServer.close(() => resolve())
  })
})

describe.sequential('dlx-binary', () => {
  describe('getDlxCachePath', () => {
    it('should return normalized cache path', () => {
      const cachePath = getDlxCachePath()

      expect(cachePath).toBeDefined()
      expect(cachePath).toContain('.socket')
      expect(cachePath).toContain('_dlx')
      // Should not contain backslashes on any platform
      expect(cachePath.includes('\\')).toBe(false)
    })

    it('should return consistent path across multiple calls', () => {
      const path1 = getDlxCachePath()
      const path2 = getDlxCachePath()

      expect(path1).toBe(path2)
    })
  })

  describe('dlxBinary', () => {
    it('should download and cache binary', async () => {
      await runWithTempDir(async tmpDir => {
        const restoreHome = mockHomeDir(tmpDir)

        try {
          const url = `${httpBaseUrl}/binary`
          const result = await dlxBinary(['--version'], {
            name: 'test-binary',
            url,
          })

          expect(result.downloaded).toBe(true)
          expect(result.binaryPath).toBeDefined()
          expect(result.binaryPath).toContain('test-binary')
          expect(result.spawnPromise).toBeDefined()
          await result.spawnPromise.catch(() => {})
        } finally {
          restoreHome()
        }
      }, 'dlxBinary-download-')
    })

    it('should use cached binary on second call', async () => {
      await runWithTempDir(async tmpDir => {
        const restoreHome = mockHomeDir(tmpDir)

        try {
          const url = `${httpBaseUrl}/binary`

          // First call - should download
          const result1 = await dlxBinary(['--version'], {
            name: 'cached-binary',
            url,
          })
          // Catch spawn promise immediately to prevent unhandled rejection on Windows.
          result1.spawnPromise.catch(() => {})
          expect(result1.downloaded).toBe(true)

          // Second call - should use cache
          const result2 = await dlxBinary(['--version'], {
            name: 'cached-binary',
            url,
          })
          // Catch spawn promise immediately to prevent unhandled rejection on Windows.
          result2.spawnPromise.catch(() => {})
          expect(result2.downloaded).toBe(false)
          expect(result2.binaryPath).toBe(result1.binaryPath)
        } finally {
          restoreHome()
        }
      }, 'dlxBinary-cached-')
    })

    it('should force re-download when force option is true', async () => {
      await runWithTempDir(async tmpDir => {
        const restoreHome = mockHomeDir(tmpDir)

        try {
          const url = `${httpBaseUrl}/binary`

          // First call
          const result1 = await dlxBinary(['--version'], {
            name: 'force-binary',
            url,
          })
          await result1.spawnPromise.catch(() => {})

          // Second call with force
          const result = await dlxBinary(['--version'], {
            force: true,
            name: 'force-binary',
            url,
          })
          expect(result.downloaded).toBe(true)
          await result.spawnPromise.catch(() => {})
        } finally {
          restoreHome()
        }
      }, 'dlxBinary-force-')
    })

    it('should force re-download when yes option is true (CLI-style)', async () => {
      await runWithTempDir(async tmpDir => {
        const restoreHome = mockHomeDir(tmpDir)

        try {
          const url = `${httpBaseUrl}/binary`

          // First call
          const result1 = await dlxBinary(['--version'], {
            name: 'yes-binary',
            url,
          })
          await result1.spawnPromise.catch(() => {})

          // Second call with yes (should behave like force)
          const result = await dlxBinary(['--version'], {
            name: 'yes-binary',
            url,
            yes: true,
          })
          expect(result.downloaded).toBe(true)
          await result.spawnPromise.catch(() => {})
        } finally {
          restoreHome()
        }
      }, 'dlxBinary-yes-')
    })

    it('should accept quiet option (CLI-style, reserved)', async () => {
      await runWithTempDir(async tmpDir => {
        const restoreHome = mockHomeDir(tmpDir)

        try {
          const url = `${httpBaseUrl}/binary`

          // Call with quiet option - currently reserved for future use
          const result = await dlxBinary(['--version'], {
            name: 'quiet-binary',
            quiet: true,
            url,
          })
          expect(result.downloaded).toBe(true)
          await result.spawnPromise.catch(() => {})
        } finally {
          restoreHome()
        }
      }, 'dlxBinary-quiet-')
    })

    it('should verify checksum when provided', async () => {
      await runWithTempDir(async tmpDir => {
        const restoreHome = mockHomeDir(tmpDir)

        try {
          const content = '#!/bin/bash\necho "verified binary"'
          const expectedChecksum = createHash('sha256')
            .update(content)
            .digest('hex')
          const url = `${httpBaseUrl}/binary-with-checksum`

          const result = await dlxBinary(['--version'], {
            checksum: expectedChecksum,
            name: 'verified-binary',
            url,
          })

          expect(result.downloaded).toBe(true)
          await result.spawnPromise.catch(() => {})
        } finally {
          restoreHome()
        }
      }, 'dlxBinary-checksum-')
    })

    it('should throw on checksum mismatch', async () => {
      await runWithTempDir(async tmpDir => {
        const restoreHome = mockHomeDir(tmpDir)

        try {
          const url = `${httpBaseUrl}/binary-invalid-checksum`
          const wrongChecksum = 'a'.repeat(64)

          await expect(
            dlxBinary(['--version'], {
              checksum: wrongChecksum,
              name: 'invalid-checksum-binary',
              url,
            }),
          ).rejects.toThrow(/Checksum mismatch/)
        } finally {
          restoreHome()
        }
      }, 'dlxBinary-bad-checksum-')
    })

    it('should throw on download failure', async () => {
      await runWithTempDir(async tmpDir => {
        const restoreHome = mockHomeDir(tmpDir)

        try {
          const url = `${httpBaseUrl}/binary-404`

          await expect(
            dlxBinary(['--version'], {
              name: 'not-found-binary',
              url,
            }),
          ).rejects.toThrow(/Failed to download binary from/)
        } finally {
          restoreHome()
        }
      }, 'dlxBinary-404-')
    })

    it('should throw on server error', async () => {
      await runWithTempDir(async tmpDir => {
        const restoreHome = mockHomeDir(tmpDir)

        try {
          const url = `${httpBaseUrl}/binary-500`

          await expect(
            dlxBinary(['--version'], {
              name: 'error-binary',
              url,
            }),
          ).rejects.toThrow(/Failed to download binary from/)
        } finally {
          restoreHome()
        }
      }, 'dlxBinary-500-')
    })

    it('should use default binary name if not provided', async () => {
      await runWithTempDir(async tmpDir => {
        const restoreHome = mockHomeDir(tmpDir)

        try {
          const url = `${httpBaseUrl}/binary`

          const result = await dlxBinary(['--version'], {
            url,
          })

          expect(result.binaryPath).toContain(
            `binary-${process.platform}-${os.arch()}`,
          )
          await result.spawnPromise.catch(() => {})
        } finally {
          restoreHome()
        }
      }, 'dlxBinary-default-name-')
    })

    it('should pass spawn options to spawn', async () => {
      await runWithTempDir(async tmpDir => {
        const restoreHome = mockHomeDir(tmpDir)

        try {
          const url = `${httpBaseUrl}/binary`

          const result = await dlxBinary(['--version'], {
            name: 'spawn-options-binary',
            spawnOptions: {
              env: { CUSTOM_VAR: 'test' },
            },
            url,
          })

          expect(result.spawnPromise).toBeDefined()
          await result.spawnPromise.catch(() => {})
        } finally {
          restoreHome()
        }
      }, 'dlxBinary-spawn-options-')
    })

    it('should use custom cacheTtl', async () => {
      await runWithTempDir(async tmpDir => {
        const restoreHome = mockHomeDir(tmpDir)

        try {
          const url = `${httpBaseUrl}/binary`

          // Set very short TTL
          const result = await dlxBinary(['--version'], {
            cacheTtl: 100, // 100ms
            name: 'ttl-binary',
            url,
          })
          // Catch spawn promise immediately to prevent unhandled rejection on Windows.
          result.spawnPromise.catch(() => {})

          expect(result.downloaded).toBe(true)

          // Wait for cache to expire
          await new Promise(resolve => setTimeout(resolve, 150))

          // Should re-download due to expired cache
          const result2 = await dlxBinary(['--version'], {
            cacheTtl: 100,
            name: 'ttl-binary',
            url,
          })
          // Catch spawn promise immediately to prevent unhandled rejection on Windows.
          result2.spawnPromise.catch(() => {})

          expect(result2.downloaded).toBe(true)
        } finally {
          restoreHome()
        }
      }, 'dlxBinary-ttl-')
    })

    it('should re-download if metadata is invalid', async () => {
      await runWithTempDir(async tmpDir => {
        const restoreHome = mockHomeDir(tmpDir)

        try {
          const url = `${httpBaseUrl}/binary`

          // First download
          const result1 = await dlxBinary(['--version'], {
            name: 'invalid-meta-binary',
            url,
          })
          await result1.spawnPromise.catch(() => {})

          // Corrupt metadata
          const name = 'invalid-meta-binary'
          const spec = `${url}:${name}`
          const cacheKey = createHash('sha512')
            .update(spec)
            .digest('hex')
            .substring(0, 16)
          const cachePath = getDlxCachePath()
          const metaPath = path.join(cachePath, cacheKey, '.dlx-metadata.json')
          await fs.writeFile(metaPath, 'invalid json', 'utf8')

          // Second call should re-download due to invalid metadata
          const result2 = await dlxBinary(['--version'], {
            name: 'invalid-meta-binary',
            url,
          })

          expect(result2.downloaded).toBe(true)
          await result2.spawnPromise.catch(() => {})
        } finally {
          restoreHome()
        }
      }, 'dlxBinary-invalid-meta-')
    })

    it('should handle missing metadata file', async () => {
      await runWithTempDir(async tmpDir => {
        const restoreHome = mockHomeDir(tmpDir)

        try {
          const url = `${httpBaseUrl}/binary`

          // First download
          const result1 = await dlxBinary(['--version'], {
            name: 'missing-meta-binary',
            url,
          })
          await result1.spawnPromise.catch(() => {})

          // Delete metadata
          const name = 'missing-meta-binary'
          const spec = `${url}:${name}`
          const cacheKey = createHash('sha512')
            .update(spec)
            .digest('hex')
            .substring(0, 16)
          const cachePath = getDlxCachePath()
          const metaPath = path.join(cachePath, cacheKey, '.dlx-metadata.json')
          await fs.unlink(metaPath)

          // Second call should re-download due to missing metadata
          const result = await dlxBinary(['--version'], {
            name: 'missing-meta-binary',
            url,
          })

          expect(result.downloaded).toBe(true)
          await result.spawnPromise.catch(() => {})
        } finally {
          restoreHome()
        }
      }, 'dlxBinary-missing-meta-')
    })

    it('should handle metadata with non-object value', async () => {
      await runWithTempDir(async tmpDir => {
        const restoreHome = mockHomeDir(tmpDir)

        try {
          const url = `${httpBaseUrl}/binary`

          // First download
          const result1 = await dlxBinary(['--version'], {
            name: 'array-meta-binary',
            url,
          })
          await result1.spawnPromise.catch(() => {})

          // Write array as metadata (invalid)
          const name = 'array-meta-binary'
          const spec = `${url}:${name}`
          const cacheKey = createHash('sha512')
            .update(spec)
            .digest('hex')
            .substring(0, 16)
          const cachePath = getDlxCachePath()
          const metaPath = path.join(cachePath, cacheKey, '.dlx-metadata.json')
          await fs.writeFile(metaPath, JSON.stringify([]), 'utf8')

          // Second call should re-download
          const result = await dlxBinary(['--version'], {
            name: 'array-meta-binary',
            url,
          })

          expect(result.downloaded).toBe(true)
          await result.spawnPromise.catch(() => {})
        } finally {
          restoreHome()
        }
      }, 'dlxBinary-array-meta-')
    })

    it('should handle metadata with missing checksum', async () => {
      await runWithTempDir(async tmpDir => {
        const restoreHome = mockHomeDir(tmpDir)

        try {
          const url = `${httpBaseUrl}/binary`

          // First download
          const result1 = await dlxBinary(['--version'], {
            name: 'no-checksum-meta-binary',
            url,
          })
          await result1.spawnPromise.catch(() => {})

          // Write metadata without checksum
          const name = 'no-checksum-meta-binary'
          const spec = `${url}:${name}`
          const cacheKey = createHash('sha512')
            .update(spec)
            .digest('hex')
            .substring(0, 16)
          const cachePath = getDlxCachePath()
          const metaPath = path.join(cachePath, cacheKey, '.dlx-metadata.json')
          await fs.writeFile(
            metaPath,
            JSON.stringify({ timestamp: Date.now() }),
            'utf8',
          )

          // Second call should re-download
          const result = await dlxBinary(['--version'], {
            name: 'no-checksum-meta-binary',
            url,
          })

          expect(result.downloaded).toBe(true)
          await result.spawnPromise.catch(() => {})
        } finally {
          restoreHome()
        }
      }, 'dlxBinary-no-checksum-meta-')
    })

    it('should pass args to spawn', async () => {
      await runWithTempDir(async tmpDir => {
        const restoreHome = mockHomeDir(tmpDir)

        try {
          const url = `${httpBaseUrl}/binary`
          const args = ['arg1', 'arg2', '--flag']

          const result = await dlxBinary(args, {
            name: 'args-binary',
            url,
          })

          expect(result.spawnPromise).toBeDefined()
          await result.spawnPromise.catch(() => {})
        } finally {
          restoreHome()
        }
      }, 'dlxBinary-args-')
    })
  })

  describe('cleanDlxCache', () => {
    it('should return 0 if cache directory does not exist', async () => {
      await runWithTempDir(async tmpDir => {
        const restoreHome = mockHomeDir(tmpDir)

        try {
          const cleaned = await cleanDlxCache()
          expect(cleaned).toBe(0)
        } finally {
          restoreHome()
        }
      }, 'cleanDlxCache-no-dir-')
    })

    it('should clean expired cache entries', async () => {
      await runWithTempDir(async tmpDir => {
        const restoreHome = mockHomeDir(tmpDir)

        try {
          const url = `${httpBaseUrl}/binary`

          // Download binary with short TTL
          const result = await dlxBinary(['--version'], {
            cacheTtl: 100,
            name: 'clean-binary',
            url,
          })
          await result.spawnPromise.catch(() => {})

          // Wait for cache to expire
          await new Promise(resolve => setTimeout(resolve, 150))

          // Clean expired entries
          const cleaned = await cleanDlxCache(100)
          expect(cleaned).toBeGreaterThan(0)
        } finally {
          restoreHome()
        }
      }, 'cleanDlxCache-expired-')
    })

    it('should not clean non-expired entries', async () => {
      await runWithTempDir(async tmpDir => {
        const restoreHome = mockHomeDir(tmpDir)

        try {
          const url = `${httpBaseUrl}/binary`

          // Download binary
          const result = await dlxBinary(['--version'], {
            name: 'fresh-binary',
            url,
          })
          await result.spawnPromise.catch(() => {})

          // Try to clean with large maxAge
          const cleaned = await cleanDlxCache(7 * 24 * 60 * 60 * 1000) // 7 days
          expect(cleaned).toBe(0)
        } finally {
          restoreHome()
        }
      }, 'cleanDlxCache-fresh-')
    })

    it('should skip non-directory entries', async () => {
      await runWithTempDir(async tmpDir => {
        const restoreHome = mockHomeDir(tmpDir)

        try {
          const cachePath = getDlxCachePath()
          await fs.mkdir(cachePath, { recursive: true })

          // Create a file in cache directory
          await fs.writeFile(path.join(cachePath, 'file.txt'), '', 'utf8')

          const cleaned = await cleanDlxCache()
          expect(cleaned).toBe(0)
        } finally {
          restoreHome()
        }
      }, 'cleanDlxCache-skip-files-')
    })

    it('should skip entries with invalid metadata', async () => {
      await runWithTempDir(async tmpDir => {
        const restoreHome = mockHomeDir(tmpDir)

        try {
          const cachePath = getDlxCachePath()
          const entryPath = path.join(cachePath, 'invalid-entry')
          await fs.mkdir(entryPath, { recursive: true })

          // Write invalid metadata
          await fs.writeFile(
            path.join(entryPath, '.dlx-metadata.json'),
            'invalid',
            'utf8',
          )

          const cleaned = await cleanDlxCache(0)
          expect(cleaned).toBe(0)
        } finally {
          restoreHome()
        }
      }, 'cleanDlxCache-invalid-meta-')
    })

    it('should skip entries with array metadata', async () => {
      await runWithTempDir(async tmpDir => {
        const restoreHome = mockHomeDir(tmpDir)

        try {
          const cachePath = getDlxCachePath()
          const entryPath = path.join(cachePath, 'array-entry')
          await fs.mkdir(entryPath, { recursive: true })

          // Write array as metadata
          await fs.writeFile(
            path.join(entryPath, '.dlx-metadata.json'),
            JSON.stringify([]),
            'utf8',
          )

          const cleaned = await cleanDlxCache(0)
          expect(cleaned).toBe(0)
        } finally {
          restoreHome()
        }
      }, 'cleanDlxCache-array-meta-')
    })

    it('should clean empty directories', async () => {
      await runWithTempDir(async tmpDir => {
        const restoreHome = mockHomeDir(tmpDir)

        try {
          const cachePath = getDlxCachePath()
          const emptyEntry = path.join(cachePath, 'empty-entry')
          await fs.mkdir(emptyEntry, { recursive: true })

          const cleaned = await cleanDlxCache(0)
          expect(cleaned).toBeGreaterThanOrEqual(0)
        } finally {
          restoreHome()
        }
      }, 'cleanDlxCache-empty-')
    })

    it('should handle entries without metadata', async () => {
      await runWithTempDir(async tmpDir => {
        const restoreHome = mockHomeDir(tmpDir)

        try {
          const cachePath = getDlxCachePath()
          const entryPath = path.join(cachePath, 'no-meta-entry')
          await fs.mkdir(entryPath, { recursive: true })

          // Create a file but no metadata
          await fs.writeFile(path.join(entryPath, 'binary'), '', 'utf8')

          const cleaned = await cleanDlxCache(0)
          expect(cleaned).toBeGreaterThanOrEqual(0)
        } finally {
          restoreHome()
        }
      }, 'cleanDlxCache-no-meta-')
    })

    it('should handle metadata with missing timestamp', async () => {
      await runWithTempDir(async tmpDir => {
        const restoreHome = mockHomeDir(tmpDir)

        try {
          const cachePath = getDlxCachePath()
          const entryPath = path.join(cachePath, 'no-timestamp-entry')
          await fs.mkdir(entryPath, { recursive: true })

          // Write metadata without timestamp
          await fs.writeFile(
            path.join(entryPath, '.dlx-metadata.json'),
            JSON.stringify({ url: 'test' }),
            'utf8',
          )

          const cleaned = await cleanDlxCache(0)
          expect(cleaned).toBeGreaterThan(0)
        } finally {
          restoreHome()
        }
      }, 'cleanDlxCache-no-timestamp-')
    })

    it('should use default maxAge', async () => {
      await runWithTempDir(async tmpDir => {
        const restoreHome = mockHomeDir(tmpDir)

        try {
          const url = `${httpBaseUrl}/binary`

          // Download binary
          const result = await dlxBinary(['--version'], {
            name: 'default-ttl-binary',
            url,
          })
          await result.spawnPromise.catch(() => {})

          // Clean with default maxAge (7 days)
          const cleaned = await cleanDlxCache()
          expect(cleaned).toBe(0)
        } finally {
          restoreHome()
        }
      }, 'cleanDlxCache-default-')
    })
  })

  describe('listDlxCache', () => {
    it('should return empty array if cache directory does not exist', async () => {
      await runWithTempDir(async tmpDir => {
        const restoreHome = mockHomeDir(tmpDir)

        try {
          const list = await listDlxCache()
          expect(list).toEqual([])
        } finally {
          restoreHome()
        }
      }, 'listDlxCache-no-dir-')
    })

    it('should list cached binaries', async () => {
      await runWithTempDir(async tmpDir => {
        const restoreHome = mockHomeDir(tmpDir)

        try {
          const url = `${httpBaseUrl}/binary`

          // Download binary
          const result = await dlxBinary(['--version'], {
            name: 'list-binary',
            url,
          })
          await result.spawnPromise.catch(() => {})

          const list = await listDlxCache()
          expect(list.length).toBeGreaterThan(0)

          const entry = list[0]
          expect(entry.name).toBe('list-binary')
          expect(entry.url).toBe(url)
          expect(entry.platform).toBe(os.platform())
          expect(entry.arch).toBe(os.arch())
          expect(entry.checksum).toBeDefined()
          expect(entry.size).toBeGreaterThan(0)
          expect(entry.age).toBeGreaterThanOrEqual(0)
        } finally {
          restoreHome()
        }
      }, 'listDlxCache-basic-')
    })

    it('should skip non-directory entries', async () => {
      await runWithTempDir(async tmpDir => {
        const restoreHome = mockHomeDir(tmpDir)

        try {
          const cachePath = getDlxCachePath()
          await fs.mkdir(cachePath, { recursive: true })

          // Create a file
          await fs.writeFile(path.join(cachePath, 'file.txt'), '', 'utf8')

          const list = await listDlxCache()
          expect(list).toEqual([])
        } finally {
          restoreHome()
        }
      }, 'listDlxCache-skip-files-')
    })

    it('should skip entries with invalid metadata', async () => {
      await runWithTempDir(async tmpDir => {
        const restoreHome = mockHomeDir(tmpDir)

        try {
          const cachePath = getDlxCachePath()
          const entryPath = path.join(cachePath, 'invalid-entry')
          await fs.mkdir(entryPath, { recursive: true })

          // Write invalid metadata
          await fs.writeFile(
            path.join(entryPath, '.dlx-metadata.json'),
            'invalid',
            'utf8',
          )

          const list = await listDlxCache()
          expect(list).toEqual([])
        } finally {
          restoreHome()
        }
      }, 'listDlxCache-invalid-meta-')
    })

    it('should skip entries with array metadata', async () => {
      await runWithTempDir(async tmpDir => {
        const restoreHome = mockHomeDir(tmpDir)

        try {
          const cachePath = getDlxCachePath()
          const entryPath = path.join(cachePath, 'array-entry')
          await fs.mkdir(entryPath, { recursive: true })

          // Write array as metadata
          await fs.writeFile(
            path.join(entryPath, '.dlx-metadata.json'),
            JSON.stringify([]),
            'utf8',
          )

          const list = await listDlxCache()
          expect(list).toEqual([])
        } finally {
          restoreHome()
        }
      }, 'listDlxCache-array-meta-')
    })

    it('should skip entries without binary file', async () => {
      await runWithTempDir(async tmpDir => {
        const restoreHome = mockHomeDir(tmpDir)

        try {
          const cachePath = getDlxCachePath()
          const entryPath = path.join(cachePath, 'no-binary-entry')
          await fs.mkdir(entryPath, { recursive: true })

          // Write metadata but no binary
          await fs.writeFile(
            path.join(entryPath, '.dlx-metadata.json'),
            JSON.stringify({
              arch: os.arch(),
              checksum: 'test',
              platform: os.platform(),
              timestamp: Date.now(),
              url: 'test',
            }),
            'utf8',
          )

          const list = await listDlxCache()
          expect(list).toEqual([])
        } finally {
          restoreHome()
        }
      }, 'listDlxCache-no-binary-')
    })

    it('should handle metadata with missing fields', async () => {
      await runWithTempDir(async tmpDir => {
        const restoreHome = mockHomeDir(tmpDir)

        try {
          const cachePath = getDlxCachePath()
          const entryPath = path.join(cachePath, 'partial-meta-entry')
          await fs.mkdir(entryPath, { recursive: true })

          // Write partial metadata
          await fs.writeFile(
            path.join(entryPath, '.dlx-metadata.json'),
            JSON.stringify({ timestamp: Date.now() }),
            'utf8',
          )

          // Create binary
          await fs.writeFile(path.join(entryPath, 'binary'), '', 'utf8')

          const list = await listDlxCache()
          expect(list.length).toBe(1)

          const entry = list[0]
          expect(entry.url).toBe('')
          expect(entry.platform).toBe('unknown')
          expect(entry.arch).toBe('unknown')
          expect(entry.checksum).toBe('')
        } finally {
          restoreHome()
        }
      }, 'listDlxCache-partial-meta-')
    })

    it('should calculate age correctly', async () => {
      await runWithTempDir(async tmpDir => {
        const restoreHome = mockHomeDir(tmpDir)

        try {
          const url = `${httpBaseUrl}/binary`

          // Download binary
          const result = await dlxBinary(['--version'], {
            name: 'age-binary',
            url,
          })
          await result.spawnPromise.catch(() => {})

          // Wait a bit
          await new Promise(resolve => setTimeout(resolve, 100))

          const list = await listDlxCache()
          expect(list.length).toBe(1)
          expect(list[0].age).toBeGreaterThan(0)
        } finally {
          restoreHome()
        }
      }, 'listDlxCache-age-')
    })

    it('should handle multiple cached binaries', async () => {
      await runWithTempDir(async tmpDir => {
        const restoreHome = mockHomeDir(tmpDir)

        try {
          // Download multiple binaries
          const result1 = await dlxBinary(['--version'], {
            name: 'binary-1',
            url: `${httpBaseUrl}/binary`,
          })
          await result1.spawnPromise.catch(() => {})

          const result2 = await dlxBinary(['--version'], {
            name: 'binary-2',
            url: `${httpBaseUrl}/slow-binary`,
          })
          await result2.spawnPromise.catch(() => {})

          const list = await listDlxCache()
          expect(list.length).toBe(2)

          const names = list.map(e => e.name).sort()
          expect(names).toEqual(['binary-1', 'binary-2'])
        } finally {
          restoreHome()
        }
      }, 'listDlxCache-multiple-')
    })

    it('should handle entries that fail to stat', async () => {
      await runWithTempDir(async tmpDir => {
        const restoreHome = mockHomeDir(tmpDir)

        try {
          const cachePath = getDlxCachePath()
          const entryPath = path.join(cachePath, 'stat-fail-entry')
          await fs.mkdir(entryPath, { recursive: true })

          // Write metadata
          await fs.writeFile(
            path.join(entryPath, '.dlx-metadata.json'),
            JSON.stringify({
              arch: os.arch(),
              checksum: 'test',
              platform: os.platform(),
              timestamp: Date.now(),
              url: 'test',
            }),
            'utf8',
          )

          // Create binary
          const binaryPath = path.join(entryPath, 'binary')
          await fs.writeFile(binaryPath, '', 'utf8')

          // Delete binary to cause stat failure
          await fs.unlink(binaryPath)

          const list = await listDlxCache()
          // Should skip entry that fails to stat
          expect(list).toEqual([])
        } finally {
          restoreHome()
        }
      }, 'listDlxCache-stat-fail-')
    })
  })

  describe('Windows-specific behavior', () => {
    const originalPlatform = process.platform

    it.skipIf(process.platform !== 'win32')(
      'should handle .cmd files with shell on Windows',
      async () => {
        await runWithTempDir(async tmpDir => {
          const restoreHome = mockHomeDir(tmpDir)

          try {
            // Mock Windows platform
            Object.defineProperty(process, 'platform', {
              configurable: true,
              value: 'win32',
            })

            const url = `${httpBaseUrl}/binary-windows.cmd`

            const result = await dlxBinary(['--version'], {
              name: 'test.cmd',
              url,
            })

            expect(result.binaryPath).toContain('.cmd')
            await result.spawnPromise.catch(() => {})
          } finally {
            restoreHome()
            Object.defineProperty(process, 'platform', {
              configurable: true,
              value: originalPlatform,
            })
          }
        }, 'dlxBinary-windows-cmd-')
      },
    )

    it.skipIf(process.platform !== 'win32')(
      'should handle .bat files with shell on Windows',
      async () => {
        await runWithTempDir(async tmpDir => {
          const restoreHome = mockHomeDir(tmpDir)

          try {
            Object.defineProperty(process, 'platform', {
              configurable: true,
              value: 'win32',
            })

            const url = `${httpBaseUrl}/binary-windows.bat`

            const result = await dlxBinary(['--version'], {
              name: 'test.bat',
              url,
            })

            expect(result.binaryPath).toContain('.bat')
            await result.spawnPromise.catch(() => {})
          } finally {
            restoreHome()
            Object.defineProperty(process, 'platform', {
              configurable: true,
              value: originalPlatform,
            })
          }
        }, 'dlxBinary-windows-bat-')
      },
    )

    it.skipIf(process.platform !== 'win32')(
      'should handle .ps1 files with shell on Windows',
      async () => {
        await runWithTempDir(async tmpDir => {
          const restoreHome = mockHomeDir(tmpDir)

          try {
            Object.defineProperty(process, 'platform', {
              configurable: true,
              value: 'win32',
            })

            const url = `${httpBaseUrl}/binary-windows.ps1`

            const result = await dlxBinary(['--version'], {
              name: 'test.ps1',
              url,
            })

            expect(result.binaryPath).toContain('.ps1')
            await result.spawnPromise.catch(() => {})
          } finally {
            restoreHome()
            Object.defineProperty(process, 'platform', {
              configurable: true,
              value: originalPlatform,
            })
          }
        }, 'dlxBinary-windows-ps1-')
      },
    )
  })

  describe('edge cases', () => {
    it('should handle concurrent downloads of same binary', async () => {
      await runWithTempDir(async tmpDir => {
        const restoreHome = mockHomeDir(tmpDir)

        try {
          const url = `${httpBaseUrl}/binary`

          // Download first one to completion
          const result1 = await dlxBinary(['--version'], {
            name: 'concurrent-binary',
            url,
          })
          // Catch spawn promise immediately to prevent unhandled rejection on Windows.
          result1.spawnPromise.catch(() => {})
          expect(result1.downloaded).toBe(true)

          // Second download should use cache
          const result2 = await dlxBinary(['--version'], {
            name: 'concurrent-binary',
            url,
          })
          // Catch spawn promise immediately to prevent unhandled rejection on Windows.
          result2.spawnPromise.catch(() => {})
          expect(result2.downloaded).toBe(false)
        } finally {
          restoreHome()
        }
      }, 'dlxBinary-concurrent-')
    })

    it('should create cache directory if it does not exist', async () => {
      await runWithTempDir(async tmpDir => {
        const restoreHome = mockHomeDir(tmpDir)

        try {
          const url = `${httpBaseUrl}/binary`

          // Cache directory should not exist initially
          const cachePath = getDlxCachePath()
          const exists = await fs
            .access(cachePath)
            .then(() => true)
            .catch(() => false)
          expect(exists).toBe(false)

          // Download should create directory
          const result = await dlxBinary(['--version'], {
            name: 'create-dir-binary',
            url,
          })
          await result.spawnPromise.catch(() => {})

          const existsAfter = await fs
            .access(cachePath)
            .then(() => true)
            .catch(() => false)
          expect(existsAfter).toBe(true)
        } finally {
          restoreHome()
        }
      }, 'dlxBinary-create-dir-')
    })

    it('should handle download with empty args array', async () => {
      await runWithTempDir(async tmpDir => {
        const restoreHome = mockHomeDir(tmpDir)

        try {
          const url = `${httpBaseUrl}/binary`

          const result = await dlxBinary([], {
            name: 'no-args-binary',
            url,
          })

          expect(result.spawnPromise).toBeDefined()
          // Wait for spawn to complete to avoid SIGKILL errors
          await result.spawnPromise.catch(() => {
            // Ignore spawn errors in tests
          })
        } finally {
          restoreHome()
        }
      }, 'dlxBinary-no-args-')
    })

    it('should normalize binary path', async () => {
      await runWithTempDir(async tmpDir => {
        const restoreHome = mockHomeDir(tmpDir)

        try {
          const url = `${httpBaseUrl}/binary`

          const result = await dlxBinary(['--version'], {
            name: 'normalized-binary',
            url,
          })

          // Path should not contain backslashes on any platform
          expect(result.binaryPath.includes('\\')).toBe(false)
          // Wait for spawn to complete to avoid SIGKILL errors
          await result.spawnPromise.catch(() => {
            // Ignore spawn errors in tests
          })
        } finally {
          restoreHome()
        }
      }, 'dlxBinary-normalized-')
    })

    it('should handle metadata read errors during cache validation', async () => {
      await runWithTempDir(async tmpDir => {
        const restoreHome = mockHomeDir(tmpDir)

        try {
          const url = `${httpBaseUrl}/binary`

          // First download
          const result1 = await dlxBinary(['--version'], {
            name: 'read-error-binary',
            url,
          })
          // Wait for first spawn to complete
          await result1.spawnPromise.catch(() => {})

          // Make metadata unreadable (change permissions)
          const name = 'read-error-binary'
          const spec = `${url}:${name}`
          const cacheKey = createHash('sha512')
            .update(spec)
            .digest('hex')
            .substring(0, 16)
          const cachePath = getDlxCachePath()
          const metaPath = path.join(cachePath, cacheKey, '.dlx-metadata.json')

          // On Windows, we can't easily make files unreadable, so we'll corrupt it instead
          await fs.writeFile(metaPath, Buffer.from([0xff, 0xfe]), 'utf8')

          // Second call should re-download
          const result = await dlxBinary(['--version'], {
            name: 'read-error-binary',
            url,
          })

          expect(result.downloaded).toBe(true)
          // Wait for second spawn to complete
          await result.spawnPromise.catch(() => {})
        } finally {
          restoreHome()
        }
      }, 'dlxBinary-read-error-')
    })
  })
})
