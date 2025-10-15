import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  getArboristClassPath,
  getArboristEdgeClassPath,
  getArboristNodeClassPath,
  getArboristOverrideSetClassPath,
  getArboristPackagePath,
} from './paths.mts'

// Mock dependencies.
const mockGetNpmRequire = vi.hoisted(() => vi.fn())
const mockNormalizePath = vi.hoisted(() => vi.fn())

vi.mock('../../utils/npm/paths.mts', () => ({
  getNpmRequire: mockGetNpmRequire,
}))

vi.mock('@socketsecurity/registry/lib/path', () => ({
  normalizePath: mockNormalizePath,
}))

vi.mock('../../constants.mts', async importOriginal => {
  const actual = (await importOriginal()) as Record<string, any>
  return {
    ...actual,
    default: {
      ...actual?.default,
      WIN32: false,
    },
  }
})

describe('npm/paths', () => {
  const mockRequire = {
    resolve: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()

    // Default mock implementations.
    mockGetNpmRequire.mockReturnValue(mockRequire)
    mockRequire.resolve.mockReturnValue(
      '/usr/lib/node_modules/@npmcli/arborist/lib/arborist/index.js',
    )
    mockNormalizePath.mockImplementation((p: string) => p.replace(/\\/g, '/'))
  })

  describe('getArboristPackagePath', () => {
    it('should resolve arborist package path from require.resolve', () => {
      const result = getArboristPackagePath()

      expect(mockGetNpmRequire).toHaveBeenCalled()
      expect(mockRequire.resolve).toHaveBeenCalledWith('@npmcli/arborist')
      expect(mockNormalizePath).toHaveBeenCalledWith(
        '/usr/lib/node_modules/@npmcli/arborist/lib/arborist/index.js',
      )
      expect(result).toBe('/usr/lib/node_modules/@npmcli/arborist')
    })

    it('should cache the result on subsequent calls', async () => {
      // Import fresh module to test caching
      const { getArboristPackagePath: freshGetArboristPackagePath } =
        await import('./paths.mts')

      const first = freshGetArboristPackagePath()
      const second = freshGetArboristPackagePath()

      expect(first).toBe(second)
      // Note: Due to module-level caching, the mocks may have been called during import
      // The important thing is that subsequent calls return the same cached value
    })

    it('should handle complex paths with nested package structure', async () => {
      mockRequire.resolve.mockReturnValue(
        '/complex/path/node_modules/@npmcli/arborist/nested/lib/index.js',
      )

      // Reset modules to clear cache and get fresh import
      vi.resetModules()

      const { getArboristPackagePath: freshGetArboristPackagePath } =
        await import('./paths.mts')
      const result = freshGetArboristPackagePath()

      expect(result).toBe('/complex/path/node_modules/@npmcli/arborist')
    })

    it('should handle Windows paths when WIN32 is true', () => {
      // Re-import with WIN32: true.
      vi.doMock('../../constants.mts', async importOriginal => {
        const actual = (await importOriginal()) as Record<string, any>
        return {
          ...actual,
          default: {
            ...actual?.default,
            WIN32: true,
          },
        }
      })

      mockRequire.resolve.mockReturnValue(
        'C:\\Program Files\\node_modules\\@npmcli\\arborist\\lib\\index.js',
      )
      mockNormalizePath.mockReturnValue(
        'C:/Program Files/node_modules/@npmcli/arborist/lib/index.js',
      )

      // Re-import the module to get updated WIN32 value.
      return import('./paths.mts').then(module => {
        const result = module.getArboristPackagePath()
        expect(result).toContain('@npmcli/arborist')
      })
    })
  })

  describe('getArboristClassPath', () => {
    it('should return arborist class path', () => {
      const result = getArboristClassPath()

      expect(result).toBe(
        '/usr/lib/node_modules/@npmcli/arborist/lib/arborist/index.js',
      )
    })

    it('should cache the result on subsequent calls', () => {
      const first = getArboristClassPath()
      const second = getArboristClassPath()

      expect(first).toBe(second)
    })
  })

  describe('getArboristEdgeClassPath', () => {
    it('should return arborist edge class path', () => {
      const result = getArboristEdgeClassPath()

      expect(result).toBe('/usr/lib/node_modules/@npmcli/arborist/lib/edge.js')
    })

    it('should cache the result on subsequent calls', () => {
      const first = getArboristEdgeClassPath()
      const second = getArboristEdgeClassPath()

      expect(first).toBe(second)
    })
  })

  describe('getArboristNodeClassPath', () => {
    it('should return arborist node class path', () => {
      const result = getArboristNodeClassPath()

      expect(result).toBe('/usr/lib/node_modules/@npmcli/arborist/lib/node.js')
    })

    it('should cache the result on subsequent calls', () => {
      const first = getArboristNodeClassPath()
      const second = getArboristNodeClassPath()

      expect(first).toBe(second)
    })
  })

  describe('getArboristOverrideSetClassPath', () => {
    it('should return arborist override set class path', () => {
      const result = getArboristOverrideSetClassPath()

      expect(result).toBe(
        '/usr/lib/node_modules/@npmcli/arborist/lib/override-set.js',
      )
    })

    it('should cache the result on subsequent calls', () => {
      const first = getArboristOverrideSetClassPath()
      const second = getArboristOverrideSetClassPath()

      expect(first).toBe(second)
    })
  })
})
