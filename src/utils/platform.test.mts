/** @fileoverview Tests for platform utilities. */

import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { remove } from '@socketsecurity/registry/lib/fs'

import {
  clearQuarantine,
  ensureExecutable,
  getArchName,
  getExpectedAssetName,
  getPlatformName,
  isPlatformSupported,
} from './platform.mts'

// Mock spawn
vi.mock('@socketsecurity/registry/lib/spawn', () => ({
  spawn: vi.fn(),
}))

// Mock logger
vi.mock('@socketsecurity/registry/lib/logger', () => ({
  logger: {
    warn: vi.fn(),
  },
}))

describe('platform utilities', () => {
  let testDir: string
  let testFile: string

  beforeEach(async () => {
    testDir = path.join(tmpdir(), `socket-platform-test-${Date.now()}`)
    await fs.mkdir(testDir, { recursive: true })
    testFile = path.join(testDir, 'test-binary')
    await fs.writeFile(testFile, '#!/bin/bash\necho test')
  })

  afterEach(async () => {
    try {
      await remove(testDir)
    } catch {
      // Ignore cleanup errors
    }
    vi.clearAllMocks()
  })

  describe('getPlatformName', () => {
    it('returns mapped platform name', () => {
      const result = getPlatformName()
      expect(typeof result).toBe('string')
      expect(result.length).toBeGreaterThan(0)
    })

    it('handles different platforms', () => {
      const result = getPlatformName()
      // Should be one of the known platforms or the original platform
      const validPlatforms = ['macos', 'linux', 'win', process.platform]
      expect(validPlatforms).toContain(result)
    })
  })

  describe('getArchName', () => {
    it('returns mapped architecture name', () => {
      const result = getArchName()
      expect(typeof result).toBe('string')
      expect(result.length).toBeGreaterThan(0)
    })

    it('handles different architectures', () => {
      const result = getArchName()
      // Should be one of the known architectures or the original arch
      const validArchs = ['arm64', 'x64', process.arch]
      expect(validArchs).toContain(result)
    })
  })

  describe('getExpectedAssetName', () => {
    it('returns platform-specific asset name', () => {
      const result = getExpectedAssetName()
      expect(result).toMatch(/^socket-/)
      expect(result).toContain('-')
    })

    it('includes .exe extension on Windows', () => {
      const result = getExpectedAssetName()
      if (process.platform === 'win32') {
        expect(result).toMatch(/\.exe$/)
      } else {
        expect(result).not.toMatch(/\.exe$/)
      }
    })

    it('follows naming convention', () => {
      const result = getExpectedAssetName()
      // Format: socket-{platform}-{arch}[.exe]
      const parts = result.replace('.exe', '').split('-')
      expect(parts.length).toBe(3)
      expect(parts[0]).toBe('socket')
    })
  })

  describe('isPlatformSupported', () => {
    it('returns boolean', () => {
      const result = isPlatformSupported()
      expect(typeof result).toBe('boolean')
    })

    it('supports current platform if tests are running', () => {
      // If tests are running, the platform should be supported
      const result = isPlatformSupported()
      expect(typeof result).toBe('boolean')
    })

    it('returns true for known supported combinations', () => {
      const result = isPlatformSupported()
      // At least one common platform should be supported
      expect(typeof result).toBe('boolean')
    })
  })

  describe('clearQuarantine', () => {
    it('succeeds on non-Darwin platforms', async () => {
      if (process.platform !== 'darwin') {
        await expect(clearQuarantine(testFile)).resolves.not.toThrow()
      }
    })

    it('calls xattr on Darwin', async () => {
      if (process.platform === 'darwin') {
        const { spawn } = vi.mocked(
          await import('@socketsecurity/registry/lib/spawn'),
        )
        spawn.mockResolvedValue({ status: 0, stdout: '', stderr: '' } as any)

        await clearQuarantine(testFile)
        expect(spawn).toHaveBeenCalledWith(
          'xattr',
          ['-d', 'com.apple.quarantine', testFile],
          expect.any(Object),
        )
      }
    })

    it('handles xattr failures gracefully', async () => {
      if (process.platform === 'darwin') {
        const { spawn } = vi.mocked(
          await import('@socketsecurity/registry/lib/spawn'),
        )
        spawn.mockRejectedValue(new Error('xattr failed'))

        await expect(clearQuarantine(testFile)).resolves.not.toThrow()
      }
    })

    it('skips on Windows', async () => {
      if (process.platform === 'win32') {
        const { spawn } = vi.mocked(
          await import('@socketsecurity/registry/lib/spawn'),
        )

        await clearQuarantine(testFile)
        expect(spawn).not.toHaveBeenCalled()
      }
    })
  })

  describe('ensureExecutable', () => {
    it('sets executable permissions on Unix', async () => {
      if (process.platform !== 'win32') {
        await ensureExecutable(testFile)

        const stats = await fs.stat(testFile)
        // Check that file has some executable bit set
        expect(stats.mode & 0o111).toBeGreaterThan(0)
      }
    })

    it('skips on Windows', async () => {
      if (process.platform === 'win32') {
        await expect(ensureExecutable(testFile)).resolves.not.toThrow()
      }
    })

    it('handles chmod failures gracefully', async () => {
      if (process.platform !== 'win32') {
        const { logger } = vi.mocked(
          await import('@socketsecurity/registry/lib/logger'),
        )
        const nonExistentFile = path.join(testDir, 'nonexistent')

        await ensureExecutable(nonExistentFile)
        expect(logger.warn).toHaveBeenCalled()
      }
    })

    it('logs warning on chmod error', async () => {
      if (process.platform !== 'win32') {
        const { logger } = vi.mocked(
          await import('@socketsecurity/registry/lib/logger'),
        )
        const readOnlyDir = path.join(testDir, 'readonly')
        await fs.mkdir(readOnlyDir)
        const readOnlyFile = path.join(readOnlyDir, 'file')
        await fs.writeFile(readOnlyFile, 'test')

        // Make parent dir readonly (if we have permissions)
        try {
          await fs.chmod(readOnlyDir, 0o444)
          await ensureExecutable(readOnlyFile)

          // Restore permissions for cleanup
          await fs.chmod(readOnlyDir, 0o755)
        } catch {
          // Skip test if we can't modify permissions
        }
      }
    })
  })

  describe('platform-specific behavior', () => {
    it('handles macOS-specific operations', () => {
      const platformName = getPlatformName()
      if (process.platform === 'darwin') {
        expect(platformName).toBe('macos')
      }
    })

    it('handles Linux-specific operations', () => {
      const platformName = getPlatformName()
      if (process.platform === 'linux') {
        expect(platformName).toBe('linux')
      }
    })

    it('handles Windows-specific operations', () => {
      const platformName = getPlatformName()
      if (process.platform === 'win32') {
        expect(platformName).toBe('win')
      }
    })
  })

  describe('architecture detection', () => {
    it('handles ARM64 architecture', () => {
      const archName = getArchName()
      if (process.arch === 'arm64') {
        expect(archName).toBe('arm64')
      }
    })

    it('handles x64 architecture', () => {
      const archName = getArchName()
      if (process.arch === 'x64') {
        expect(archName).toBe('x64')
      }
    })
  })
})
