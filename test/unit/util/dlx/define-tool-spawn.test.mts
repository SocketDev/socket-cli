import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineGitHubReleaseSpawn } from '../../../../src/util/dlx/define-tool-spawn.mts'

const mockSpawn = vi.hoisted(() => vi.fn())
const mockDownloadGitHubReleaseBinary = vi.hoisted(() => vi.fn())

vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: mockSpawn,
}))

vi.mock(import('../../../../src/util/dlx/spawn.mts'), () => ({
  downloadGitHubReleaseBinary: mockDownloadGitHubReleaseBinary,
}))

describe('GitHub release spawning', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('defineGitHubReleaseSpawn', () => {
    it('downloads + spawns a GitHub-release tool', async () => {
      mockDownloadGitHubReleaseBinary.mockResolvedValue('/cache/trufflehog')
      mockSpawn.mockReturnValue('mock-spawn-promise')
      const fn = defineGitHubReleaseSpawn({
        toolName: 'trufflehog',
        resolve: () => ({
          type: 'github-release',
          details: { name: 'trufflehog', version: '3.0.0' } as unknown,
        }),
      })
      const result = await fn(['scan'], undefined, undefined)
      expect(mockDownloadGitHubReleaseBinary).toHaveBeenCalled()
      expect(mockSpawn).toHaveBeenCalledWith(
        '/cache/trufflehog',
        ['scan'],
        expect.objectContaining({
          stdio: 'inherit',
          env: expect.any(Object),
        }),
      )
      expect(result).toEqual({ spawnPromise: 'mock-spawn-promise' })
    })

    it('honors a custom stdio passed via spawnExtra', async () => {
      mockDownloadGitHubReleaseBinary.mockResolvedValue('/cache/trivy')
      mockSpawn.mockReturnValue('p')
      const fn = defineGitHubReleaseSpawn({
        toolName: 'trivy',
        resolve: () => ({
          type: 'github-release',
          details: { name: 'trivy', version: '1.0.0' } as unknown,
        }),
      })
      await fn(['fs', '/'], undefined, { stdio: 'pipe' })
      expect(mockSpawn).toHaveBeenCalledWith(
        '/cache/trivy',
        ['fs', '/'],
        expect.objectContaining({ stdio: 'pipe' }),
      )
    })

    it('merges options.env into the child env', async () => {
      mockDownloadGitHubReleaseBinary.mockResolvedValue('/cache/opengrep')
      mockSpawn.mockReturnValue('p')
      const fn = defineGitHubReleaseSpawn({
        toolName: 'opengrep',
        resolve: () => ({
          type: 'github-release',
          details: { name: 'opengrep', version: '1.0.0' } as unknown,
        }),
      })
      await fn([], { env: { FOO: 'bar' } }, undefined)
      const callEnv = mockSpawn.mock.calls[0][2].env
      expect(callEnv.FOO).toBe('bar')
    })

    it('throws an internal error when the resolver returns the wrong type', async () => {
      const fn = defineGitHubReleaseSpawn({
        toolName: 'trufflehog',
        // Resolver contract bug: type='dlx' instead of 'github-release'.
        resolve: () =>
          ({
            type: 'dlx',
            details: { name: 'trufflehog', version: '3.0.0' },
          }) as unknown,
      })
      await expect(fn([], undefined, undefined)).rejects.toThrow(
        /resolveTrufflehog returned resolution\.type="dlx"/,
      )
    })
  })
})
