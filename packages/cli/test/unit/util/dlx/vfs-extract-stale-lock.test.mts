/**
 * Unit tests for util/dlx/vfs-extract extractExternalTools stale-lock and
 * TOCTOU handling.
 *
 * Covers dead-PID / invalid-PID / unreadable lock-file detection, extraction
 * error propagation, safeDelete-failure tolerance, tool-access re-extraction,
 * and the cached-tools-vanish-on-recheck TOCTOU race.
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
    it('detects stale lock (dead PID) and retries via recursion', async () => {
      mockIsSeaBinary.mockReturnValue(true)
      withMountReturning(async () => '/m')

      // First writeFile: EEXIST. Second writeFile (after stale cleanup,
      // recursive call): success.
      let writeCount = 0
      mockFsWriteFile.mockImplementation(async () => {
        writeCount += 1
        if (writeCount === 1) {
          throw Object.assign(new Error('EEXIST'), { code: 'EEXIST' })
        }
        return undefined
      })

      // Stale check: readFile returns PID, process.kill throws ESRCH.
      mockFsReadFile.mockResolvedValue('12345')
      const realKill = process.kill
      ;(process as { kill: unknown }).kill = vi.fn(() => {
        throw new Error('ESRCH')
      })

      // After recursion: cache marker exists, all tools exist.
      let recursionStart = false
      mockExistsSync.mockImplementation((p: string) => {
        if (!recursionStart) {
          // We need to flip after the stale cleanup happens.
          return false
        }
        return true
      })
      // Flip flag once writeFile succeeds.
      const origImpl = mockFsWriteFile.getMockImplementation()
      mockFsWriteFile.mockImplementation(async (...args: unknown[]) => {
        writeCount += 1
        if (writeCount === 1) {
          throw Object.assign(new Error('EEXIST'), { code: 'EEXIST' })
        }
        // 2nd call onwards: flip and succeed.
        recursionStart = true
        return undefined
      })

      try {
        // Reset count since we replaced the impl.
        writeCount = 0
        const result = await extractExternalTools()
        expect(result).toBeTruthy()
      } finally {
        ;(process as { kill: unknown }).kill = realKill
      }
    })

    it('reads invalid PID as stale and retries', async () => {
      mockIsSeaBinary.mockReturnValue(true)
      withMountReturning(async () => '/m')

      let writeCount = 0
      let recursionStart = false
      mockFsWriteFile.mockImplementation(async () => {
        writeCount += 1
        if (writeCount === 1) {
          throw Object.assign(new Error('EEXIST'), { code: 'EEXIST' })
        }
        recursionStart = true
        return undefined
      })
      // Invalid PID (NaN) -> isStale = true.
      mockFsReadFile.mockResolvedValue('not-a-number')

      mockExistsSync.mockImplementation(() => recursionStart)

      const result = await extractExternalTools()
      expect(result).toBeTruthy()
    })

    it('handles readFile error as stale lock', async () => {
      mockIsSeaBinary.mockReturnValue(true)
      withMountReturning(async () => '/m')

      let writeCount = 0
      let recursionStart = false
      mockFsWriteFile.mockImplementation(async () => {
        writeCount += 1
        if (writeCount === 1) {
          throw Object.assign(new Error('EEXIST'), { code: 'EEXIST' })
        }
        recursionStart = true
        return undefined
      })
      mockFsReadFile.mockRejectedValue(new Error('ENOENT'))

      mockExistsSync.mockImplementation(() => recursionStart)

      const result = await extractExternalTools()
      expect(result).toBeTruthy()
    })

    it('logs and rethrows when extraction throws', async () => {
      mockIsSeaBinary.mockReturnValue(true)
      withMountReturning(async () => {
        throw new Error('mount blew up')
      })
      // Cache marker false, tool path false -> attempts extractTool -> throws.
      mockExistsSync.mockReturnValue(false)

      await expect(extractExternalTools()).rejects.toThrow(/failed to extract/)
    })

    it('handles safeDelete failure during cleanup gracefully', async () => {
      mockIsSeaBinary.mockReturnValue(true)
      withMountReturning(async () => '/extracted')
      mockExistsSync.mockImplementation((p: string) => {
        return !String(p).endsWith('.extracted')
      })
      // Make safeDelete reject during cleanup; the finally block should
      // log and continue. We need the main path to succeed first.
      mockSafeDelete.mockRejectedValue(
        Object.assign(new Error('rm failed'), { code: 'EBUSY' }),
      )

      // Should still resolve successfully.
      await expect(extractExternalTools()).resolves.toBeTruthy()
    })

    it('handles tool access error (X_OK fails) and re-extracts', async () => {
      mockIsSeaBinary.mockReturnValue(true)
      withMountReturning(async () => '/extracted')
      mockExistsSync.mockImplementation((p: string) => {
        // Cache marker false, tool path true (so access check runs).
        return !String(p).endsWith('.extracted')
      })
      // First access throws (not executable), then re-extract proceeds.
      let accessCount = 0
      mockFsAccess.mockImplementation(async () => {
        accessCount += 1
        if (accessCount === 1) {
          throw new Error('EACCES')
        }
      })

      await expect(extractExternalTools()).resolves.toBeTruthy()
    })

    it('handles TOCTOU: cached tools vanish on stillValid re-check (re-extracts)', async () => {
      // Cache marker exists; first-pass validate(=existsSync per tool)=true;
      // second-pass stillValid(=existsSync per tool)=false → falls through
      // to safeDelete + recursive extractExternalTools.
      mockIsSeaBinary.mockReturnValue(true)
      withMountReturning(async () => '/m')

      let pass = 0
      let toolChecks = 0
      mockExistsSync.mockImplementation((p: string) => {
        const ps = String(p)
        if (ps.endsWith('.extracting')) {
          return false
        }
        // Cache marker: true on first call (validation phase). After
        // recursion: marker is consulted again — false → enter extraction.
        if (ps.endsWith('.extracted')) {
          pass += 1
          return pass === 1
        }
        // Tool path checks: count, true for first 9 (validation), false for
        // the next 1 (stillValid first re-check), then true for the rest.
        toolChecks += 1
        if (toolChecks <= EXTERNAL_TOOLS.length) {
          return true
        }
        if (toolChecks === EXTERNAL_TOOLS.length + 1) {
          return false
        }
        return true
      })

      const result = await extractExternalTools()
      expect(result).toBeTruthy()
    })
  })
})
