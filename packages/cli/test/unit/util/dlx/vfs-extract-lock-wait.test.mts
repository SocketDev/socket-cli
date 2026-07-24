/**
 * Unit tests for util/dlx/vfs-extract extractExternalTools lock-busy polling
 * loop.
 *
 * Covers the wait-for-other-process-extraction loop: cache-marker appearing
 * mid-wait, missing-tool retries, the periodic re-check branches, and the
 * 60-iteration timeout (including its in-loop and post-loop TOCTOU races).
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
    describe('lock-busy polling loop', () => {
      const realSetTimeout = globalThis.setTimeout
      beforeEach(() => {
        ;(globalThis as { setTimeout: unknown }).setTimeout = (
          cb: () => void,
        ) => {
          cb()
          return 0 as never
        }
      })
      afterEach(() => {
        ;(globalThis as { setTimeout: unknown }).setTimeout = realSetTimeout
      })

      it('returns tool paths when cache marker appears during wait', async () => {
        mockIsSeaBinary.mockReturnValue(true)
        withMountReturning(async () => '/m')

        const eexistErr = Object.assign(new Error('EEXIST'), { code: 'EEXIST' })
        mockFsWriteFile.mockRejectedValue(eexistErr)
        // process.kill: alive (valid lock).
        const realKill = process.kill
        ;(process as { kill: unknown }).kill = vi.fn(() => true)

        // After EEXIST and stale-check, we enter the wait loop. Make
        // cacheMarker appear immediately on first poll; all tool paths exist.
        mockExistsSync.mockReturnValue(true)

        try {
          const result = await extractExternalTools()
          expect(result).toBeTruthy()
        } finally {
          ;(process as { kill: unknown }).kill = realKill
        }
      })

      it('detects missing tool after other-process extraction and retries', async () => {
        mockIsSeaBinary.mockReturnValue(true)
        withMountReturning(async () => '/m')

        let writeCount = 0
        mockFsWriteFile.mockImplementation(async () => {
          writeCount += 1
          if (writeCount === 1) {
            throw Object.assign(new Error('EEXIST'), { code: 'EEXIST' })
          }
          return undefined
        })
        const realKill = process.kill
        ;(process as { kill: unknown }).kill = vi.fn(() => true)

        // 1st phase: cache marker true, but first tool false (missing).
        // After recursive call: everything succeeds.
        let phase1Done = false
        let toolMissCount = 0
        mockExistsSync.mockImplementation((p: string) => {
          const ps = p
          if (ps.endsWith('.extracting')) {
            return false
          }
          if (!phase1Done && ps.endsWith('.extracted')) {
            return true
          }
          // First tool path check in validation: return false.
          if (!phase1Done && ps.includes('cdxgen') && toolMissCount === 0) {
            toolMissCount += 1
            phase1Done = true
            return false
          }
          return true
        })

        try {
          await extractExternalTools().catch(() => {})
        } finally {
          ;(process as { kill: unknown }).kill = realKill
        }

        // The missing-tool branch must have been hit exactly once, triggering
        // the retry via recursion.
        expect(toolMissCount).toBe(1)
      })

      it('hits the i % 5 === 4 cache-marker re-check branch', async () => {
        mockIsSeaBinary.mockReturnValue(true)
        withMountReturning(async () => '/m')
        const eexistErr = Object.assign(new Error('EEXIST'), { code: 'EEXIST' })
        let writeCount = 0
        mockFsWriteFile.mockImplementation(async () => {
          writeCount += 1
          if (writeCount === 1) {
            throw eexistErr
          }
          return undefined
        })
        const realKill = process.kill
        // Keep kill alive (valid lock) so we proceed into poll loop.
        ;(process as { kill: unknown }).kill = vi.fn(() => true)

        // Cache marker: false during all polls, then true at i=4 cache-marker
        // re-check (which triggers recursion). After recursion: success.
        let existsCalls = 0
        mockExistsSync.mockImplementation((p: string) => {
          const ps = p
          if (ps.endsWith('.extracted')) {
            existsCalls += 1
            // First few calls: false (inside polling loop).
            // Around call 6+ (after i=4 wait check): true.
            return existsCalls >= 6
          }
          return true
        })

        try {
          await extractExternalTools().catch(() => {})
        } finally {
          ;(process as { kill: unknown }).kill = realKill
        }

        // The re-check must have observed the marker flip to true.
        expect(existsCalls).toBeGreaterThanOrEqual(6)
      })

      it('hits the i % 5 === 4 dead-PID branch in wait loop', async () => {
        mockIsSeaBinary.mockReturnValue(true)
        withMountReturning(async () => '/m')
        const eexistErr = Object.assign(new Error('EEXIST'), { code: 'EEXIST' })
        let writeCount = 0
        mockFsWriteFile.mockImplementation(async () => {
          writeCount += 1
          if (writeCount === 1) {
            throw eexistErr
          }
          return undefined
        })

        const realKill = process.kill
        let killCount = 0
        ;(process as { kill: unknown }).kill = vi.fn(() => {
          killCount += 1
          // First kill (stale check): alive (so we go into wait loop).
          // Second+ kill (i=4 alive check): dead.
          if (killCount === 1) {
            return true
          }
          throw new Error('ESRCH')
        })

        // Cache marker false through wait loop.
        mockExistsSync.mockImplementation((p: string) => {
          return !p.endsWith('.extracted')
        })

        try {
          await extractExternalTools().catch(() => {})
          expect(killCount).toBeGreaterThan(1)
        } finally {
          ;(process as { kill: unknown }).kill = realKill
        }
      })

      it('hits the i % 5 === 4 lock-file-gone branch in wait loop', async () => {
        mockIsSeaBinary.mockReturnValue(true)
        withMountReturning(async () => '/m')
        const eexistErr = Object.assign(new Error('EEXIST'), { code: 'EEXIST' })
        let writeCount = 0
        mockFsWriteFile.mockImplementation(async () => {
          writeCount += 1
          if (writeCount === 1) {
            throw eexistErr
          }
          return undefined
        })
        const realKill = process.kill
        ;(process as { kill: unknown }).kill = vi.fn(() => true)

        // First readFile (stale check): valid PID (so we enter wait loop).
        // Second+ readFile (i=4 alive check): throws.
        let readCount = 0
        mockFsReadFile.mockImplementation(async () => {
          readCount += 1
          if (readCount === 1) {
            return '12345'
          }
          throw new Error('ENOENT')
        })
        mockExistsSync.mockImplementation((p: string) => {
          return !p.endsWith('.extracted')
        })

        try {
          await extractExternalTools().catch(() => {})
          expect(readCount).toBeGreaterThan(1)
        } finally {
          ;(process as { kill: unknown }).kill = realKill
        }
      })

      it('throws timeout when waiting hits 60 iterations without completion', async () => {
        mockIsSeaBinary.mockReturnValue(true)
        withMountReturning(async () => '/m')
        const eexistErr = Object.assign(new Error('EEXIST'), { code: 'EEXIST' })
        mockFsWriteFile.mockRejectedValue(eexistErr)

        const realKill = process.kill
        ;(process as { kill: unknown }).kill = vi.fn(() => true)

        // existsSync: never true for marker; true for everything else
        // (though we shouldn't reach tool checks).
        mockExistsSync.mockImplementation((p: string) => {
          return !p.endsWith('.extracted')
        })

        try {
          await expect(extractExternalTools()).rejects.toThrow(/timed out/)
        } finally {
          ;(process as { kill: unknown }).kill = realKill
        }
      })

      it('in-loop TOCTOU: marker becomes true, tools pass, stillValid fails → recurse', async () => {
        mockIsSeaBinary.mockReturnValue(true)
        withMountReturning(async () => '/m')

        let writeCount = 0
        mockFsWriteFile.mockImplementation(async () => {
          writeCount += 1
          if (writeCount === 1) {
            throw Object.assign(new Error('EEXIST'), { code: 'EEXIST' })
          }
          return undefined
        })
        const realKill = process.kill
        ;(process as { kill: unknown }).kill = vi.fn(() => true)

        // We want the FIRST in-loop iteration (line 261) to see marker=true,
        // then for the validation pass: 9 tool checks all true, then the
        // stillValid pass: at least one returns false → enter 290-291,
        // then safeDelete + recurse.
        let markerCalls = 0
        let toolCalls = 0
        let recursed = false
        const toolCount = EXTERNAL_TOOLS.length
        mockExistsSync.mockImplementation((p: string) => {
          const ps = p
          if (ps.endsWith('.extracting')) {
            return false
          }
          if (ps.endsWith('.extracted')) {
            markerCalls += 1
            // First marker call (line 361 pre-lock) before EEXIST: false.
            // After EEXIST + entering wait loop: first marker check (line 261)
            // returns true.
            if (markerCalls === 1) {
              return false
            }
            // After recursion (markerCalls >= 3): also false so we extract.
            if (recursed) {
              return false
            }
            return true
          }
          toolCalls += 1
          // Validation pass: first 9 tool checks true. stillValid first
          // re-check: false → enter 290-291.
          if (!recursed && toolCalls <= toolCount) {
            return true
          }
          if (!recursed && toolCalls === toolCount + 1) {
            recursed = true
            return false
          }
          return true
        })

        try {
          await extractExternalTools().catch(() => {})
        } finally {
          ;(process as { kill: unknown }).kill = realKill
        }

        // The stillValid TOCTOU failure must have triggered the recursive retry.
        expect(recursed).toBe(true)
      })

      it('post-loop final check: marker true and all tools present', async () => {
        mockIsSeaBinary.mockReturnValue(true)
        withMountReturning(async () => '/m')
        const eexistErr = Object.assign(new Error('EEXIST'), { code: 'EEXIST' })
        mockFsWriteFile.mockRejectedValue(eexistErr)
        const realKill = process.kill
        ;(process as { kill: unknown }).kill = vi.fn(() => true)

        // Count marker existsSync calls. The loop performs ~72 marker
        // checks (60 at line 261 + 12 at line 302). The 73rd marker check
        // is the post-loop "Final check before throwing timeout" at line 327.
        let markerChecks = 0
        mockExistsSync.mockImplementation((p: string) => {
          const ps = p
          if (ps.endsWith('.extracted')) {
            markerChecks += 1
            // First 72 marker checks (inside loop): false. 73rd+: true
            // (post-loop final).
            return markerChecks > 72
          }
          return true
        })

        try {
          const result = await extractExternalTools()
          expect(result).toBeTruthy()
        } finally {
          ;(process as { kill: unknown }).kill = realKill
        }
      })

      it('post-loop final check: marker true but tool missing → timeout', async () => {
        mockIsSeaBinary.mockReturnValue(true)
        withMountReturning(async () => '/m')
        const eexistErr = Object.assign(new Error('EEXIST'), { code: 'EEXIST' })
        mockFsWriteFile.mockRejectedValue(eexistErr)
        const realKill = process.kill
        ;(process as { kill: unknown }).kill = vi.fn(() => true)

        let markerChecks = 0
        mockExistsSync.mockImplementation((p: string) => {
          const ps = p
          if (ps.endsWith('.extracted')) {
            markerChecks += 1
            return markerChecks > 72
          }
          if (ps.includes('cdxgen')) {
            return false
          }
          return true
        })

        try {
          await expect(extractExternalTools()).rejects.toThrow(/timed out/)
        } finally {
          ;(process as { kill: unknown }).kill = realKill
        }
      })
    })
  })
})
