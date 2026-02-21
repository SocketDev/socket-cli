/**
 * Unit tests for yarn path utilities.
 *
 * Purpose:
 * Tests yarn-specific path utilities. Validates yarn bin path resolution.
 *
 * Test Coverage:
 * - yarn bin path resolution
 * - Path caching
 * - Error handling when yarn not found
 *
 * Testing Approach:
 * Tests yarn path conventions and resolution logic.
 *
 * Related Files:
 * - utils/yarn/paths.mts (implementation)
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

describe('yarn-paths utilities', () => {
  let originalExit: typeof process.exit
  let getYarnBinPath: typeof import('../../../../../src/utils/yarn/paths.mts')['getYarnBinPath']
  let getYarnBinPathDetails: typeof import('../../../../../src/utils/yarn/paths.mts')['getYarnBinPathDetails']

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
    const yarnPaths = await import('../../../../../src/utils/yarn/paths.mts')
    getYarnBinPath = yarnPaths.getYarnBinPath
    getYarnBinPathDetails = yarnPaths.getYarnBinPathDetails
  })

  afterEach(() => {
    // Restore original process.exit.
    process.exit = originalExit
    vi.resetModules()
  })

  describe('getYarnBinPath', () => {
    it('returns yarn bin path when found', () => {
      mockFindBinPathDetailsSync.mockReturnValue({
        path: '/usr/local/bin/yarn',
      })

      const result = getYarnBinPath()

      expect(result).toBe('/usr/local/bin/yarn')
      expect(mockFindBinPathDetailsSync).toHaveBeenCalledWith('yarn/classic')
    })

    it('exits with error when yarn not found', () => {
      mockFindBinPathDetailsSync.mockReturnValue({
        path: undefined,
      })

      expect(() => getYarnBinPath()).toThrow('process.exit(127)')
      expect(mockLogger.fail).toHaveBeenCalledWith(
        expect.stringContaining('Socket unable to locate yarn'),
      )
    })

    it('caches the result', () => {
      mockFindBinPathDetailsSync.mockReturnValue({
        path: '/usr/local/bin/yarn',
      })

      const result1 = getYarnBinPath()
      const result2 = getYarnBinPath()

      expect(result1).toBe(result2)
      expect(mockFindBinPathDetailsSync).toHaveBeenCalledTimes(1)
    })

    it('handles Windows yarn.cmd path', () => {
      mockFindBinPathDetailsSync.mockReturnValue({
        path: 'C:\\Program Files\\Yarn\\bin\\yarn.cmd',
      })

      const result = getYarnBinPath()

      expect(result).toBe('C:\\Program Files\\Yarn\\bin\\yarn.cmd')
    })

    it('handles yarn installed via npm', () => {
      mockFindBinPathDetailsSync.mockReturnValue({
        path: '/usr/local/lib/node_modules/.bin/yarn',
      })

      const result = getYarnBinPath()

      expect(result).toBe('/usr/local/lib/node_modules/.bin/yarn')
    })

    it('handles yarn installed via corepack', () => {
      mockFindBinPathDetailsSync.mockReturnValue({
        path: '/home/user/.cache/corepack/yarn/1.22.0/bin/yarn',
      })

      const result = getYarnBinPath()

      expect(result).toBe('/home/user/.cache/corepack/yarn/1.22.0/bin/yarn')
    })
  })

  describe('getYarnBinPathDetails', () => {
    it('returns full details including path', () => {
      const mockDetails = {
        path: '/usr/local/bin/yarn',
      }
      mockFindBinPathDetailsSync.mockReturnValue(mockDetails)

      const result = getYarnBinPathDetails()

      expect(result).toEqual(mockDetails)
      expect(mockFindBinPathDetailsSync).toHaveBeenCalledWith('yarn/classic')
    })

    it('caches the result', () => {
      const mockDetails = {
        path: '/usr/local/bin/yarn',
      }
      mockFindBinPathDetailsSync.mockReturnValue(mockDetails)

      const result1 = getYarnBinPathDetails()
      const result2 = getYarnBinPathDetails()

      expect(result1).toBe(result2)
      expect(mockFindBinPathDetailsSync).toHaveBeenCalledTimes(1)
    })

    it('returns details even when path is undefined', () => {
      const mockDetails = {
        path: undefined,
      }
      mockFindBinPathDetailsSync.mockReturnValue(mockDetails)

      const result = getYarnBinPathDetails()

      expect(result).toEqual(mockDetails)
    })

    it('returns same object reference when cached', () => {
      const mockDetails = {
        path: '/usr/local/bin/yarn',
      }
      mockFindBinPathDetailsSync.mockReturnValue(mockDetails)

      const result1 = getYarnBinPathDetails()
      const result2 = getYarnBinPathDetails()

      expect(result1).toBe(result2) // Same reference.
      expect(mockFindBinPathDetailsSync).toHaveBeenCalledTimes(1)
    })
  })
})
