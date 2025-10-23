import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock dependencies.
vi.mock('@socketsecurity/lib/logger', () => ({
  logger: {
    fail: vi.fn(),
  },
}))

vi.mock('./path-resolve.mts', () => ({
  findBinPathDetailsSync: vi.fn(),
}))

describe('pnpm-paths utilities', () => {
  let originalExit: typeof process.exit
  let getPnpmBinPath: typeof import('./paths.mts')['getPnpmBinPath']
  let getPnpmBinPathDetails: typeof import('./paths.mts')['getPnpmBinPathDetails']
  let isPnpmBinPathShadowed: typeof import('./paths.mts')['isPnpmBinPathShadowed']

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
    const pnpmPaths = await import('./paths.mts')
    getPnpmBinPath = pnpmPaths.getPnpmBinPath
    getPnpmBinPathDetails = pnpmPaths.getPnpmBinPathDetails
    isPnpmBinPathShadowed = pnpmPaths.isPnpmBinPathShadowed
  })

  afterEach(() => {
    // Restore original process.exit.
    process.exit = originalExit
    vi.resetModules()
  })

  describe('getPnpmBinPath', () => {
    it('returns pnpm bin path when found', async () => {
      const { findBinPathDetailsSync } = vi.mocked(
        await import('./path-resolve.mts'),
      )
      findBinPathDetailsSync.mockReturnValue({
        path: '/usr/local/bin/pnpm',
        shadowed: false,
      })

      const result = getPnpmBinPath()

      expect(result).toBe('/usr/local/bin/pnpm')
      expect(findBinPathDetailsSync).toHaveBeenCalledWith('pnpm')
    })

    it('exits with error when pnpm not found', async () => {
      const { findBinPathDetailsSync } = vi.mocked(
        await import('./path-resolve.mts'),
      )
      findBinPathDetailsSync.mockReturnValue({
        path: undefined,
        shadowed: false,
      })

      const { logger } = vi.mocked(await import('@socketsecurity/lib/logger'))

      expect(() => getPnpmBinPath()).toThrow('process.exit(127)')
      expect(logger.fail).toHaveBeenCalledWith(
        expect.stringContaining('Socket unable to locate pnpm'),
      )
    })

    it('caches the result', async () => {
      const { findBinPathDetailsSync } = vi.mocked(
        await import('./path-resolve.mts'),
      )
      findBinPathDetailsSync.mockReturnValue({
        path: '/usr/local/bin/pnpm',
        shadowed: false,
      })

      const result1 = getPnpmBinPath()
      const result2 = getPnpmBinPath()

      expect(result1).toBe(result2)
      expect(findBinPathDetailsSync).toHaveBeenCalledTimes(1)
    })

    it('handles Windows pnpm.cmd path', async () => {
      const { findBinPathDetailsSync } = vi.mocked(
        await import('./path-resolve.mts'),
      )
      findBinPathDetailsSync.mockReturnValue({
        path: 'C:\\Program Files\\pnpm\\bin\\pnpm.cmd',
        shadowed: false,
      })

      const result = getPnpmBinPath()

      expect(result).toBe('C:\\Program Files\\pnpm\\bin\\pnpm.cmd')
    })

    it('handles pnpm installed via npm', async () => {
      const { findBinPathDetailsSync } = vi.mocked(
        await import('./path-resolve.mts'),
      )
      findBinPathDetailsSync.mockReturnValue({
        path: '/usr/local/lib/node_modules/.bin/pnpm',
        shadowed: false,
      })

      const result = getPnpmBinPath()

      expect(result).toBe('/usr/local/lib/node_modules/.bin/pnpm')
    })

    it('handles pnpm installed via corepack', async () => {
      const { findBinPathDetailsSync } = vi.mocked(
        await import('./path-resolve.mts'),
      )
      findBinPathDetailsSync.mockReturnValue({
        path: '/home/user/.cache/corepack/pnpm/9.0.0/bin/pnpm',
        shadowed: false,
      })

      const result = getPnpmBinPath()

      expect(result).toBe('/home/user/.cache/corepack/pnpm/9.0.0/bin/pnpm')
    })
  })

  describe('getPnpmBinPathDetails', () => {
    it('returns full details including path and shadowed status', async () => {
      const { findBinPathDetailsSync } = vi.mocked(
        await import('./path-resolve.mts'),
      )
      const mockDetails = {
        path: '/usr/local/bin/pnpm',
        shadowed: true,
      }
      findBinPathDetailsSync.mockReturnValue(mockDetails)

      const result = getPnpmBinPathDetails()

      expect(result).toEqual(mockDetails)
      expect(findBinPathDetailsSync).toHaveBeenCalledWith('pnpm')
    })

    it('caches the result', async () => {
      const { findBinPathDetailsSync } = vi.mocked(
        await import('./path-resolve.mts'),
      )
      const mockDetails = {
        path: '/usr/local/bin/pnpm',
        shadowed: false,
      }
      findBinPathDetailsSync.mockReturnValue(mockDetails)

      const result1 = getPnpmBinPathDetails()
      const result2 = getPnpmBinPathDetails()

      expect(result1).toBe(result2)
      expect(findBinPathDetailsSync).toHaveBeenCalledTimes(1)
    })

    it('returns details even when path is undefined', async () => {
      const { findBinPathDetailsSync } = vi.mocked(
        await import('./path-resolve.mts'),
      )
      const mockDetails = {
        path: undefined,
        shadowed: false,
      }
      findBinPathDetailsSync.mockReturnValue(mockDetails)

      const result = getPnpmBinPathDetails()

      expect(result).toEqual(mockDetails)
    })

    it('handles shadowed pnpm installation', async () => {
      const { findBinPathDetailsSync } = vi.mocked(
        await import('./path-resolve.mts'),
      )
      const mockDetails = {
        path: '/usr/local/bin/pnpm',
        shadowed: true,
      }
      findBinPathDetailsSync.mockReturnValue(mockDetails)

      const result = getPnpmBinPathDetails()

      expect(result).toEqual(mockDetails)
      expect(result.shadowed).toBe(true)
    })

    it('returns same object reference when cached', async () => {
      const { findBinPathDetailsSync } = vi.mocked(
        await import('./path-resolve.mts'),
      )
      const mockDetails = {
        path: '/usr/local/bin/pnpm',
        shadowed: false,
      }
      findBinPathDetailsSync.mockReturnValue(mockDetails)

      const result1 = getPnpmBinPathDetails()
      const result2 = getPnpmBinPathDetails()

      expect(result1).toBe(result2) // Same reference.
      expect(findBinPathDetailsSync).toHaveBeenCalledTimes(1)
    })
  })

  describe('isPnpmBinPathShadowed', () => {
    it('returns true when pnpm is shadowed', async () => {
      const { findBinPathDetailsSync } = vi.mocked(
        await import('./path-resolve.mts'),
      )
      findBinPathDetailsSync.mockReturnValue({
        path: '/usr/local/bin/pnpm',
        shadowed: true,
      })

      const result = isPnpmBinPathShadowed()

      expect(result).toBe(true)
    })

    it('returns false when pnpm is not shadowed', async () => {
      const { findBinPathDetailsSync } = vi.mocked(
        await import('./path-resolve.mts'),
      )
      findBinPathDetailsSync.mockReturnValue({
        path: '/usr/local/bin/pnpm',
        shadowed: false,
      })

      const result = isPnpmBinPathShadowed()

      expect(result).toBe(false)
    })

    it('returns false when pnpm path is not found but not shadowed', async () => {
      const { findBinPathDetailsSync } = vi.mocked(
        await import('./path-resolve.mts'),
      )
      findBinPathDetailsSync.mockReturnValue({
        path: undefined,
        shadowed: false,
      })

      const result = isPnpmBinPathShadowed()

      expect(result).toBe(false)
    })

    it('uses cached details', async () => {
      const { findBinPathDetailsSync } = vi.mocked(
        await import('./path-resolve.mts'),
      )
      findBinPathDetailsSync.mockReturnValue({
        path: '/usr/local/bin/pnpm',
        shadowed: true,
      })

      // Call getPnpmBinPathDetails first to cache.
      getPnpmBinPathDetails()

      // Now call isPnpmBinPathShadowed.
      const result = isPnpmBinPathShadowed()

      expect(result).toBe(true)
      // Should only be called once due to caching.
      expect(findBinPathDetailsSync).toHaveBeenCalledTimes(1)
    })

    it('handles multiple calls efficiently', async () => {
      const { findBinPathDetailsSync } = vi.mocked(
        await import('./path-resolve.mts'),
      )
      findBinPathDetailsSync.mockReturnValue({
        path: '/usr/local/bin/pnpm',
        shadowed: true,
      })

      const result1 = isPnpmBinPathShadowed()
      const result2 = isPnpmBinPathShadowed()
      const result3 = isPnpmBinPathShadowed()

      expect(result1).toBe(true)
      expect(result2).toBe(true)
      expect(result3).toBe(true)
      // Should only be called once due to caching.
      expect(findBinPathDetailsSync).toHaveBeenCalledTimes(1)
    })
  })
})
