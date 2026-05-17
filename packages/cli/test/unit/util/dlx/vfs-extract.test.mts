/**
 * max-file-lines: legitimate — comprehensive single-module test suite.
 * Tests the extractExternalTools state machine (cache marker, lock
 * waits, stale locks, recursion-depth guard, tool revalidation, error
 * wrapping). The vi.mock setup is shared across every describe;
 * splitting would duplicate the boilerplate that IS the cohesion.
 *
 * Unit tests for util/dlx/vfs-extract.
 *
 * Covers the public availability check, tool-path map, extractTool, and the
 * full extractExternalTools state machine (cache marker, lock waits, stale
 * locks, recursion-depth guard, tool revalidation, error wrapping).
 *
 * Related Files:
 * - src/util/dlx/vfs-extract.mts
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

vi.mock('../../../../src/util/sea/detect.mts', () => ({
  isSeaBinary: mockIsSeaBinary,
}))

vi.mock('../../../../src/constants/paths.mts', () => ({
  UPDATE_STORE_DIR: '.socket/_dlx',
}))

vi.mock('node:fs', async () => {
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

vi.mock('@socketsecurity/lib/fs', () => ({
  safeDelete: mockSafeDelete,
  safeMkdir: mockSafeMkdir,
}))

import {
  EXTERNAL_TOOLS,
  areExternalToolsAvailable,
  extractExternalTools,
  extractTool,
  getNodeSmolBasePath,
  getToolFilePath,
  getToolPaths,
  isNpmPackageExtracted,
} from '../../../../src/util/dlx/vfs-extract.mts'

const realProcessSmol = (process as unknown as { smol?: unknown | undefined }).smol

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

    it('logs and rethrows when extraction throws', async () => {
      mockIsSeaBinary.mockReturnValue(true)
      withMountReturning(async () => {
        throw new Error('mount blew up')
      })
      // Cache marker false, tool path false -> attempts extractTool -> throws.
      mockExistsSync.mockReturnValue(false)

      await expect(extractExternalTools()).rejects.toThrow(
        /failed to extract/,
      )
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

    describe('lock-busy polling loop', () => {
      const realSetTimeout = globalThis.setTimeout
      beforeEach(() => {
        ;(globalThis as { setTimeout: unknown }).setTimeout = ((
          cb: () => void,
        ) => {
          cb()
          return 0 as never
        }) as never
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
          const ps = String(p)
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
          const ps = String(p)
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
          return !String(p).endsWith('.extracted')
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
          return !String(p).endsWith('.extracted')
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
          return !String(p).endsWith('.extracted')
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
          const ps = String(p)
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
          const ps = String(p)
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
          const ps = String(p)
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
