/**
 * Unit tests for binary path resolution utilities.
 *
 * Purpose:
 * Tests the binary resolution logic for external tools like Coana, cdxgen, sfw, etc.
 *
 * Test Coverage:
 * - resolveCoana function
 * - resolveCdxgen function
 * - resolvePyCli function
 * - resolveSfw function
 * - resolveSocketPatch function
 * - resolveSynp function
 *
 * Related Files:
 * - src/utils/dlx/resolve-binary.mts (implementation)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock all environment variable modules.
const mockCoanaLocalPath = vi.hoisted(() => ({ SOCKET_CLI_COANA_LOCAL_PATH: '' }))
const mockCdxgenLocalPath = vi.hoisted(() => ({
  SOCKET_CLI_CDXGEN_LOCAL_PATH: '',
}))
const mockPyCliLocalPath = vi.hoisted(() => ({ SOCKET_CLI_PYCLI_LOCAL_PATH: '' }))
const mockSfwLocalPath = vi.hoisted(() => ({ SOCKET_CLI_SFW_LOCAL_PATH: '' }))
const mockSocketPatchLocalPath = vi.hoisted(() => ({
  SOCKET_CLI_SOCKET_PATCH_LOCAL_PATH: '',
}))

vi.mock('../../../../src/env/socket-cli-coana-local-path.mts', () => mockCoanaLocalPath)
vi.mock(
  '../../../../src/env/socket-cli-cdxgen-local-path.mts',
  () => mockCdxgenLocalPath,
)
vi.mock(
  '../../../../src/env/socket-cli-pycli-local-path.mts',
  () => mockPyCliLocalPath,
)
vi.mock('../../../../src/env/socket-cli-sfw-local-path.mts', () => mockSfwLocalPath)
vi.mock(
  '../../../../src/env/socket-cli-socket-patch-local-path.mts',
  () => mockSocketPatchLocalPath,
)

// Mock version getters.
vi.mock('../../../../src/env/coana-version.mts', () => ({
  getCoanaVersion: () => '1.0.0',
}))
vi.mock('../../../../src/env/cdxgen-version.mts', () => ({
  getCdxgenVersion: () => '10.0.0',
}))
vi.mock('../../../../src/env/sfw-version.mts', () => ({
  getSfwNpmVersion: () => '2.0.0',
}))
vi.mock('../../../../src/env/socket-patch-version.mts', () => ({
  getSocketPatchVersion: () => '2.0.0',
}))
vi.mock('../../../../src/env/synp-version.mts', () => ({
  getSynpVersion: () => '3.0.0',
}))

// Mock os module.
const mockOs = vi.hoisted(() => ({
  platform: vi.fn(() => 'darwin'),
  arch: vi.fn(() => 'arm64'),
}))
vi.mock('node:os', () => ({ default: mockOs }))

describe('binary resolution utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    // Reset all local path mocks.
    mockCoanaLocalPath.SOCKET_CLI_COANA_LOCAL_PATH = ''
    mockCdxgenLocalPath.SOCKET_CLI_CDXGEN_LOCAL_PATH = ''
    mockPyCliLocalPath.SOCKET_CLI_PYCLI_LOCAL_PATH = ''
    mockSfwLocalPath.SOCKET_CLI_SFW_LOCAL_PATH = ''
    mockSocketPatchLocalPath.SOCKET_CLI_SOCKET_PATCH_LOCAL_PATH = ''
    mockOs.platform.mockReturnValue('darwin')
    mockOs.arch.mockReturnValue('arm64')
  })

  describe('resolveCoana', () => {
    it('returns dlx spec when no local path is set', async () => {
      const { resolveCoana } = await import(
        '../../../../src/utils/dlx/resolve-binary.mts'
      )

      const result = resolveCoana()

      expect(result).toEqual({
        type: 'dlx',
        details: {
          name: '@coana-tech/cli',
          version: '1.0.0',
          binaryName: 'coana',
        },
      })
    })

    it('returns local path when SOCKET_CLI_COANA_LOCAL_PATH is set', async () => {
      mockCoanaLocalPath.SOCKET_CLI_COANA_LOCAL_PATH = '/custom/path/coana'

      const { resolveCoana } = await import(
        '../../../../src/utils/dlx/resolve-binary.mts'
      )

      const result = resolveCoana()

      expect(result).toEqual({
        type: 'local',
        path: '/custom/path/coana',
      })
    })
  })

  describe('resolveCdxgen', () => {
    it('returns dlx spec when no local path is set', async () => {
      const { resolveCdxgen } = await import(
        '../../../../src/utils/dlx/resolve-binary.mts'
      )

      const result = resolveCdxgen()

      expect(result).toEqual({
        type: 'dlx',
        details: {
          name: '@cyclonedx/cdxgen',
          version: '10.0.0',
          binaryName: 'cdxgen',
        },
      })
    })

    it('returns local path when SOCKET_CLI_CDXGEN_LOCAL_PATH is set', async () => {
      mockCdxgenLocalPath.SOCKET_CLI_CDXGEN_LOCAL_PATH = '/custom/path/cdxgen'

      const { resolveCdxgen } = await import(
        '../../../../src/utils/dlx/resolve-binary.mts'
      )

      const result = resolveCdxgen()

      expect(result).toEqual({
        type: 'local',
        path: '/custom/path/cdxgen',
      })
    })
  })

  describe('resolvePyCli', () => {
    it('returns python type when no local path is set', async () => {
      const { resolvePyCli } = await import(
        '../../../../src/utils/dlx/resolve-binary.mts'
      )

      const result = resolvePyCli()

      expect(result).toEqual({ type: 'python' })
    })

    it('returns local path when SOCKET_CLI_PYCLI_LOCAL_PATH is set', async () => {
      mockPyCliLocalPath.SOCKET_CLI_PYCLI_LOCAL_PATH = '/custom/path/socket-pycli'

      const { resolvePyCli } = await import(
        '../../../../src/utils/dlx/resolve-binary.mts'
      )

      const result = resolvePyCli()

      expect(result).toEqual({
        type: 'local',
        path: '/custom/path/socket-pycli',
      })
    })
  })

  describe('resolveSfw', () => {
    it('returns dlx spec when no local path is set', async () => {
      const { resolveSfw } = await import(
        '../../../../src/utils/dlx/resolve-binary.mts'
      )

      const result = resolveSfw()

      expect(result).toEqual({
        type: 'dlx',
        details: {
          name: 'sfw',
          version: '2.0.0',
          binaryName: 'sfw',
        },
      })
    })

    it('returns local path when SOCKET_CLI_SFW_LOCAL_PATH is set', async () => {
      mockSfwLocalPath.SOCKET_CLI_SFW_LOCAL_PATH = '/custom/path/sfw'

      const { resolveSfw } = await import(
        '../../../../src/utils/dlx/resolve-binary.mts'
      )

      const result = resolveSfw()

      expect(result).toEqual({
        type: 'local',
        path: '/custom/path/sfw',
      })
    })
  })

  describe('resolveSocketPatch', () => {
    it('returns github-release spec for darwin-arm64', async () => {
      mockOs.platform.mockReturnValue('darwin')
      mockOs.arch.mockReturnValue('arm64')

      const { resolveSocketPatch } = await import(
        '../../../../src/utils/dlx/resolve-binary.mts'
      )

      const result = resolveSocketPatch()

      expect(result).toEqual({
        type: 'github-release',
        details: {
          owner: 'SocketDev',
          repo: 'socket-patch',
          version: '2.0.0',
          assetName: 'socket-patch-aarch64-apple-darwin.tar.gz',
          binaryName: 'socket-patch',
        },
      })
    })

    it('returns github-release spec for darwin-x64', async () => {
      mockOs.platform.mockReturnValue('darwin')
      mockOs.arch.mockReturnValue('x64')

      const { resolveSocketPatch } = await import(
        '../../../../src/utils/dlx/resolve-binary.mts'
      )

      const result = resolveSocketPatch()

      expect(result).toEqual({
        type: 'github-release',
        details: {
          owner: 'SocketDev',
          repo: 'socket-patch',
          version: '2.0.0',
          assetName: 'socket-patch-x86_64-apple-darwin.tar.gz',
          binaryName: 'socket-patch',
        },
      })
    })

    it('returns github-release spec for linux-arm64', async () => {
      mockOs.platform.mockReturnValue('linux')
      mockOs.arch.mockReturnValue('arm64')

      const { resolveSocketPatch } = await import(
        '../../../../src/utils/dlx/resolve-binary.mts'
      )

      const result = resolveSocketPatch()

      expect(result).toEqual({
        type: 'github-release',
        details: {
          owner: 'SocketDev',
          repo: 'socket-patch',
          version: '2.0.0',
          assetName: 'socket-patch-aarch64-unknown-linux-gnu.tar.gz',
          binaryName: 'socket-patch',
        },
      })
    })

    it('returns github-release spec for linux-x64', async () => {
      mockOs.platform.mockReturnValue('linux')
      mockOs.arch.mockReturnValue('x64')

      const { resolveSocketPatch } = await import(
        '../../../../src/utils/dlx/resolve-binary.mts'
      )

      const result = resolveSocketPatch()

      expect(result).toEqual({
        type: 'github-release',
        details: {
          owner: 'SocketDev',
          repo: 'socket-patch',
          version: '2.0.0',
          assetName: 'socket-patch-x86_64-unknown-linux-musl.tar.gz',
          binaryName: 'socket-patch',
        },
      })
    })

    it('returns github-release spec for win32-x64', async () => {
      mockOs.platform.mockReturnValue('win32')
      mockOs.arch.mockReturnValue('x64')

      const { resolveSocketPatch } = await import(
        '../../../../src/utils/dlx/resolve-binary.mts'
      )

      const result = resolveSocketPatch()

      expect(result).toEqual({
        type: 'github-release',
        details: {
          owner: 'SocketDev',
          repo: 'socket-patch',
          version: '2.0.0',
          assetName: 'socket-patch-x86_64-pc-windows-msvc.zip',
          binaryName: 'socket-patch',
        },
      })
    })

    it('returns github-release spec for win32-arm64', async () => {
      mockOs.platform.mockReturnValue('win32')
      mockOs.arch.mockReturnValue('arm64')

      const { resolveSocketPatch } = await import(
        '../../../../src/utils/dlx/resolve-binary.mts'
      )

      const result = resolveSocketPatch()

      expect(result).toEqual({
        type: 'github-release',
        details: {
          owner: 'SocketDev',
          repo: 'socket-patch',
          version: '2.0.0',
          assetName: 'socket-patch-aarch64-pc-windows-msvc.zip',
          binaryName: 'socket-patch',
        },
      })
    })

    it('throws error for unsupported platform', async () => {
      mockOs.platform.mockReturnValue('freebsd')
      mockOs.arch.mockReturnValue('x64')

      const { resolveSocketPatch } = await import(
        '../../../../src/utils/dlx/resolve-binary.mts'
      )

      expect(() => resolveSocketPatch()).toThrow(
        'socket-patch is not available for platform freebsd-x64',
      )
    })

    it('returns local path when SOCKET_CLI_SOCKET_PATCH_LOCAL_PATH is set', async () => {
      mockSocketPatchLocalPath.SOCKET_CLI_SOCKET_PATCH_LOCAL_PATH =
        '/custom/path/socket-patch'

      const { resolveSocketPatch } = await import(
        '../../../../src/utils/dlx/resolve-binary.mts'
      )

      const result = resolveSocketPatch()

      expect(result).toEqual({
        type: 'local',
        path: '/custom/path/socket-patch',
      })
    })
  })

  describe('resolveSynp', () => {
    it('returns dlx spec', async () => {
      const { resolveSynp } = await import(
        '../../../../src/utils/dlx/resolve-binary.mts'
      )

      const result = resolveSynp()

      expect(result).toEqual({
        type: 'dlx',
        details: {
          name: 'synp',
          version: '3.0.0',
          binaryName: 'synp',
        },
      })
    })
  })
})
