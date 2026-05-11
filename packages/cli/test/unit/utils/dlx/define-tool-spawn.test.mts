/**
 * Unit tests for `defineToolSpawn` and its helpers.
 *
 * Locks in the contract that the factory builds the same Dlx/Vfs/auto triple
 * the per-tool spawn-* files used to assemble by hand.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockSpawn = vi.hoisted(() => vi.fn())
const mockDownloadGitHubReleaseBinary = vi.hoisted(() => vi.fn())
const mockSpawnToolVfs = vi.hoisted(() => vi.fn())
const mockAreExternalToolsAvailable = vi.hoisted(() => vi.fn())
const mockIsSeaBinary = vi.hoisted(() => vi.fn())

vi.mock('@socketsecurity/lib/spawn', () => ({
  spawn: mockSpawn,
}))

vi.mock('../../../../src/utils/dlx/spawn.mts', () => ({
  downloadGitHubReleaseBinary: mockDownloadGitHubReleaseBinary,
  spawnToolVfs: mockSpawnToolVfs,
}))

vi.mock('../../../../src/utils/dlx/vfs-extract.mts', () => ({
  areExternalToolsAvailable: mockAreExternalToolsAvailable,
}))

vi.mock('../../../../src/utils/sea/detect.mts', () => ({
  isSeaBinary: mockIsSeaBinary,
}))

import {
  defineAutoDispatch,
  defineGitHubReleaseSpawn,
  defineToolSpawn,
  defineVfsSpawn,
} from '../../../../src/utils/dlx/define-tool-spawn.mts'

describe('defineToolSpawn helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('defineVfsSpawn', () => {
    it('forwards to spawnToolVfs with the configured tool name', async () => {
      mockSpawnToolVfs.mockResolvedValue({ spawnPromise: Promise.resolve() })
      const fn = defineVfsSpawn('trufflehog' as unknown)
      await fn(['scan', '/path'], undefined, undefined)
      expect(mockSpawnToolVfs).toHaveBeenCalledWith(
        'trufflehog',
        ['scan', '/path'],
        undefined,
        undefined,
      )
    })

    it('passes options + spawnExtra through unchanged', async () => {
      mockSpawnToolVfs.mockResolvedValue({ spawnPromise: Promise.resolve() })
      const fn = defineVfsSpawn('trivy' as unknown)
      const opts = { env: { FOO: 'bar' } } as unknown
      const extra = { stdio: 'pipe' as unknown }
      await fn(['fs'], opts, extra)
      expect(mockSpawnToolVfs).toHaveBeenCalledWith(
        'trivy',
        ['fs'],
        opts,
        extra,
      )
    })
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
      await fn(['fs', '/'], undefined, { stdio: 'pipe' } as unknown)
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
      await fn([], { env: { FOO: 'bar' } } as unknown, undefined)
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

  describe('defineAutoDispatch', () => {
    it('uses Vfs in SEA mode with external tools available', async () => {
      mockIsSeaBinary.mockReturnValue(true)
      mockAreExternalToolsAvailable.mockReturnValue(true)
      const vfs = vi.fn().mockResolvedValue({ spawnPromise: 'vfs-result' })
      const dlx = vi.fn().mockResolvedValue({ spawnPromise: 'dlx-result' })
      const auto = defineAutoDispatch({ vfs, dlx })
      const result = await auto([], undefined, undefined)
      expect(vfs).toHaveBeenCalled()
      expect(dlx).not.toHaveBeenCalled()
      expect(result).toEqual({ spawnPromise: 'vfs-result' })
    })

    it('uses Dlx when not in SEA mode', async () => {
      mockIsSeaBinary.mockReturnValue(false)
      mockAreExternalToolsAvailable.mockReturnValue(true)
      const vfs = vi.fn().mockResolvedValue({ spawnPromise: 'vfs' })
      const dlx = vi.fn().mockResolvedValue({ spawnPromise: 'dlx' })
      const auto = defineAutoDispatch({ vfs, dlx })
      const result = await auto([], undefined, undefined)
      expect(dlx).toHaveBeenCalled()
      expect(vfs).not.toHaveBeenCalled()
      expect(result).toEqual({ spawnPromise: 'dlx' })
    })

    it('uses Dlx when in SEA but external tools missing', async () => {
      mockIsSeaBinary.mockReturnValue(true)
      mockAreExternalToolsAvailable.mockReturnValue(false)
      const vfs = vi.fn()
      const dlx = vi.fn().mockResolvedValue({ spawnPromise: 'dlx' })
      const auto = defineAutoDispatch({ vfs, dlx })
      await auto([], undefined, undefined)
      expect(dlx).toHaveBeenCalled()
      expect(vfs).not.toHaveBeenCalled()
    })
  })

  describe('defineToolSpawn (full triple)', () => {
    it('returns Dlx + Vfs + auto together', () => {
      const triple = defineToolSpawn({
        toolName: 'trufflehog',
        vfsName: 'trufflehog' as unknown,
        resolve: () =>
          ({
            type: 'github-release',
            details: { name: 'trufflehog', version: '3.0.0' },
          }) as unknown,
      })
      expect(typeof triple.Dlx).toBe('function')
      expect(typeof triple.Vfs).toBe('function')
      expect(typeof triple.auto).toBe('function')
    })

    it('auto routes to Vfs in SEA mode', async () => {
      mockIsSeaBinary.mockReturnValue(true)
      mockAreExternalToolsAvailable.mockReturnValue(true)
      mockSpawnToolVfs.mockResolvedValue({ spawnPromise: 'vfs' })
      const triple = defineToolSpawn({
        toolName: 'trivy',
        vfsName: 'trivy' as unknown,
        resolve: () =>
          ({
            type: 'github-release',
            details: { name: 'trivy', version: '1.0.0' },
          }) as unknown,
      })
      await triple.auto([], undefined, undefined)
      expect(mockSpawnToolVfs).toHaveBeenCalledWith(
        'trivy',
        [],
        undefined,
        undefined,
      )
    })

    it('auto routes to Dlx outside SEA mode', async () => {
      mockIsSeaBinary.mockReturnValue(false)
      mockDownloadGitHubReleaseBinary.mockResolvedValue('/cache/opengrep')
      mockSpawn.mockReturnValue('p')
      const triple = defineToolSpawn({
        toolName: 'opengrep',
        vfsName: 'opengrep' as unknown,
        resolve: () =>
          ({
            type: 'github-release',
            details: { name: 'opengrep', version: '1.0.0' },
          }) as unknown,
      })
      await triple.auto([], undefined, undefined)
      expect(mockDownloadGitHubReleaseBinary).toHaveBeenCalled()
      expect(mockSpawnToolVfs).not.toHaveBeenCalled()
    })
  })
})
