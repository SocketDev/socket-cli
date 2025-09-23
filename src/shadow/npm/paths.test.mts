import path from 'node:path'

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

vi.mock('../../utils/npm-paths.mts', () => ({
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

    // Reset cached values by clearing the module cache.
    vi.resetModules()

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

    it('should cache the result on subsequent calls', () => {
      const first = getArboristPackagePath()
      const second = getArboristPackagePath()

      expect(first).toBe(second)
      expect(mockGetNpmRequire).toHaveBeenCalledTimes(1)
      expect(mockRequire.resolve).toHaveBeenCalledTimes(1)
    })

    it('should handle complex paths with nested package structure', () => {
      mockRequire.resolve.mockReturnValue(
        '/complex/path/node_modules/@npmcli/arborist/nested/lib/index.js',
      )

      const result = getArboristPackagePath()

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
        expect(path.normalize).toHaveBeenCalledWith(
          'C:/Program Files/node_modules/@npmcli/arborist',
        )
        expect(result).toBe(
          path.normalize('C:/Program Files/node_modules/@npmcli/arborist'),
        )
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
