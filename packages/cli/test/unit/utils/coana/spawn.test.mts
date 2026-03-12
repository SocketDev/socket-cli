/**
 * Unit tests for Coana spawn utilities.
 *
 * Purpose:
 * Tests the Coana CLI spawning functionality.
 *
 * Test Coverage:
 * - spawnCoana function export
 * - Environment variable handling
 * - Error handling
 *
 * Related Files:
 * - utils/coana/spawn.mts (implementation)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock dependencies.
const mockSpawnNode = vi.hoisted(() => vi.fn())
const mockDlxPackage = vi.hoisted(() => vi.fn())
const mockGetDefaultOrgSlug = vi.hoisted(() => vi.fn())
const mockGetCliVersion = vi.hoisted(() => vi.fn())
const mockGetCoanaVersion = vi.hoisted(() => vi.fn())
const mockGetDefaultApiToken = vi.hoisted(() => vi.fn())
const mockGetDefaultProxyUrl = vi.hoisted(() => vi.fn())
const mockGetErrorCause = vi.hoisted(() => vi.fn())

vi.mock('@socketsecurity/lib/dlx/package', () => ({
  dlxPackage: mockDlxPackage,
}))

vi.mock('../../../../src/commands/ci/fetch-default-org-slug.mts', () => ({
  getDefaultOrgSlug: mockGetDefaultOrgSlug,
}))

vi.mock('../../../../src/env/cli-version.mts', () => ({
  getCliVersion: mockGetCliVersion,
}))

vi.mock('../../../../src/env/coana-version.mts', () => ({
  getCoanaVersion: mockGetCoanaVersion,
}))

vi.mock('../../../../src/env/socket-cli-coana-local-path.mts', () => ({
  SOCKET_CLI_COANA_LOCAL_PATH: null,
}))

vi.mock('../../../../src/utils/socket/sdk.mts', () => ({
  getDefaultApiToken: mockGetDefaultApiToken,
  getDefaultProxyUrl: mockGetDefaultProxyUrl,
}))

vi.mock('../../../../src/utils/error/errors.mts', () => ({
  getErrorCause: mockGetErrorCause,
}))

vi.mock('../../../../src/utils/spawn/spawn-node.mjs', () => ({
  spawnNode: mockSpawnNode,
}))

import { spawnCoana } from '../../../../src/utils/coana/spawn.mts'

describe('coana/spawn', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Default mock implementations.
    mockGetCliVersion.mockReturnValue('1.0.0')
    mockGetCoanaVersion.mockReturnValue('1.0.0')
    mockGetDefaultApiToken.mockReturnValue(null)
    mockGetDefaultProxyUrl.mockReturnValue(null)
    mockGetDefaultOrgSlug.mockResolvedValue({ ok: false })
    mockGetErrorCause.mockReturnValue('Unknown error')

    mockDlxPackage.mockResolvedValue({
      spawnPromise: Promise.resolve({ stdout: 'success', code: 0 }),
    })
  })

  describe('spawnCoana', () => {
    it('exports spawnCoana function', () => {
      expect(typeof spawnCoana).toBe('function')
    })

    it('spawns coana with dlxPackage when no local path set', async () => {
      const result = await spawnCoana(['--version'])

      expect(result.ok).toBe(true)
      expect(mockDlxPackage).toHaveBeenCalled()
    })

    it('passes environment variables to coana', async () => {
      mockGetDefaultApiToken.mockReturnValue('test-token')
      mockGetDefaultProxyUrl.mockReturnValue('http://proxy.example.com')

      await spawnCoana(['--version'])

      const call = mockDlxPackage.mock.calls[0]
      const spawnOptions = call[1].spawnOptions
      expect(spawnOptions.env.SOCKET_CLI_API_TOKEN).toBe('test-token')
      expect(spawnOptions.env.SOCKET_CLI_API_PROXY).toBe(
        'http://proxy.example.com',
      )
    })

    it('includes org slug in environment when provided', async () => {
      await spawnCoana(['--version'], 'my-org')

      const call = mockDlxPackage.mock.calls[0]
      const spawnOptions = call[1].spawnOptions
      expect(spawnOptions.env.SOCKET_ORG_SLUG).toBe('my-org')
    })

    it('fetches default org slug when not provided', async () => {
      mockGetDefaultOrgSlug.mockResolvedValue({ ok: true, data: 'default-org' })

      await spawnCoana(['--version'])

      expect(mockGetDefaultOrgSlug).toHaveBeenCalled()
      const call = mockDlxPackage.mock.calls[0]
      const spawnOptions = call[1].spawnOptions
      expect(spawnOptions.env.SOCKET_ORG_SLUG).toBe('default-org')
    })

    it('handles errors gracefully', async () => {
      mockDlxPackage.mockRejectedValue(new Error('Spawn failed'))
      mockGetErrorCause.mockReturnValue('Spawn failed')

      const result = await spawnCoana(['--version'])

      expect(result.ok).toBe(false)
      expect(result.message).toBe('Spawn failed')
    })

    it('uses force:true for dlxPackage', async () => {
      await spawnCoana(['--version'])

      const call = mockDlxPackage.mock.calls[0]
      expect(call[1].force).toBe(true)
    })

    it('passes CLI version to environment', async () => {
      mockGetCliVersion.mockReturnValue('2.0.0')

      await spawnCoana(['--version'])

      const call = mockDlxPackage.mock.calls[0]
      const spawnOptions = call[1].spawnOptions
      expect(spawnOptions.env.SOCKET_CLI_VERSION).toBe('2.0.0')
    })
  })
})
