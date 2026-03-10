/**
 * Unit tests for pnpm path utilities.
 *
 * Purpose:
 * Tests pnpm-specific path utilities. Validates pnpm bin path resolution.
 *
 * Test Coverage:
 * - pnpm bin path resolution
 * - Path caching
 * - Error handling when pnpm not found
 *
 * Testing Approach:
 * Tests pnpm path conventions and resolution logic.
 *
 * Related Files:
 * - utils/pnpm/paths.mts (implementation)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock dependencies.
const mockLogger = vi.hoisted(() => ({
  fail: vi.fn(),
  log: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

const mockFindBinPathDetailsSync = vi.hoisted(() => vi.fn())

vi.mock('@socketsecurity/lib/logger', () => ({
  getDefaultLogger: () => mockLogger,
  logger: mockLogger,
}))

vi.mock('../../../../src/utils/fs/path-resolve.mts', () => ({
  findBinPathDetailsSync: mockFindBinPathDetailsSync,
}))

describe('pnpm-paths utilities', () => {
  let originalExit: typeof process.exit
  let getPnpmBinPath: (typeof import('../../../../../src/utils/pnpm/paths.mts'))['getPnpmBinPath']
  let getPnpmBinPathDetails: (typeof import('../../../../../src/utils/pnpm/paths.mts'))['getPnpmBinPathDetails']

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()

    // Store original process.exit.
    originalExit = process.exit
    // Mock process.exit to prevent actual exits.
    process.exit = vi.fn((code?: number) => {
      throw new Error(`process.exit(${code})`)
    }) as any

    // Re-import functions after module reset to clear caches.
    const pnpmPaths = await import('../../../../../src/utils/pnpm/paths.mts')
    getPnpmBinPath = pnpmPaths.getPnpmBinPath
    getPnpmBinPathDetails = pnpmPaths.getPnpmBinPathDetails
  })

  afterEach(() => {
    // Restore original process.exit.
    process.exit = originalExit
    vi.resetModules()
  })

  describe('getPnpmBinPath', () => {
    it('returns pnpm bin path when found', () => {
      mockFindBinPathDetailsSync.mockReturnValue({
        path: '/usr/local/bin/pnpm',
      })

      const result = getPnpmBinPath()

      expect(result).toBe('/usr/local/bin/pnpm')
      expect(mockFindBinPathDetailsSync).toHaveBeenCalledWith('pnpm')
    })

    it('exits with error when pnpm not found', () => {
      mockFindBinPathDetailsSync.mockReturnValue({
        path: undefined,
      })

      expect(() => getPnpmBinPath()).toThrow('process.exit(127)')
      expect(mockLogger.fail).toHaveBeenCalledWith(
        expect.stringContaining('Socket unable to locate pnpm'),
      )
    })

    it('caches the result', () => {
      mockFindBinPathDetailsSync.mockReturnValue({
        path: '/usr/local/bin/pnpm',
      })

      const result1 = getPnpmBinPath()
      const result2 = getPnpmBinPath()

      expect(result1).toBe(result2)
      expect(mockFindBinPathDetailsSync).toHaveBeenCalledTimes(1)
    })

    it('handles Windows pnpm.cmd path', () => {
      mockFindBinPathDetailsSync.mockReturnValue({
        path: 'C:\\Program Files\\pnpm\\bin\\pnpm.cmd',
      })

      const result = getPnpmBinPath()

      expect(result).toBe('C:\\Program Files\\pnpm\\bin\\pnpm.cmd')
    })

    it('handles pnpm installed via npm', () => {
      mockFindBinPathDetailsSync.mockReturnValue({
        path: '/usr/local/lib/node_modules/.bin/pnpm',
      })

      const result = getPnpmBinPath()

      expect(result).toBe('/usr/local/lib/node_modules/.bin/pnpm')
    })

    it('handles pnpm installed via corepack', () => {
      mockFindBinPathDetailsSync.mockReturnValue({
        path: '/home/user/.cache/corepack/pnpm/9.0.0/bin/pnpm',
      })

      const result = getPnpmBinPath()

      expect(result).toBe('/home/user/.cache/corepack/pnpm/9.0.0/bin/pnpm')
    })
  })

  describe('getPnpmBinPathDetails', () => {
    it('returns full details including path', () => {
      const mockDetails = {
        path: '/usr/local/bin/pnpm',
      }
      mockFindBinPathDetailsSync.mockReturnValue(mockDetails)

      const result = getPnpmBinPathDetails()

      expect(result).toEqual(mockDetails)
      expect(mockFindBinPathDetailsSync).toHaveBeenCalledWith('pnpm')
    })

    it('caches the result', () => {
      const mockDetails = {
        path: '/usr/local/bin/pnpm',
      }
      mockFindBinPathDetailsSync.mockReturnValue(mockDetails)

      const result1 = getPnpmBinPathDetails()
      const result2 = getPnpmBinPathDetails()

      expect(result1).toBe(result2)
      expect(mockFindBinPathDetailsSync).toHaveBeenCalledTimes(1)
    })

    it('returns details even when path is undefined', () => {
      const mockDetails = {
        path: undefined,
      }
      mockFindBinPathDetailsSync.mockReturnValue(mockDetails)

      const result = getPnpmBinPathDetails()

      expect(result).toEqual(mockDetails)
    })

    it('returns same object reference when cached', () => {
      const mockDetails = {
        path: '/usr/local/bin/pnpm',
      }
      mockFindBinPathDetailsSync.mockReturnValue(mockDetails)

      const result1 = getPnpmBinPathDetails()
      const result2 = getPnpmBinPathDetails()

      expect(result1).toBe(result2) // Same reference.
      expect(mockFindBinPathDetailsSync).toHaveBeenCalledTimes(1)
    })
  })
})
