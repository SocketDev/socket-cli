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
  getToolPaths,
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
})
