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

vi.mock('@socketsecurity/lib/logger', () => ({
  getDefaultLogger: () => mockLogger,
  logger: mockLogger,
}))

vi.mock('../fs/path-resolve.mts', () => ({
  findBinPathDetailsSync: vi.fn(),
}))

vi.mock('../../constants/packages.mts', () => ({
  YARN: 'yarn',
}))

describe('yarn-paths utilities', () => {
  let originalExit: typeof process.exit
  let getYarnBinPath: typeof import('./paths.mts')['getYarnBinPath']
  let getYarnBinPathDetails: typeof import('./paths.mts')['getYarnBinPathDetails']
  let isYarnBinPathShadowed: typeof import('./paths.mts')['isYarnBinPathShadowed']

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()

    // Store original process.exit.
    originalExit = process.exit
    // Mock process.exit to prevent actual exits.
    process.exit = vi.fn((code?: number) => {
      throw new Error(`process.exit(${code})`)
    }) as any

    // Re-import functions after module reset to clear caches
    const yarnPaths = await import('./paths.mts')
    getYarnBinPath = yarnPaths.getYarnBinPath
    getYarnBinPathDetails = yarnPaths.getYarnBinPathDetails
    isYarnBinPathShadowed = yarnPaths.isYarnBinPathShadowed
  })

  afterEach(() => {
    // Restore original process.exit.
    process.exit = originalExit
    vi.resetModules()
  })

  describe('getYarnBinPath', () => {
    it('returns yarn bin path when found', async () => {
      const { findBinPathDetailsSync } = vi.mocked(
        await import('../fs/path-resolve.mts'),
      )
      findBinPathDetailsSync.mockReturnValue({
        path: '/usr/local/bin/yarn',
        shadowed: false,
      })

      const result = getYarnBinPath()

      expect(result).toBe('/usr/local/bin/yarn')
      expect(findBinPathDetailsSync).toHaveBeenCalledWith('yarn/classic')
    })

    it('exits with error when yarn not found', async () => {
      const { findBinPathDetailsSync } = vi.mocked(
        await import('../fs/path-resolve.mts'),
      )
      findBinPathDetailsSync.mockReturnValue({
        path: undefined,
        shadowed: false,
      })

      expect(() => getYarnBinPath()).toThrow('process.exit(127)')
      expect(mockLogger.fail).toHaveBeenCalledWith(
        expect.stringContaining('Socket unable to locate yarn'),
      )
    })

    it('caches the result', async () => {
      const { findBinPathDetailsSync } = vi.mocked(
        await import('../fs/path-resolve.mts'),
      )
      findBinPathDetailsSync.mockReturnValue({
        path: '/usr/local/bin/yarn',
        shadowed: false,
      })

      const result1 = getYarnBinPath()
      const result2 = getYarnBinPath()

      expect(result1).toBe(result2)
      expect(findBinPathDetailsSync).toHaveBeenCalledTimes(1)
    })

    it('handles Windows yarn.cmd path', async () => {
      const { findBinPathDetailsSync } = vi.mocked(
        await import('../fs/path-resolve.mts'),
      )
      findBinPathDetailsSync.mockReturnValue({
        path: 'C:\\Program Files\\Yarn\\bin\\yarn.cmd',
        shadowed: false,
      })

      const result = getYarnBinPath()

      expect(result).toBe('C:\\Program Files\\Yarn\\bin\\yarn.cmd')
    })

    it('handles yarn installed via npm', async () => {
      const { findBinPathDetailsSync } = vi.mocked(
        await import('../fs/path-resolve.mts'),
      )
      findBinPathDetailsSync.mockReturnValue({
        path: '/usr/local/lib/node_modules/.bin/yarn',
        shadowed: false,
      })

      const result = getYarnBinPath()

      expect(result).toBe('/usr/local/lib/node_modules/.bin/yarn')
    })
  })

  describe('getYarnBinPathDetails', () => {
    it('returns full details including path and shadowed status', async () => {
      const { findBinPathDetailsSync } = vi.mocked(
        await import('../fs/path-resolve.mts'),
      )
      const mockDetails = {
        path: '/usr/local/bin/yarn',
        shadowed: true,
      }
      findBinPathDetailsSync.mockReturnValue(mockDetails)

      const result = getYarnBinPathDetails()

      expect(result).toEqual(mockDetails)
      expect(findBinPathDetailsSync).toHaveBeenCalledWith('yarn/classic')
    })

    it('caches the result', async () => {
      const { findBinPathDetailsSync } = vi.mocked(
        await import('../fs/path-resolve.mts'),
      )
      const mockDetails = {
        path: '/usr/local/bin/yarn',
        shadowed: false,
      }
      findBinPathDetailsSync.mockReturnValue(mockDetails)

      const result1 = getYarnBinPathDetails()
      const result2 = getYarnBinPathDetails()

      expect(result1).toBe(result2)
      expect(findBinPathDetailsSync).toHaveBeenCalledTimes(1)
    })

    it('returns details even when path is undefined', async () => {
      const { findBinPathDetailsSync } = vi.mocked(
        await import('../fs/path-resolve.mts'),
      )
      const mockDetails = {
        path: undefined,
        shadowed: false,
      }
      findBinPathDetailsSync.mockReturnValue(mockDetails)

      const result = getYarnBinPathDetails()

      expect(result).toEqual(mockDetails)
    })
  })

  describe('isYarnBinPathShadowed', () => {
    it('returns true when yarn is shadowed', async () => {
      const { findBinPathDetailsSync } = vi.mocked(
        await import('../fs/path-resolve.mts'),
      )
      findBinPathDetailsSync.mockReturnValue({
        path: '/usr/local/bin/yarn',
        shadowed: true,
      })

      const result = isYarnBinPathShadowed()

      expect(result).toBe(true)
    })

    it('returns false when yarn is not shadowed', async () => {
      const { findBinPathDetailsSync } = vi.mocked(
        await import('../fs/path-resolve.mts'),
      )
      findBinPathDetailsSync.mockReturnValue({
        path: '/usr/local/bin/yarn',
        shadowed: false,
      })

      const result = isYarnBinPathShadowed()

      expect(result).toBe(false)
    })

    it('returns false when yarn path is not found but not shadowed', async () => {
      const { findBinPathDetailsSync } = vi.mocked(
        await import('../fs/path-resolve.mts'),
      )
      findBinPathDetailsSync.mockReturnValue({
        path: undefined,
        shadowed: false,
      })

      const result = isYarnBinPathShadowed()

      expect(result).toBe(false)
    })

    it('uses cached details', async () => {
      const { findBinPathDetailsSync } = vi.mocked(
        await import('../fs/path-resolve.mts'),
      )
      findBinPathDetailsSync.mockReturnValue({
        path: '/usr/local/bin/yarn',
        shadowed: true,
      })

      // Call getYarnBinPathDetails first to cache.
      getYarnBinPathDetails()

      // Now call isYarnBinPathShadowed.
      const result = isYarnBinPathShadowed()

      expect(result).toBe(true)
      // Should only be called once due to caching.
      expect(findBinPathDetailsSync).toHaveBeenCalledTimes(1)
    })
  })
})
