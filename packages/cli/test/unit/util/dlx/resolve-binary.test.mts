/* max-file-lines: test — comprehensive test suite for one command/module; splitting would fragment closely related assertions. */
/**
 * Unit tests for binary path resolution utilities.
 *
 * Purpose: Tests the binary resolution logic for external tools like Coana,
 * cdxgen, sfw, etc.
 *
 * Test Coverage: - resolveCoana function - resolveCdxgen function -
 * resolvePyCli function - resolveSfw function - resolveSocketPatch function.
 *
 * Related Files: - src/util/dlx/resolve-binary.mts (implementation)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock all environment variable modules.
const mockCoanaLocalPath = vi.hoisted(() => ({
  SOCKET_CLI_COANA_LOCAL_PATH: '',
}))
const mockCdxgenLocalPath = vi.hoisted(() => ({
  SOCKET_CLI_CDXGEN_LOCAL_PATH: '',
}))
const mockPyCliLocalPath = vi.hoisted(() => ({
  SOCKET_CLI_PYCLI_LOCAL_PATH: '',
}))
const mockSfwLocalPath = vi.hoisted(() => ({ SOCKET_CLI_SFW_LOCAL_PATH: '' }))
const mockSocketPatchLocalPath = vi.hoisted(() => ({
  SOCKET_CLI_SOCKET_PATCH_LOCAL_PATH: '',
}))

vi.mock(
  import('../../../../src/env/socket-cli-coana-local-path.mts'),
  () => mockCoanaLocalPath,
)
vi.mock(
  import('../../../../src/env/socket-cli-cdxgen-local-path.mts'),
  () => mockCdxgenLocalPath,
)
vi.mock(
  import('../../../../src/env/socket-cli-pycli-local-path.mts'),
  () => mockPyCliLocalPath,
)
vi.mock(
  import('../../../../src/env/socket-cli-sfw-local-path.mts'),
  () => mockSfwLocalPath,
)
vi.mock(
  import('../../../../src/env/socket-cli-socket-patch-local-path.mts'),
  () => mockSocketPatchLocalPath,
)

// Mock version getters.
vi.mock(import('../../../../src/env/coana-version.mts'), () => ({
  getCoanaVersion: () => '1.0.0',
}))
vi.mock(import('../../../../src/env/cdxgen-version.mts'), () => ({
  getCdxgenVersion: () => '10.0.0',
}))
vi.mock(import('../../../../src/env/sfw-version.mts'), () => ({
  getSwfVersion: () => 'v1.12.0',
}))
vi.mock(import('../../../../src/env/socket-patch-version.mts'), () => ({
  getSocketPatchVersion: () => '2.0.0',
}))
vi.mock(import('../../../../src/env/synp-version.mts'), () => ({
  getSynpVersion: () => '3.0.0',
}))
vi.mock(import('../../../../src/env/trivy-version.mts'), () => ({
  getTrivyVersion: () => '0.50.0',
}))
vi.mock(import('../../../../src/env/trufflehog-version.mts'), () => ({
  getTrufflehogVersion: () => '3.40.0',
}))
vi.mock(import('../../../../src/env/opengrep-version.mts'), () => ({
  getOpengrepVersion: () => '1.5.0',
}))
vi.mock(import('../../../../src/env/trivy-checksums.mts'), () => ({
  requireTrivyChecksum: vi.fn(() => 'trivy-sha'),
}))
vi.mock(import('../../../../src/env/trufflehog-checksums.mts'), () => ({
  requireTrufflehogChecksum: vi.fn(() => 'trufflehog-sha'),
}))
vi.mock(import('../../../../src/env/opengrep-checksums.mts'), () => ({
  requireOpengrepChecksum: vi.fn(() => 'opengrep-sha'),
}))
vi.mock(import('../../../../src/env/socket-patch-checksums.mts'), () => ({
  requireSocketPatchChecksum: vi.fn(() => 'socket-patch-sha'),
}))
vi.mock(import('../../../../src/env/sfw-checksums.mts'), () => ({
  requireSfwChecksum: vi.fn(() => 'sfw-sha'),
}))

// Mock os module.
const mockOs = vi.hoisted(() => ({
  platform: vi.fn(() => 'darwin'),
  arch: vi.fn(() => 'arm64'),
}))
vi.mock(import('node:os'), () => ({ default: mockOs }))

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
      const { resolveCoana } =
        await import('../../../../src/util/dlx/resolve-binary.mts')

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

      const { resolveCoana } =
        await import('../../../../src/util/dlx/resolve-binary.mts')

      const result = resolveCoana()

      expect(result).toEqual({
        type: 'local',
        path: '/custom/path/coana',
      })
    })
  })

  describe('resolveCdxgen', () => {
    it('returns dlx spec when no local path is set', async () => {
      const { resolveCdxgen } =
        await import('../../../../src/util/dlx/resolve-binary.mts')

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

      const { resolveCdxgen } =
        await import('../../../../src/util/dlx/resolve-binary.mts')

      const result = resolveCdxgen()

      expect(result).toEqual({
        type: 'local',
        path: '/custom/path/cdxgen',
      })
    })
  })

  describe('resolvePyCli', () => {
    it('returns python type when no local path is set', async () => {
      const { resolvePyCli } =
        await import('../../../../src/util/dlx/resolve-binary.mts')

      const result = resolvePyCli()

      expect(result).toEqual({ type: 'python' })
    })

    it('returns local path when SOCKET_CLI_PYCLI_LOCAL_PATH is set', async () => {
      mockPyCliLocalPath.SOCKET_CLI_PYCLI_LOCAL_PATH =
        '/custom/path/socket-pycli'

      const { resolvePyCli } =
        await import('../../../../src/util/dlx/resolve-binary.mts')

      const result = resolvePyCli()

      expect(result).toEqual({
        type: 'local',
        path: '/custom/path/socket-pycli',
      })
    })
  })

  describe('resolveSfw', () => {
    it('returns github-release spec when no local path is set', async () => {
      mockOs.platform.mockReturnValue('darwin')
      mockOs.arch.mockReturnValue('arm64')

      const { resolveSfw } =
        await import('../../../../src/util/dlx/resolve-binary.mts')

      const result = resolveSfw()

      expect(result).toMatchObject({
        type: 'github-release',
        details: {
          owner: 'SocketDev',
          repo: 'sfw-free',
          version: 'v1.12.0',
          assetName: 'sfw-free-macos-arm64',
          binaryName: 'sfw',
        },
      })
    })

    it('returns local path when SOCKET_CLI_SFW_LOCAL_PATH is set', async () => {
      mockSfwLocalPath.SOCKET_CLI_SFW_LOCAL_PATH = '/custom/path/sfw'

      const { resolveSfw } =
        await import('../../../../src/util/dlx/resolve-binary.mts')

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

      const { resolveSocketPatch } =
        await import('../../../../src/util/dlx/resolve-binary.mts')

      const result = resolveSocketPatch()

      expect(result).toMatchObject({
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

      const { resolveSocketPatch } =
        await import('../../../../src/util/dlx/resolve-binary.mts')

      const result = resolveSocketPatch()

      expect(result).toMatchObject({
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

      const { resolveSocketPatch } =
        await import('../../../../src/util/dlx/resolve-binary.mts')

      const result = resolveSocketPatch()

      expect(result).toMatchObject({
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

      const { resolveSocketPatch } =
        await import('../../../../src/util/dlx/resolve-binary.mts')

      const result = resolveSocketPatch()

      expect(result).toMatchObject({
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

      const { resolveSocketPatch } =
        await import('../../../../src/util/dlx/resolve-binary.mts')

      const result = resolveSocketPatch()

      expect(result).toMatchObject({
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

      const { resolveSocketPatch } =
        await import('../../../../src/util/dlx/resolve-binary.mts')

      const result = resolveSocketPatch()

      expect(result).toMatchObject({
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

      const { resolveSocketPatch } =
        await import('../../../../src/util/dlx/resolve-binary.mts')

      expect(() => resolveSocketPatch()).toThrow(
        /socket-patch has no prebuilt binary for "freebsd-x64"/,
      )
    })

    it('returns local path when SOCKET_CLI_SOCKET_PATCH_LOCAL_PATH is set', async () => {
      mockSocketPatchLocalPath.SOCKET_CLI_SOCKET_PATCH_LOCAL_PATH =
        '/custom/path/socket-patch'

      const { resolveSocketPatch } =
        await import('../../../../src/util/dlx/resolve-binary.mts')

      const result = resolveSocketPatch()

      expect(result).toEqual({
        type: 'local',
        path: '/custom/path/socket-patch',
      })
    })
  })

  describe('resolveTrivy', () => {
    it.each([
      ['darwin', 'arm64', 'trivy_0.50.0_macOS-ARM64.tar.gz'],
      ['darwin', 'x64', 'trivy_0.50.0_macOS-64bit.tar.gz'],
      ['linux', 'arm64', 'trivy_0.50.0_Linux-ARM64.tar.gz'],
      ['linux', 'x64', 'trivy_0.50.0_Linux-64bit.tar.gz'],
      ['win32', 'x64', 'trivy_0.50.0_windows-64bit.zip'],
    ])('returns spec for %s-%s', async (platform, arch, assetName) => {
      mockOs.platform.mockReturnValue(platform as unknown)
      mockOs.arch.mockReturnValue(arch as unknown)

      const { resolveTrivy } =
        await import('../../../../src/util/dlx/resolve-binary.mts')

      const result = resolveTrivy()

      expect(result).toEqual({
        type: 'github-release',
        details: {
          assetName,
          binaryName: 'trivy',
          owner: 'aquasecurity',
          repo: 'trivy',
          sha256: 'trivy-sha',
          version: 'v0.50.0',
        },
      })
    })

    it('throws on unsupported platform', async () => {
      mockOs.platform.mockReturnValue('win32' as unknown)
      mockOs.arch.mockReturnValue('arm64' as unknown)

      const { resolveTrivy } =
        await import('../../../../src/util/dlx/resolve-binary.mts')

      expect(() => resolveTrivy()).toThrow(
        /Trivy has no prebuilt binary for "win32-arm64"/,
      )
    })
  })

  describe('resolveTrufflehog', () => {
    it.each([
      ['darwin', 'arm64', 'trufflehog_3.40.0_darwin_arm64.tar.gz'],
      ['darwin', 'x64', 'trufflehog_3.40.0_darwin_amd64.tar.gz'],
      ['linux', 'arm64', 'trufflehog_3.40.0_linux_arm64.tar.gz'],
      ['linux', 'x64', 'trufflehog_3.40.0_linux_amd64.tar.gz'],
      ['win32', 'arm64', 'trufflehog_3.40.0_windows_arm64.tar.gz'],
      ['win32', 'x64', 'trufflehog_3.40.0_windows_amd64.tar.gz'],
    ])('returns spec for %s-%s', async (platform, arch, assetName) => {
      mockOs.platform.mockReturnValue(platform as unknown)
      mockOs.arch.mockReturnValue(arch as unknown)

      const { resolveTrufflehog } =
        await import('../../../../src/util/dlx/resolve-binary.mts')

      const result = resolveTrufflehog()

      expect(result).toMatchObject({
        type: 'github-release',
        details: {
          assetName,
          binaryName: 'trufflehog',
          owner: 'trufflesecurity',
          repo: 'trufflehog',
          version: 'v3.40.0',
        },
      })
    })

    it('throws on unsupported platform', async () => {
      mockOs.platform.mockReturnValue('freebsd' as unknown)
      mockOs.arch.mockReturnValue('x64' as unknown)

      const { resolveTrufflehog } =
        await import('../../../../src/util/dlx/resolve-binary.mts')

      expect(() => resolveTrufflehog()).toThrow(
        /TruffleHog has no prebuilt binary for "freebsd-x64"/,
      )
    })
  })

  describe('resolveOpengrep', () => {
    it.each([
      ['darwin', 'arm64', 'opengrep-core_osx_aarch64.tar.gz'],
      ['darwin', 'x64', 'opengrep-core_osx_x86.tar.gz'],
      ['linux', 'arm64', 'opengrep-core_linux_aarch64.tar.gz'],
      ['linux', 'x64', 'opengrep-core_linux_x86.tar.gz'],
      ['win32', 'x64', 'opengrep-core_windows_x86.zip'],
    ])('returns spec for %s-%s', async (platform, arch, assetName) => {
      mockOs.platform.mockReturnValue(platform as unknown)
      mockOs.arch.mockReturnValue(arch as unknown)

      const { resolveOpengrep } =
        await import('../../../../src/util/dlx/resolve-binary.mts')

      const result = resolveOpengrep()

      expect(result).toMatchObject({
        type: 'github-release',
        details: {
          assetName,
          binaryName: 'osemgrep',
          owner: 'opengrep',
          repo: 'opengrep',
          version: '1.5.0',
        },
      })
    })

    it('throws on unsupported platform', async () => {
      mockOs.platform.mockReturnValue('win32' as unknown)
      mockOs.arch.mockReturnValue('arm64' as unknown)

      const { resolveOpengrep } =
        await import('../../../../src/util/dlx/resolve-binary.mts')

      expect(() => resolveOpengrep()).toThrow(
        /OpenGrep has no prebuilt binary for "win32-arm64"/,
      )
    })
  })
})
