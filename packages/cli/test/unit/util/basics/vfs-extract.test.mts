/**
 * Unit tests for basics VFS extraction.
 *
 * Tests SEA-time extraction of bundled basics tools (Python, Trivy, TruffleHog,
 * OpenGrep) via process.smol.mount(). Behavior is gated on SEA mode and the
 * smol API; both must be present for extraction to proceed. All FS / spawn
 * calls are mocked.
 *
 * Related Files: - src/util/basics/vfs-extract.mts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockLogger = vi.hoisted(() => ({
  warn: vi.fn(),
  error: vi.fn(),
  group: vi.fn(),
  groupEnd: vi.fn(),
  success: vi.fn(),
}))
vi.mock(import('@socketsecurity/lib-stable/logger/default'), () => ({
  getDefaultLogger: () => mockLogger,
}))

const mockSpawn = vi.hoisted(() => vi.fn())
vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: mockSpawn,
}))

const mockIsSeaBinary = vi.hoisted(() => vi.fn(() => false))
vi.mock(import('../../../../src/util/sea/detect.mts'), () => ({
  isSeaBinary: mockIsSeaBinary,
}))

vi.mock(import('../../../../src/constants/paths.mts'), () => ({
  UPDATE_STORE_DIR: '.socket/_dlx',
}))

import {
  areBasicsToolsAvailable,
  extractBasicsTools,
  getBasicsToolPaths,
} from '../../../../src/util/basics/vfs-extract.mts'

const realProcessSmol = (process as unknown).smol

describe('basics/vfs-extract', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsSeaBinary.mockReturnValue(false)
    delete (process as unknown).smol
  })

  afterEach(() => {
    if (realProcessSmol === undefined) {
      delete (process as unknown).smol
    } else {
      ;(process as unknown).smol = realProcessSmol
    }
  })

  describe('areBasicsToolsAvailable', () => {
    it('returns false when not in SEA mode', () => {
      mockIsSeaBinary.mockReturnValue(false)
      ;(process as unknown).smol = { mount: vi.fn() }
      expect(areBasicsToolsAvailable()).toBe(false)
    })

    it('returns false when in SEA mode but smol.mount missing', () => {
      mockIsSeaBinary.mockReturnValue(true)
      delete (process as unknown).smol
      expect(areBasicsToolsAvailable()).toBe(false)
    })

    it('returns true when in SEA mode and smol.mount is available', () => {
      mockIsSeaBinary.mockReturnValue(true)
      ;(process as unknown).smol = { mount: vi.fn() }
      expect(areBasicsToolsAvailable()).toBe(true)
    })
  })

  describe('extractBasicsTools', () => {
    it('returns undefined when not in SEA mode', async () => {
      mockIsSeaBinary.mockReturnValue(false)
      const result = await extractBasicsTools()
      expect(result).toBeUndefined()
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Not running in SEA mode'),
      )
    })

    it('returns undefined when smol.mount is missing', async () => {
      mockIsSeaBinary.mockReturnValue(true)
      ;(process as unknown).smol = {}
      const result = await extractBasicsTools()
      expect(result).toBeUndefined()
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('process.smol.mount'),
      )
    })

    it('extracts and validates all tools', async () => {
      mockIsSeaBinary.mockReturnValue(true)
      const mountedPaths: Record<string, string> = {
        '/snapshot/opengrep': '/cache/opengrep',
        '/snapshot/python': '/cache/python',
        '/snapshot/trivy': '/cache/trivy',
        '/snapshot/trufflehog': '/cache/trufflehog',
      }
      const mount = vi.fn(async (vfsPath: string) => mountedPaths[vfsPath])
      ;(process as unknown).smol = { mount }

      mockSpawn.mockResolvedValue({ code: 0, stdout: '1.0.0', stderr: '' })

      const result = await extractBasicsTools()

      expect(result).toBe('/cache/python')
      expect(mount).toHaveBeenCalledTimes(4)
      expect(mockSpawn).toHaveBeenCalled()
    })

    it('throws when Python validation fails', async () => {
      mockIsSeaBinary.mockReturnValue(true)
      ;(process as unknown).smol = {
        mount: vi.fn(async (p: string) => `/cache/${p.split('/').pop()}`),
      }
      mockSpawn.mockResolvedValueOnce({ code: 1, stdout: '', stderr: 'oops' })

      await expect(extractBasicsTools()).rejects.toThrow(/Python.*failed/)
      expect(mockLogger.error).toHaveBeenCalled()
    })

    it('throws when a security tool validation fails', async () => {
      mockIsSeaBinary.mockReturnValue(true)
      ;(process as unknown).smol = {
        mount: vi.fn(async (p: string) => `/cache/${p.split('/').pop()}`),
      }
      // Python validates OK, then trivy fails.
      mockSpawn
        .mockResolvedValueOnce({ code: 0, stdout: 'Python 3.12', stderr: '' })
        .mockResolvedValueOnce({ code: 1, stdout: '', stderr: 'trivy err' })

      await expect(extractBasicsTools()).rejects.toThrow(/trivy.*failed/)
    })

    it('throws when mount returns falsy for a tool', async () => {
      mockIsSeaBinary.mockReturnValue(true)
      ;(process as unknown).smol = {
        mount: vi.fn(async (p: string) =>
          // python returns empty so the missing-tools check fires.
          p === '/snapshot/python' ? '' : `/cache/${p.split('/').pop()}`,
        ),
      }

      await expect(extractBasicsTools()).rejects.toThrow(
        /VFS extraction returned/,
      )
    })
  })

  describe('getBasicsToolPaths', () => {
    it('constructs sibling-directory paths from the Python toolsDir', () => {
      const paths = getBasicsToolPaths('/cache/abc/python')
      expect(paths.python).toContain('python')
      expect(paths.opengrep).toContain('opengrep')
      expect(paths.trivy).toContain('trivy')
      expect(paths.trufflehog).toContain('trufflehog')
    })
  })
})
