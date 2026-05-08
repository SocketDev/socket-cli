/**
 * Unit tests for utils/dlx/vfs-extract.
 *
 * Covers the public availability check and tool-path map. The actual
 * extraction code path requires a real SEA binary with process.smol —
 * skipped here.
 *
 * Related Files:
 * - src/utils/dlx/vfs-extract.mts
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockIsSeaBinary = vi.hoisted(() => vi.fn(() => false))
vi.mock('../../../../src/utils/sea/detect.mts', () => ({
  isSeaBinary: mockIsSeaBinary,
}))

vi.mock('../../../../src/constants/paths.mts', () => ({
  UPDATE_STORE_DIR: '.socket/_dlx',
}))

import {
  areExternalToolsAvailable,
  EXTERNAL_TOOLS,
  extractTool,
  getNodeSmolBasePath,
  getToolFilePath,
  getToolPaths,
  isNpmPackageExtracted,
} from '../../../../src/utils/dlx/vfs-extract.mts'

const realProcessSmol = (process as any).smol

describe('utils/dlx/vfs-extract', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsSeaBinary.mockReturnValue(false)
    delete (process as any).smol
  })

  afterEach(() => {
    if (realProcessSmol === undefined) {
      delete (process as any).smol
    } else {
      (process as any).smol = realProcessSmol
    }
  })

  describe('EXTERNAL_TOOLS', () => {
    it('exposes a non-empty list of tool names', () => {
      expect(EXTERNAL_TOOLS.length).toBeGreaterThan(0)
      // Sanity: every entry is a string.
      for (const tool of EXTERNAL_TOOLS) {
        expect(typeof tool).toBe('string')
      }
    })
  })

  describe('areExternalToolsAvailable', () => {
    it('returns false when not a SEA binary', () => {
      expect(areExternalToolsAvailable()).toBe(false)
    })

    it('returns false when in SEA mode but smol.mount is missing', () => {
      mockIsSeaBinary.mockReturnValue(true)
      ;(process as any).smol = {}
      expect(areExternalToolsAvailable()).toBe(false)
    })

    it('returns true when in SEA mode with smol.mount', () => {
      mockIsSeaBinary.mockReturnValue(true)
      ;(process as any).smol = { mount: vi.fn() }
      expect(areExternalToolsAvailable()).toBe(true)
    })
  })

  describe('getToolPaths', () => {
    it('returns a non-empty path for every tool in EXTERNAL_TOOLS', () => {
      const paths = getToolPaths()
      for (const tool of EXTERNAL_TOOLS) {
        expect(paths[tool]).toBeTypeOf('string')
        expect((paths[tool] as string).length).toBeGreaterThan(0)
      }
    })

    it('appends .exe on Windows', () => {
      const realPlatform = process.platform
      Object.defineProperty(process, 'platform', {
        value: 'win32',
        configurable: true,
      })
      try {
        const paths = getToolPaths()
        for (const tool of EXTERNAL_TOOLS) {
          expect(paths[tool]).toMatch(/\.exe$/)
        }
      } finally {
        Object.defineProperty(process, 'platform', {
          value: realPlatform,
          configurable: true,
        })
      }
    })

    it('does not append .exe on POSIX', () => {
      const realPlatform = process.platform
      Object.defineProperty(process, 'platform', {
        value: 'linux',
        configurable: true,
      })
      try {
        const paths = getToolPaths()
        for (const tool of EXTERNAL_TOOLS) {
          expect(paths[tool]).not.toMatch(/\.exe$/)
        }
      } finally {
        Object.defineProperty(process, 'platform', {
          value: realPlatform,
          configurable: true,
        })
      }
    })
  })

  describe('getToolFilePath', () => {
    it('returns npm package binPath for npm tools', () => {
      const result = getToolFilePath('cdxgen', '/base')
      expect(result).toContain('node_modules/@cyclonedx/cdxgen/bin/cdxgen')
    })

    it('returns standalone path for sfw', () => {
      const result = getToolFilePath('sfw', '/base')
      expect(result).toContain('node_modules/@socketsecurity/sfw-bin/sfw')
    })

    it('returns standalone path for socket-patch', () => {
      const result = getToolFilePath('socket-patch', '/base')
      expect(result).toContain('socket-patch')
    })

    it('returns plain tool name fallback when not in either map', () => {
      const result = getToolFilePath(
        'definitely-not-a-tool' as never,
        '/base',
      )
      expect(result).toContain('definitely-not-a-tool')
    })
  })

  describe('getNodeSmolBasePath', () => {
    it('returns a path containing the dlx directory', () => {
      const result = getNodeSmolBasePath()
      expect(typeof result).toBe('string')
      expect(result).toContain('_dlx')
    })

    it('uses process.smol.getHash when available', () => {
      ;(process as any).smol = { getHash: () => 'mock-hash-12345' }
      try {
        const result = getNodeSmolBasePath()
        expect(result).toContain('mock-hash-12345')
      } finally {
        delete (process as any).smol
      }
    })

    it('falls back to a derived hash when getHash throws', () => {
      ;(process as any).smol = {
        get getHash() {
          throw new Error('boom')
        },
      }
      try {
        const result = getNodeSmolBasePath()
        // Hash falls back to slice(0, 16) of sha256.
        expect(result).toMatch(/_dlx\/[a-f0-9]{16}$/)
      } finally {
        delete (process as any).smol
      }
    })
  })

  describe('isNpmPackageExtracted', () => {
    it('returns false for missing path', async () => {
      const result = await isNpmPackageExtracted(
        '/definitely/not/a/real/path/' + Date.now(),
      )
      expect(result).toBe(false)
    })

    it('returns false when package.json missing', async () => {
      // The repo's own root has package.json + node_modules; use a sibling
      // that exists but has no package.json (e.g. /tmp itself).
      const result = await isNpmPackageExtracted('/tmp')
      // /tmp exists but has no package.json — should return false.
      expect(result).toBe(false)
    })
  })

  describe('extractTool', () => {
    it('throws when process.smol.mount is undefined', async () => {
      // No process.smol set in beforeEach — should throw.
      await expect(extractTool('cdxgen')).rejects.toThrow(
        /process\.smol\.mount is undefined/,
      )
    })

    it('throws when process.smol exists but mount is missing', async () => {
      ;(process as any).smol = { otherProp: true }
      try {
        await expect(extractTool('cdxgen')).rejects.toThrow(
          /process\.smol\.mount is undefined/,
        )
      } finally {
        delete (process as any).smol
      }
    })

    it('wraps mount-failure with a SEA-VFS error message', async () => {
      ;(process as any).smol = {
        mount: vi.fn().mockRejectedValue(new Error('vfs corrupt')),
      }
      try {
        await expect(extractTool('cdxgen')).rejects.toThrow(
          /failed to extract cdxgen from the SEA VFS/,
        )
      } finally {
        delete (process as any).smol
      }
    })

    it('wraps mount-failure for standalone tools (sfw)', async () => {
      ;(process as any).smol = {
        mount: vi.fn().mockRejectedValue(new Error('vfs not found')),
      }
      try {
        await expect(extractTool('sfw')).rejects.toThrow(
          /failed to extract sfw from the SEA VFS/,
        )
      } finally {
        delete (process as any).smol
      }
    })
  })
})
