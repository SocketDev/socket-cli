import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock dependencies
vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
}))

vi.mock('node:module', () => ({
  default: {
    createRequire: vi.fn(),
  },
}))

vi.mock('@socketsecurity/registry/lib/logger', () => ({
  logger: {
    fail: vi.fn(),
  },
}))

vi.mock('./path-resolve.mts', () => ({
  findBinPathDetailsSync: vi.fn(),
  findNpmDirPathSync: vi.fn(),
}))

vi.mock('../constants.mts', () => ({
  default: {
    ENV: {
      SOCKET_CLI_NPM_PATH: undefined,
    },
    SOCKET_CLI_ISSUES_URL: 'https://github.com/SocketDev/socket-cli/issues',
  },
  NODE_MODULES: 'node_modules',
  NPM: 'npm',
}))

describe('npm-paths utilities', () => {
  let originalExit: typeof process.exit
  let getNpmBinPath: typeof import('./npm-paths.mts')['getNpmBinPath']
  let getNpmDirPath: typeof import('./npm-paths.mts')['getNpmDirPath']
  let getNpmRequire: typeof import('./npm-paths.mts')['getNpmRequire']
  let getNpxBinPath: typeof import('./npm-paths.mts')['getNpxBinPath']
  let isNpmBinPathShadowed: typeof import('./npm-paths.mts')['isNpmBinPathShadowed']
  let isNpxBinPathShadowed: typeof import('./npm-paths.mts')['isNpxBinPathShadowed']

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
    const npmPaths = await import('./npm-paths.mts')
    getNpmBinPath = npmPaths.getNpmBinPath
    getNpmDirPath = npmPaths.getNpmDirPath
    getNpmRequire = npmPaths.getNpmRequire
    getNpxBinPath = npmPaths.getNpxBinPath
    isNpmBinPathShadowed = npmPaths.isNpmBinPathShadowed
    isNpxBinPathShadowed = npmPaths.isNpxBinPathShadowed
  })

  afterEach(() => {
    // Restore original process.exit.
    process.exit = originalExit
    vi.resetModules()
  })

  describe('getNpmBinPath', () => {
    it('returns npm bin path when found', async () => {
      const { findBinPathDetailsSync } = vi.mocked(
        await import('./path-resolve.mts'),
      )
      findBinPathDetailsSync.mockReturnValue({
        path: '/usr/local/bin/npm',
        shadowed: false,
      })

      const result = getNpmBinPath()

      expect(result).toBe('/usr/local/bin/npm')
      expect(findBinPathDetailsSync).toHaveBeenCalledWith('npm')
    })

    it('exits with error when npm not found', async () => {
      const { findBinPathDetailsSync } = vi.mocked(
        await import('./path-resolve.mts'),
      )
      findBinPathDetailsSync.mockReturnValue({
        path: undefined,
        shadowed: false,
      })

      const { logger } = vi.mocked(
        await import('@socketsecurity/registry/lib/logger'),
      )

      expect(() => getNpmBinPath()).toThrow('process.exit(127)')
      expect(logger.fail).toHaveBeenCalledWith(
        expect.stringContaining('Socket unable to locate npm'),
      )
    })

    it('caches the result', async () => {
      const { findBinPathDetailsSync } = vi.mocked(
        await import('./path-resolve.mts'),
      )
      findBinPathDetailsSync.mockReturnValue({
        path: '/usr/local/bin/npm',
        shadowed: false,
      })

      const result1 = getNpmBinPath()
      const result2 = getNpmBinPath()

      expect(result1).toBe(result2)
      expect(findBinPathDetailsSync).toHaveBeenCalledTimes(1)
    })
  })

  describe('getNpmDirPath', () => {
    it('returns npm directory path when found', async () => {
      const { findBinPathDetailsSync, findNpmDirPathSync } = vi.mocked(
        await import('./path-resolve.mts'),
      )
      findBinPathDetailsSync.mockReturnValue({
        path: '/usr/local/bin/npm',
        shadowed: false,
      })
      findNpmDirPathSync.mockReturnValue('/usr/local/lib/node_modules/npm')

      const result = getNpmDirPath()

      expect(result).toBe('/usr/local/lib/node_modules/npm')
      expect(findNpmDirPathSync).toHaveBeenCalledWith('/usr/local/bin/npm')
    })

    it('uses SOCKET_CLI_NPM_PATH when npm dir not found', async () => {
      // Set up the environment variable mock before importing
      vi.resetModules()
      vi.doMock('../constants.mts', () => ({
        default: {
          ENV: {
            SOCKET_CLI_NPM_PATH: '/custom/npm/path',
          },
          SOCKET_CLI_ISSUES_URL:
            'https://github.com/SocketDev/socket-cli/issues',
        },
        NODE_MODULES: 'node_modules',
        NPM: 'npm',
      }))

      const { findBinPathDetailsSync, findNpmDirPathSync } = vi.mocked(
        await import('./path-resolve.mts'),
      )
      findBinPathDetailsSync.mockReturnValue({
        path: '/usr/local/bin/npm',
        shadowed: false,
      })
      findNpmDirPathSync.mockReturnValue(undefined)

      // Re-import after setting up mocks
      const { getNpmDirPath: localGetNpmDirPath } = await import(
        './npm-paths.mts'
      )
      const result = localGetNpmDirPath()

      expect(result).toBe('/custom/npm/path')
    })

    it('exits with error when npm directory not found', async () => {
      const { findBinPathDetailsSync, findNpmDirPathSync } = vi.mocked(
        await import('./path-resolve.mts'),
      )
      findBinPathDetailsSync.mockReturnValue({
        path: '/usr/local/bin/npm',
        shadowed: false,
      })
      findNpmDirPathSync.mockReturnValue(undefined)

      const constants = vi.mocked(await import('../constants.mts'))
      constants.default.ENV.SOCKET_CLI_NPM_PATH = undefined

      const { logger } = vi.mocked(
        await import('@socketsecurity/registry/lib/logger'),
      )

      expect(() => getNpmDirPath()).toThrow('process.exit(127)')
      expect(logger.fail).toHaveBeenCalledWith(
        expect.stringContaining('Unable to find npm CLI install directory'),
      )
    })
  })

  describe('getNpmRequire', () => {
    it('creates require function for npm directory', async () => {
      const { findBinPathDetailsSync, findNpmDirPathSync } = vi.mocked(
        await import('./path-resolve.mts'),
      )
      findBinPathDetailsSync.mockReturnValue({
        path: '/usr/local/bin/npm',
        shadowed: false,
      })
      findNpmDirPathSync.mockReturnValue('/usr/local/lib/node_modules/npm')

      const { existsSync } = vi.mocked(await import('node:fs'))
      existsSync.mockReturnValue(true)

      const mockRequire = vi.fn()
      const Module = vi.mocked(await import('node:module')).default
      Module.createRequire.mockReturnValue(mockRequire as any)

      const result = getNpmRequire()

      expect(result).toBe(mockRequire)
      expect(Module.createRequire).toHaveBeenCalledWith(
        expect.stringMatching(
          /\/node_modules\/npm\/node_modules\/npm\/<dummy-basename>$/,
        ),
      )
    })

    it('handles missing node_modules/npm subdirectory', async () => {
      const { findBinPathDetailsSync, findNpmDirPathSync } = vi.mocked(
        await import('./path-resolve.mts'),
      )
      findBinPathDetailsSync.mockReturnValue({
        path: '/usr/local/bin/npm',
        shadowed: false,
      })
      findNpmDirPathSync.mockReturnValue('/usr/local/lib/node_modules/npm')

      const { existsSync } = vi.mocked(await import('node:fs'))
      existsSync.mockReturnValue(false)

      const mockRequire = vi.fn()
      const Module = vi.mocked(await import('node:module')).default
      Module.createRequire.mockReturnValue(mockRequire as any)

      const result = getNpmRequire()

      expect(result).toBe(mockRequire)
      expect(Module.createRequire).toHaveBeenCalledWith(
        expect.stringMatching(/\/node_modules\/npm\/<dummy-basename>$/),
      )
    })
  })

  describe('getNpxBinPath', () => {
    it('returns npx bin path when found', async () => {
      const { findBinPathDetailsSync } = vi.mocked(
        await import('./path-resolve.mts'),
      )
      findBinPathDetailsSync.mockReturnValue({
        path: '/usr/local/bin/npx',
        shadowed: false,
      })

      const result = getNpxBinPath()

      expect(result).toBe('/usr/local/bin/npx')
      expect(findBinPathDetailsSync).toHaveBeenCalledWith('npx')
    })

    it('exits with error when npx not found', async () => {
      const { findBinPathDetailsSync } = vi.mocked(
        await import('./path-resolve.mts'),
      )
      findBinPathDetailsSync.mockReturnValue({
        path: undefined,
        shadowed: false,
      })

      const { logger } = vi.mocked(
        await import('@socketsecurity/registry/lib/logger'),
      )

      expect(() => getNpxBinPath()).toThrow('process.exit(127)')
      expect(logger.fail).toHaveBeenCalledWith(
        expect.stringContaining('Socket unable to locate npx'),
      )
    })

    it('caches the result', async () => {
      const { findBinPathDetailsSync } = vi.mocked(
        await import('./path-resolve.mts'),
      )
      findBinPathDetailsSync.mockReturnValue({
        path: '/usr/local/bin/npx',
        shadowed: false,
      })

      const result1 = getNpxBinPath()
      const result2 = getNpxBinPath()

      expect(result1).toBe(result2)
      expect(findBinPathDetailsSync).toHaveBeenCalledTimes(1)
    })
  })

  describe('isNpmBinPathShadowed', () => {
    it('returns true when npm is shadowed', async () => {
      const { findBinPathDetailsSync } = vi.mocked(
        await import('./path-resolve.mts'),
      )
      findBinPathDetailsSync.mockReturnValue({
        path: '/usr/local/bin/npm',
        shadowed: true,
      })

      const result = isNpmBinPathShadowed()

      expect(result).toBe(true)
    })

    it('returns false when npm is not shadowed', async () => {
      const { findBinPathDetailsSync } = vi.mocked(
        await import('./path-resolve.mts'),
      )
      findBinPathDetailsSync.mockReturnValue({
        path: '/usr/local/bin/npm',
        shadowed: false,
      })

      const result = isNpmBinPathShadowed()

      expect(result).toBe(false)
    })
  })

  describe('isNpxBinPathShadowed', () => {
    it('returns true when npx is shadowed', async () => {
      const { findBinPathDetailsSync } = vi.mocked(
        await import('./path-resolve.mts'),
      )
      findBinPathDetailsSync.mockReturnValue({
        path: '/usr/local/bin/npx',
        shadowed: true,
      })

      const result = isNpxBinPathShadowed()

      expect(result).toBe(true)
    })

    it('returns false when npx is not shadowed', async () => {
      const { findBinPathDetailsSync } = vi.mocked(
        await import('./path-resolve.mts'),
      )
      findBinPathDetailsSync.mockReturnValue({
        path: '/usr/local/bin/npx',
        shadowed: false,
      })

      const result = isNpxBinPathShadowed()

      expect(result).toBe(false)
    })
  })
})
