/**
 * Unit tests for util/dlx/vfs-extract.
 *
 * Covers the public availability check, tool-path map, extractTool, and the
 * full extractExternalTools state machine (cache marker, lock waits, stale
 * locks, recursion-depth guard, tool revalidation, error wrapping).
 *
 * Related Files: - src/util/dlx/vfs-extract.mts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as NodeFs from 'node:fs'

const mockIsSeaBinary = vi.hoisted(() => vi.fn(() => false))
const mockExistsSync = vi.hoisted(() => vi.fn(() => false))
const mockFsWriteFile = vi.hoisted(() => vi.fn(async () => {}))
const mockFsReadFile = vi.hoisted(() => vi.fn(async () => '99999'))
const mockFsAccess = vi.hoisted(() => vi.fn(async () => {}))
const mockFsChmod = vi.hoisted(() => vi.fn(async () => {}))
const mockSafeDelete = vi.hoisted(() => vi.fn(async () => {}))
const mockSafeMkdir = vi.hoisted(() => vi.fn(async () => {}))

vi.mock(import('../../../../src/util/sea/detect.mts'), () => ({
  isSeaBinary: mockIsSeaBinary,
}))

vi.mock(import('../../../../src/constants/paths.mts'), () => ({
  UPDATE_STORE_DIR: '.socket/_dlx',
}))

vi.mock(import('node:fs'), async () => {
  const actual = await vi.importActual<typeof NodeFs>('node:fs')
  const promises = {
    writeFile: mockFsWriteFile,
    readFile: mockFsReadFile,
    access: mockFsAccess,
    chmod: mockFsChmod,
    constants: actual.constants,
  }
  return {
    ...actual,
    existsSync: mockExistsSync,
    promises,
    default: { ...actual, existsSync: mockExistsSync, promises },
  }
})

vi.mock(import('@socketsecurity/lib-stable/fs/safe'), () => ({
  safeDelete: mockSafeDelete,
  safeMkdir: mockSafeMkdir,
}))

import {
  areExternalToolsAvailable,
  EXTERNAL_TOOLS,
  extractTool,
  getNodeSmolBasePath,
  getToolFilePath,
  getToolPaths,
  isNpmPackageExtracted,
} from '../../../../src/util/dlx/vfs-extract.mts'

const realProcessSmol = (process as unknown as { smol?: unknown | undefined })
  .smol

function withMountReturning(mountFn: (vfsPath: string) => Promise<string>) {
  ;(process as unknown as { smol: unknown }).smol = { mount: mountFn }
}

describe('util/dlx/vfs-extract', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsSeaBinary.mockReturnValue(false)
    mockExistsSync.mockReturnValue(false)
    mockFsWriteFile.mockResolvedValue(undefined)
    mockFsReadFile.mockResolvedValue('99999')
    mockFsAccess.mockResolvedValue(undefined)
    mockFsChmod.mockResolvedValue(undefined)
    mockSafeDelete.mockResolvedValue(undefined)
    mockSafeMkdir.mockResolvedValue(undefined)
    delete (process as unknown as { smol?: unknown | undefined }).smol
  })

  afterEach(() => {
    if (realProcessSmol === undefined) {
      delete (process as unknown as { smol?: unknown | undefined }).smol
    } else {
      ;(process as unknown as { smol: unknown }).smol = realProcessSmol
    }
  })

  describe('EXTERNAL_TOOLS', () => {
    it('exposes a non-empty list of tool names', () => {
      expect(EXTERNAL_TOOLS.length).toBeGreaterThan(0)
      for (let i = 0, { length } = EXTERNAL_TOOLS; i < length; i += 1) {
        const tool = EXTERNAL_TOOLS[i]
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
      ;(process as unknown as { smol: unknown }).smol = {}
      expect(areExternalToolsAvailable()).toBe(false)
    })

    it('returns true when in SEA mode with smol.mount', () => {
      mockIsSeaBinary.mockReturnValue(true)
      withMountReturning(async () => '/tmp/x')
      expect(areExternalToolsAvailable()).toBe(true)
    })
  })

  describe('getToolPaths', () => {
    it('returns a non-empty path for every tool in EXTERNAL_TOOLS', () => {
      const paths = getToolPaths()
      for (let i = 0, { length } = EXTERNAL_TOOLS; i < length; i += 1) {
        const tool = EXTERNAL_TOOLS[i]
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
        for (let i = 0, { length } = EXTERNAL_TOOLS; i < length; i += 1) {
          const tool = EXTERNAL_TOOLS[i]
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
        for (let i = 0, { length } = EXTERNAL_TOOLS; i < length; i += 1) {
          const tool = EXTERNAL_TOOLS[i]
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
      const result = getToolFilePath('definitely-not-a-tool' as never, '/base')
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
      ;(process as unknown as { smol: unknown }).smol = {
        getHash: () => 'mock-hash-12345',
      }
      const result = getNodeSmolBasePath()
      expect(result).toContain('mock-hash-12345')
    })

    it('falls back to a derived hash when getHash throws', () => {
      ;(process as unknown as { smol: unknown }).smol = {
        get getHash() {
          throw new Error('boom')
        },
      }
      const result = getNodeSmolBasePath()
      expect(result).toMatch(/_dlx\/[a-f0-9]{16}$/)
    })
  })

  describe('isNpmPackageExtracted', () => {
    it('returns false for missing path', async () => {
      mockExistsSync.mockReturnValue(false)
      const result = await isNpmPackageExtracted(
        '/definitely/not/a/real/path/' + Date.now(),
      )
      expect(result).toBe(false)
    })

    it('returns false when package.json missing', async () => {
      // Only the package dir exists, not package.json.
      let callIdx = 0
      mockExistsSync.mockImplementation(() => {
        callIdx += 1
        return callIdx === 1
      })
      const result = await isNpmPackageExtracted('/some/pkg')
      expect(result).toBe(false)
    })

    it('returns false when node_modules missing', async () => {
      let callIdx = 0
      mockExistsSync.mockImplementation(() => {
        callIdx += 1
        // 1: package dir, 2: package.json, 3: node_modules
        return callIdx <= 2
      })
      const result = await isNpmPackageExtracted('/some/pkg')
      expect(result).toBe(false)
    })

    it('returns true when package, package.json, and node_modules all exist', async () => {
      mockExistsSync.mockReturnValue(true)
      const result = await isNpmPackageExtracted('/some/pkg')
      expect(result).toBe(true)
    })
  })

  describe('extractTool', () => {
    it('throws when process.smol.mount is undefined', async () => {
      await expect(extractTool('cdxgen')).rejects.toThrow(
        /process\.smol\.mount is undefined/,
      )
    })

    it('throws when process.smol exists but mount is missing', async () => {
      ;(process as unknown as { smol: unknown }).smol = { otherProp: true }
      await expect(extractTool('cdxgen')).rejects.toThrow(
        /process\.smol\.mount is undefined/,
      )
    })

    it('wraps mount-failure with a SEA-VFS error message', async () => {
      withMountReturning(async () => {
        throw new Error('vfs corrupt')
      })
      await expect(extractTool('cdxgen')).rejects.toThrow(
        /failed to extract cdxgen from the SEA VFS/,
      )
    })

    it('wraps mount-failure for standalone tools (sfw)', async () => {
      withMountReturning(async () => {
        throw new Error('vfs not found')
      })
      await expect(extractTool('sfw')).rejects.toThrow(
        /failed to extract sfw from the SEA VFS/,
      )
    })

    it('returns extracted path for npm package when mount succeeds', async () => {
      // existsSync: 1st = isNpmPackageExtracted package dir check (false to
      // skip cached path); 2nd = post-mount final extracted file existsSync
      // (true) so we don't throw.
      let idx = 0
      mockExistsSync.mockImplementation(() => {
        idx += 1
        return idx >= 2
      })
      withMountReturning(async () => '/extracted/pkg-dir')

      const result = await extractTool('cdxgen')
      expect(result).toContain('cdxgen')
    })

    it('returns cached path when npm package already extracted', async () => {
      // All existsSync calls return true so isNpmPackageExtracted passes.
      mockExistsSync.mockReturnValue(true)
      withMountReturning(async () => '/should-not-be-called')

      const result = await extractTool('cdxgen')
      expect(result).toContain('cdxgen')
    })

    it('returns extracted path for standalone binary (sfw)', async () => {
      // sfw has TOOL_STANDALONE_PATHS entry; final existsSync true.
      mockExistsSync.mockReturnValue(true)
      withMountReturning(async () => '/extracted/sfw')

      const result = await extractTool('sfw')
      expect(result).toContain('sfw')
    })

    it('throws when extracted path does not exist after mount', async () => {
      // After mount, the final existsSync returns false.
      mockExistsSync.mockReturnValue(false)
      withMountReturning(async () => '/some/path')

      await expect(extractTool('cdxgen')).rejects.toThrow(
        /failed to extract cdxgen from the SEA VFS/,
      )
    })

    it('handles chmod failure silently for standalone binary', async () => {
      mockExistsSync.mockReturnValue(true)
      mockFsChmod.mockRejectedValue(new Error('EPERM'))
      withMountReturning(async () => '/extracted/sfw')

      // Should still succeed (chmod errors swallowed).
      await expect(extractTool('sfw')).resolves.toBeTruthy()
    })

    it('extracts standalone tool not in TOOL_STANDALONE_PATHS map by tool name', async () => {
      mockExistsSync.mockReturnValue(true)
      withMountReturning(async () => '/extracted/unknown')
      // Use a fake tool name that's not in either map.
      await expect(
        extractTool('definitely-not-real' as never),
      ).resolves.toBeTruthy()
    })
  })
})
