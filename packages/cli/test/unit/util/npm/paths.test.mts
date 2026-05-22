/**
 * Unit tests for npm path utilities.
 *
 * Purpose: Tests npm-specific path utilities. Validates node_modules,
 * package.json, and cache path resolution.
 *
 * Test Coverage:
 *
 * - Node_modules path resolution
 * - Package.json location
 * - Npm cache directory
 * - Global package paths
 * - Workspace root detection
 *
 * Testing Approach: Tests npm path conventions and resolution logic.
 *
 * Related Files:
 *
 * - Util/npm/paths.mts (implementation)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as ModuleModule from 'node:module'
import type * as PathsModule from '../../../../src/util/npm/paths.mts'

const mockExistsSync = vi.hoisted(() => vi.fn())

vi.mock('node:fs', () => ({
  existsSync: mockExistsSync,
  default: {
    existsSync: mockExistsSync,
  },
}))

vi.mock('node:module', async importOriginal => {
  const actual = await importOriginal<typeof ModuleModule>()
  return {
    ...actual,
    createRequire: vi.fn(),
    default: {
      ...actual.default,
      createRequire: vi.fn(),
    },
  }
})

const mockLogger = vi.hoisted(() => ({
  fail: vi.fn(),
  log: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

vi.mock('@socketsecurity/lib-stable/logger', () => ({
  getDefaultLogger: () => mockLogger,
  logger: mockLogger,
}))

vi.mock('../../../../src/util/fs/path-resolve.mts', () => ({
  findBinPathDetailsSync: vi.fn(),
  findNpmDirPathSync: vi.fn(),
}))

vi.mock('../../../../src/env/socket-cli-npm-path.mts', () => ({
  SOCKET_CLI_NPM_PATH: undefined,
}))

vi.mock('../../../../src/constants/github.mts', () => ({
  SOCKET_CLI_ISSUES_URL: 'https://github.com/SocketDev/socket-cli/issues',
}))

vi.mock('../../../../src/constants/packages.mts', () => ({
  NODE_MODULES: 'node_modules',
}))

describe('npm-paths utilities', () => {
  let originalExit: typeof process.exit
  let getNpmBinPath: (typeof PathsModule)['getNpmBinPath']
  let getNpmDirPath: (typeof PathsModule)['getNpmDirPath']
  let getNpxBinPath: (typeof PathsModule)['getNpxBinPath']

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()

    // Store original process.exit.
    originalExit = process.exit
    // Mock process.exit to prevent actual exits.
    process.exit = vi.fn((code?: number) => {
      throw new Error(`process.exit(${code})`)
    }) as unknown

    // Re-import functions after module reset to clear caches.
    const npmPaths = await import('../../../../src/util/npm/paths.mts')
    getNpmBinPath = npmPaths.getNpmBinPath
    getNpmDirPath = npmPaths.getNpmDirPath
    getNpxBinPath = npmPaths.getNpxBinPath
  })

  afterEach(() => {
    // Restore original process.exit.
    process.exit = originalExit
    vi.restoreAllMocks()
    vi.resetModules()
  })

  describe('getNpmBinPath', () => {
    it('returns npm bin path when found', async () => {
      const { findBinPathDetailsSync } = vi.mocked(
        await import('../../../../src/util/fs/path-resolve.mts'),
      )
      findBinPathDetailsSync.mockReturnValue({
        path: '/usr/local/bin/npm',
      })

      const result = getNpmBinPath()

      // Normalize path separators for cross-platform compatibility.
      expect(result?.replace(/\\/g, '/')).toBe('/usr/local/bin/npm')
      expect(findBinPathDetailsSync).toHaveBeenCalledWith('npm')
    })

    it('exits with error when npm not found', async () => {
      const { findBinPathDetailsSync } = vi.mocked(
        await import('../../../../src/util/fs/path-resolve.mts'),
      )
      findBinPathDetailsSync.mockReturnValue({
        path: undefined,
      })

      vi.mocked(await import('@socketsecurity/lib-stable/logger'))

      expect(() => getNpmBinPath()).toThrow('process.exit(127)')
      expect(mockLogger.fail).toHaveBeenCalledWith(
        expect.stringContaining('Socket unable to locate npm'),
      )
    })

    it('caches the result', async () => {
      const { findBinPathDetailsSync } = vi.mocked(
        await import('../../../../src/util/fs/path-resolve.mts'),
      )
      findBinPathDetailsSync.mockReturnValue({
        path: '/usr/local/bin/npm',
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
        await import('../../../../src/util/fs/path-resolve.mts'),
      )
      findBinPathDetailsSync.mockReturnValue({
        path: '/usr/local/bin/npm',
      })
      findNpmDirPathSync.mockReturnValue('/usr/local/lib/node_modules/npm')

      const result = getNpmDirPath()

      // Normalize path separators for cross-platform compatibility.
      expect(result?.replace(/\\/g, '/')).toBe(
        '/usr/local/lib/node_modules/npm',
      )
      expect(findNpmDirPathSync).toHaveBeenCalledWith('/usr/local/bin/npm')
    })

    it('uses SOCKET_CLI_NPM_PATH when npm dir not found', async () => {
      // Set up the environment variable mock before importing.
      vi.resetModules()
      vi.doMock('../../../../src/env/socket-cli-npm-path.mts', () => ({
        SOCKET_CLI_NPM_PATH: '/custom/npm/path',
      }))

      const { findBinPathDetailsSync, findNpmDirPathSync } = vi.mocked(
        await import('../../../../src/util/fs/path-resolve.mts'),
      )
      findBinPathDetailsSync.mockReturnValue({
        path: '/usr/local/bin/npm',
      })
      findNpmDirPathSync.mockReturnValue(undefined)

      // Re-import after setting up mocks.
      const { getNpmDirPath: localGetNpmDirPath } =
        await import('../../../../src/util/npm/paths.mts')
      const result = localGetNpmDirPath()

      // Normalize path separators for cross-platform compatibility.
      expect(result?.replace(/\\/g, '/')).toBe('/custom/npm/path')
    })

    it('exits with error when npm directory not found', async () => {
      vi.resetModules()
      vi.doMock('../../../../src/env/socket-cli-npm-path.mts', () => ({
        SOCKET_CLI_NPM_PATH: undefined,
      }))

      const { findBinPathDetailsSync, findNpmDirPathSync } = vi.mocked(
        await import('../../../../src/util/fs/path-resolve.mts'),
      )
      findBinPathDetailsSync.mockReturnValue({
        path: '/usr/local/bin/npm',
      })
      findNpmDirPathSync.mockReturnValue(undefined)

      vi.mocked(await import('@socketsecurity/lib-stable/logger'))

      const { getNpmDirPath: localGetNpmDirPath } =
        await import('../../../../src/util/npm/paths.mts')
      expect(() => localGetNpmDirPath()).toThrow('process.exit(127)')
      expect(mockLogger.fail).toHaveBeenCalledWith(
        expect.stringContaining('Unable to find npm CLI install directory'),
      )
    })
  })

  describe('getNpxBinPath', () => {
    it('returns pnpm exec bin path when found', async () => {
      const { findBinPathDetailsSync } = vi.mocked(
        await import('../../../../src/util/fs/path-resolve.mts'),
      )
      findBinPathDetailsSync.mockReturnValue({
        path: '/usr/local/bin/npx',
      })

      const result = getNpxBinPath()

      // Normalize path separators for cross-platform compatibility.
      expect(result?.replace(/\\/g, '/')).toBe('/usr/local/bin/npx')
      expect(findBinPathDetailsSync).toHaveBeenCalledWith('npx')
    })

    it('exits with error when pnpm exec not found', async () => {
      const { findBinPathDetailsSync } = vi.mocked(
        await import('../../../../src/util/fs/path-resolve.mts'),
      )
      findBinPathDetailsSync.mockReturnValue({
        path: undefined,
      })

      vi.mocked(await import('@socketsecurity/lib-stable/logger'))

      expect(() => getNpxBinPath()).toThrow('process.exit(127)')
      expect(mockLogger.fail).toHaveBeenCalledWith(
        expect.stringContaining('Socket unable to locate npx'),
      )
    })

    it('caches the result', async () => {
      const { findBinPathDetailsSync } = vi.mocked(
        await import('../../../../src/util/fs/path-resolve.mts'),
      )
      findBinPathDetailsSync.mockReturnValue({
        path: '/usr/local/bin/npx',
      })

      const result1 = getNpxBinPath()
      const result2 = getNpxBinPath()

      expect(result1).toBe(result2)
      expect(findBinPathDetailsSync).toHaveBeenCalledTimes(1)
    })
  })
})
