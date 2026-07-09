/**
 * Unit tests for util/dlx/vfs-extract extractExternalTools cache-marker
 * handling.
 *
 * Covers the happy-path cache hit, cache-miss extraction, recursion-depth
 * guard, and re-extraction when the cache marker is present but a tool is
 * missing.
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
  EXTERNAL_TOOLS,
  extractExternalTools,
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

  describe('extractExternalTools', () => {
    it('returns undefined when not running in SEA mode', async () => {
      mockIsSeaBinary.mockReturnValue(false)
      const result = await extractExternalTools()
      expect(result).toBeUndefined()
    })

    it('returns undefined when smol.mount is missing', async () => {
      mockIsSeaBinary.mockReturnValue(true)
      ;(process as unknown as { smol: unknown }).smol = { otherProp: true }
      const result = await extractExternalTools()
      expect(result).toBeUndefined()
    })

    it('returns undefined when max recursion depth exceeded', async () => {
      mockIsSeaBinary.mockReturnValue(true)
      withMountReturning(async () => '/m')
      const result = await extractExternalTools(5)
      expect(result).toBeUndefined()
    })

    it('returns cached tool paths when cache marker + tools exist', async () => {
      mockIsSeaBinary.mockReturnValue(true)
      withMountReturning(async () => '/m')
      // writeFile EEXIST? No — we want first-try success entering the main
      // body. lockFile write succeeds, then cacheMarker existsSync true.
      // existsSync calls in order: nodeSmolBase mkdir (no — that's safeMkdir),
      // then cacheMarker check (true), then for each tool: toolPath (true).
      // Then final atomic re-verify: every tool toolPath (true).
      mockExistsSync.mockReturnValue(true)

      const result = await extractExternalTools()
      expect(result).toBeTruthy()
      if (result) {
        for (let i = 0, { length } = EXTERNAL_TOOLS; i < length; i += 1) {
          const tool = EXTERNAL_TOOLS[i]
          expect(result[tool]).toBeTruthy()
        }
      }
    })

    it('rethrows non-EEXIST errors from lock file write', async () => {
      mockIsSeaBinary.mockReturnValue(true)
      withMountReturning(async () => '/m')
      mockFsWriteFile.mockRejectedValue(
        Object.assign(new Error('EACCES'), { code: 'EACCES' }),
      )

      await expect(extractExternalTools()).rejects.toThrow(/EACCES/)
    })

    it('extracts tools when cache marker missing and mount succeeds', async () => {
      mockIsSeaBinary.mockReturnValue(true)
      // existsSync: cache marker (false), then per-tool toolPathWithExt
      // existence check (false to trigger extraction), then final
      // existsSync inside extractTool after mount (true), and final
      // post-extraction existsSync for cacheMarker write — true.
      mockExistsSync.mockImplementation((p: string) => {
        // Anything that's been "extracted" (under nodeSmolBase) returns true.
        // Cache marker check needs to be false initially.
        return !p.endsWith('.extracted') && !p.endsWith('.extracting')
      })
      withMountReturning(async () => '/extracted/path')

      const result = await extractExternalTools()
      expect(result).toBeTruthy()
    })

    it('re-extracts when cache marker exists but tool is missing', async () => {
      mockIsSeaBinary.mockReturnValue(true)
      withMountReturning(async () => '/extracted')

      // First call: cache marker exists, but the first tool path check
      // returns false -> invalidate marker and re-extract. After delete:
      // proceed to extraction loop; for each tool: existsSync(toolPath)
      // returns true once mount has "happened". To simulate, return true
      // for everything except the first marker-validation tool check.
      let firstToolCheckSeen = false
      mockExistsSync.mockImplementation((p: string) => {
        const ps = String(p)
        if (ps.endsWith('.extracting')) {
          return false
        }
        // The very first existsSync call (cache marker presence check):
        // return true so we enter the validate branch.
        // Then the first toolPath check returns false to invalidate.
        // Everything else returns true.
        if (!firstToolCheckSeen && ps.includes('cdxgen')) {
          firstToolCheckSeen = true
          return false
        }
        return true
      })

      const result = await extractExternalTools()
      expect(result).toBeTruthy()
    })

    it('keeps cached path when tool is already extracted and accessible', async () => {
      mockIsSeaBinary.mockReturnValue(true)
      withMountReturning(async () => '/should-not-call')
      mockExistsSync.mockImplementation((p: string) => {
        return !String(p).endsWith('.extracted')
      })
      mockFsAccess.mockResolvedValue(undefined)

      const result = await extractExternalTools()
      expect(result).toBeTruthy()
    })
  })
})
