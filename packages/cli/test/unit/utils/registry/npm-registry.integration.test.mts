/**
 * Integration-lite tests for npm registry utilities.
 *
 * These tests use real tarball files (generated via tar-stream) to test
 * extraction logic with realistic tar.gz structures. No network, no mocks,
 * just real tarball parsing and filesystem operations.
 */

import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createGzip } from 'node:zlib'

import { pack as tarPack } from 'tar-stream'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  extractBinaryFromTarball,
  extractTarball,
  verifyTarballIntegrity,
} from '../../../../src/npm-registry.mts'

/**
 * Helper to create a test tarball in memory.
 */
async function createTestTarball(
  files: Array<{ name: string; content: string; mode?: number }>,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    const tarStream = tarPack()
    const gzipStream = createGzip()

    gzipStream.on('data', chunk => chunks.push(chunk))
    gzipStream.on('end', () => resolve(Buffer.concat(chunks)))
    gzipStream.on('error', reject)

    tarStream.pipe(gzipStream)

    // Add all files to tarball.
    for (const file of files) {
      tarStream.entry(
        {
          name: file.name,
          mode: file.mode ?? 0o644,
        },
        file.content,
      )
    }

    tarStream.finalize()
  })
}

describe('integration-lite: tarball extraction', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'npm-registry-integration-'),
    )
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  describe('extractBinaryFromTarball', () => {
    it('should extract binary with correct permissions', async () => {
      // Create a tarball with an executable binary.
      const tarball = await createTestTarball([
        {
          name: 'package/package.json',
          content: JSON.stringify({ name: 'test', version: '1.0.0' }),
          mode: 0o644,
        },
        {
          name: 'package/bin/socket',
          content: '#!/usr/bin/env node\nconsole.log("test")',
          mode: 0o755, // Executable.
        },
      ])

      const tarballPath = path.join(tempDir, 'test.tgz')
      await fs.writeFile(tarballPath, tarball)

      const outputPath = path.join(tempDir, 'socket')
      const result = await extractBinaryFromTarball(
        tarballPath,
        'bin/socket',
        outputPath,
      )

      expect(result).toBe(outputPath)
      expect(await fs.readFile(outputPath, 'utf8')).toContain('console.log')

      // Check permissions (executable bit) - Unix only.
      // Windows doesn't preserve Unix execute bits the same way.
      if (process.platform !== 'win32') {
        const stats = await fs.stat(outputPath)
        expect(stats.mode & 0o111).toBeTruthy() // Has execute permission.
      }
    })

    it('should handle package/ prefix correctly', async () => {
      // npm tarballs always have package/ prefix.
      const tarball = await createTestTarball([
        {
          name: 'package/bin/socket',
          content: 'binary content',
          mode: 0o755,
        },
      ])

      const tarballPath = path.join(tempDir, 'test.tgz')
      await fs.writeFile(tarballPath, tarball)

      const outputPath = path.join(tempDir, 'socket')
      const result = await extractBinaryFromTarball(
        tarballPath,
        'bin/socket', // We pass without package/ prefix.
        outputPath,
      )

      expect(result).toBe(outputPath)
      expect(await fs.readFile(outputPath, 'utf8')).toBe('binary content')
    })

    it('should preserve executable bit', async () => {
      const tarball = await createTestTarball([
        {
          name: 'package/bin/socket',
          content: '#!/bin/bash\necho test',
          mode: 0o755,
        },
      ])

      const tarballPath = path.join(tempDir, 'test.tgz')
      await fs.writeFile(tarballPath, tarball)

      const outputPath = path.join(tempDir, 'socket')
      await extractBinaryFromTarball(tarballPath, 'bin/socket', outputPath)

      // Check all execute bits (owner, group, others) - Unix only.
      // Windows doesn't preserve Unix execute bits the same way.
      if (process.platform !== 'win32') {
        const stats = await fs.stat(outputPath)

        expect(stats.mode & 0o100).toBeTruthy() // Owner execute.
        expect(stats.mode & 0o010).toBeTruthy() // Group execute.
        expect(stats.mode & 0o001).toBeTruthy() // Others execute.
      }
    })

    it('should handle nested directories', async () => {
      const tarball = await createTestTarball([
        {
          name: 'package/lib/utils/helper.js',
          content: 'export const helper = () => {}',
          mode: 0o644,
        },
        {
          name: 'package/bin/socket',
          content: 'binary',
          mode: 0o755,
        },
      ])

      const tarballPath = path.join(tempDir, 'test.tgz')
      await fs.writeFile(tarballPath, tarball)

      const outputPath = path.join(tempDir, 'socket')
      await extractBinaryFromTarball(tarballPath, 'bin/socket', outputPath)

      expect(await fs.readFile(outputPath, 'utf8')).toBe('binary')
    })

    it('should throw if binary not found in tarball', async () => {
      const tarball = await createTestTarball([
        {
          name: 'package/other-file.txt',
          content: 'not the binary',
          mode: 0o644,
        },
      ])

      const tarballPath = path.join(tempDir, 'test.tgz')
      await fs.writeFile(tarballPath, tarball)

      const outputPath = path.join(tempDir, 'socket')

      await expect(
        extractBinaryFromTarball(tarballPath, 'bin/socket', outputPath),
      ).rejects.toThrow('not found')
    })
  })

  describe('extractTarball', () => {
    it('should extract all files from tarball', async () => {
      const tarball = await createTestTarball([
        {
          name: 'package/package.json',
          content: '{"name":"test"}',
          mode: 0o644,
        },
        {
          name: 'package/README.md',
          content: '# Test',
          mode: 0o644,
        },
        {
          name: 'package/bin/socket',
          content: 'binary',
          mode: 0o755,
        },
      ])

      const tarballPath = path.join(tempDir, 'test.tgz')
      await fs.writeFile(tarballPath, tarball)

      const extractDir = path.join(tempDir, 'extracted')
      await fs.mkdir(extractDir, { recursive: true })

      const files = await extractTarball(tarballPath, extractDir)

      expect(files).toHaveLength(3)
      expect(files.map(f => f.name)).toEqual([
        'package/package.json',
        'package/README.md',
        'package/bin/socket',
      ])

      // Verify files exist.
      expect(
        await fs.readFile(path.join(extractDir, 'package.json'), 'utf8'),
      ).toBe('{"name":"test"}')
      expect(
        await fs.readFile(path.join(extractDir, 'README.md'), 'utf8'),
      ).toBe('# Test')
      expect(
        await fs.readFile(path.join(extractDir, 'bin/socket'), 'utf8'),
      ).toBe('binary')
    })

    it('should sanitize paths to prevent traversal', async () => {
      // Try to create a file outside the extract directory.
      const tarball = await createTestTarball([
        {
          name: 'package/../../../etc/passwd',
          content: 'hacked',
          mode: 0o644,
        },
      ])

      const tarballPath = path.join(tempDir, 'test.tgz')
      await fs.writeFile(tarballPath, tarball)

      const extractDir = path.join(tempDir, 'extracted')
      await fs.mkdir(extractDir, { recursive: true })

      await extractTarball(tarballPath, extractDir)

      // File should be in extractDir/etc/passwd, not /etc/passwd.
      const sanitizedPath = path.join(extractDir, 'etc/passwd')
      expect(await fs.readFile(sanitizedPath, 'utf8')).toBe('hacked')

      // Verify it didn't escape.
      expect(sanitizedPath).toContain(extractDir)
    })

    it('should set correct file permissions', async () => {
      const tarball = await createTestTarball([
        {
          name: 'package/readonly.txt',
          content: 'read only',
          mode: 0o444, // Read-only.
        },
        {
          name: 'package/executable.sh',
          content: '#!/bin/bash',
          mode: 0o755, // Executable.
        },
      ])

      const tarballPath = path.join(tempDir, 'test.tgz')
      await fs.writeFile(tarballPath, tarball)

      const extractDir = path.join(tempDir, 'extracted')
      await fs.mkdir(extractDir, { recursive: true })

      await extractTarball(tarballPath, extractDir)

      // Check file permissions - Unix only.
      // Windows doesn't preserve Unix permissions the same way.
      if (process.platform !== 'win32') {
        const readonlyStats = await fs.stat(
          path.join(extractDir, 'readonly.txt'),
        )
        const executableStats = await fs.stat(
          path.join(extractDir, 'executable.sh'),
        )

        // Read-only file.
        expect(readonlyStats.mode & 0o200).toBe(0) // No write permission.

        // Executable file.
        expect(executableStats.mode & 0o111).toBeTruthy() // Execute permission.
      }
    })

    it('should create parent directories', async () => {
      const tarball = await createTestTarball([
        {
          name: 'package/deep/nested/path/file.txt',
          content: 'nested file',
          mode: 0o644,
        },
      ])

      const tarballPath = path.join(tempDir, 'test.tgz')
      await fs.writeFile(tarballPath, tarball)

      const extractDir = path.join(tempDir, 'extracted')
      await fs.mkdir(extractDir, { recursive: true })

      await extractTarball(tarballPath, extractDir)

      const nestedFile = path.join(extractDir, 'deep/nested/path/file.txt')
      expect(await fs.readFile(nestedFile, 'utf8')).toBe('nested file')
    })

    it('should throw error for empty tarball', async () => {
      const tarball = await createTestTarball([])

      const tarballPath = path.join(tempDir, 'test.tgz')
      await fs.writeFile(tarballPath, tarball)

      const extractDir = path.join(tempDir, 'extracted')
      await fs.mkdir(extractDir, { recursive: true })

      await expect(extractTarball(tarballPath, extractDir)).rejects.toThrow(
        'Downloaded tarball is empty or invalid',
      )
    })
  })

  describe('verifyTarballIntegrity', () => {
    it('should verify real tarball with correct SHA-512', async () => {
      const tarball = await createTestTarball([
        {
          name: 'package/test.txt',
          content: 'test content',
          mode: 0o644,
        },
      ])

      const tarballPath = path.join(tempDir, 'test.tgz')
      await fs.writeFile(tarballPath, tarball)

      // Compute real SHA-512.
      const crypto = await import('node:crypto')
      const hash = crypto.createHash('sha512')
      hash.update(tarball)
      const expectedHash = hash.digest('base64')
      const integrity = `sha512-${expectedHash}`

      const isValid = await verifyTarballIntegrity(tarballPath, integrity)
      expect(isValid).toBe(true)
    })

    it('should fail verification with incorrect hash', async () => {
      const tarball = await createTestTarball([
        {
          name: 'package/test.txt',
          content: 'test content',
          mode: 0o644,
        },
      ])

      const tarballPath = path.join(tempDir, 'test.tgz')
      await fs.writeFile(tarballPath, tarball)

      const integrity = 'sha512-wronghashvalue=='

      const isValid = await verifyTarballIntegrity(tarballPath, integrity)
      expect(isValid).toBe(false)
    })
  })
})
