/**
 * Unit tests for the bespoke `spawnSocketPatchDlx` flow.
 *
 * The Vfs / auto-dispatch code is tested via define-tool-spawn.test.mts. This
 * file targets the three-way Dlx dispatch (local override / GitHub release /
 * legacy npm fallback).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockSpawn = vi.hoisted(() => vi.fn())
const mockSpawnDlx = vi.hoisted(() => vi.fn())
const mockDownloadGitHubReleaseBinary = vi.hoisted(() => vi.fn())
const mockResolveSocketPatch = vi.hoisted(() => vi.fn())
const mockDetectExecutableType = vi.hoisted(() => vi.fn())

vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: mockSpawn,
}))

vi.mock(import('@socketsecurity/lib-stable/dlx/detect'), () => ({
  detectExecutableType: mockDetectExecutableType,
}))

vi.mock(import('../../../../src/util/dlx/spawn.mts'), () => ({
  downloadGitHubReleaseBinary: mockDownloadGitHubReleaseBinary,
  spawnDlx: mockSpawnDlx,
}))

vi.mock(import('../../../../src/util/dlx/resolve-binary.mts'), () => ({
  resolveSocketPatch: mockResolveSocketPatch,
}))

import { spawnSocketPatchDlx } from '../../../../src/util/dlx/spawn-socket-patch.mts'

describe('spawnSocketPatchDlx', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('runs a local socket-patch binary when SOCKET_CLI_SOCKET_PATCH_LOCAL_PATH is set', async () => {
    mockResolveSocketPatch.mockReturnValue({
      type: 'local',
      path: '/local/socket-patch',
    })
    mockDetectExecutableType.mockReturnValue({ type: 'binary' })
    mockSpawn.mockReturnValue('p')

    const result = await spawnSocketPatchDlx(['apply'], undefined, undefined)

    expect(mockSpawn).toHaveBeenCalledWith(
      '/local/socket-patch',
      ['apply'],
      expect.objectContaining({ stdio: 'inherit' }),
    )
    expect(result).toEqual({ spawnPromise: 'p' })
  })

  it('runs the local script via node when not a binary', async () => {
    mockResolveSocketPatch.mockReturnValue({
      type: 'local',
      path: '/local/socket-patch.js',
    })
    mockDetectExecutableType.mockReturnValue({ type: 'script' })
    mockSpawn.mockReturnValue('p')

    await spawnSocketPatchDlx([], undefined, undefined)

    expect(mockSpawn).toHaveBeenCalledWith(
      'node',
      ['/local/socket-patch.js'],
      expect.any(Object),
    )
  })

  it('downloads from GitHub releases when resolution.type is "github-release"', async () => {
    mockResolveSocketPatch.mockReturnValue({
      type: 'github-release',
      details: { name: 'socket-patch', version: '2.0.0' },
    })
    mockDownloadGitHubReleaseBinary.mockResolvedValue('/cache/socket-patch')
    mockSpawn.mockReturnValue('p')

    const result = await spawnSocketPatchDlx(['apply'], undefined, undefined)

    expect(mockDownloadGitHubReleaseBinary).toHaveBeenCalled()
    expect(mockSpawn).toHaveBeenCalledWith(
      '/cache/socket-patch',
      ['apply'],
      expect.objectContaining({ stdio: 'inherit' }),
    )
    expect(result).toEqual({ spawnPromise: 'p' })
  })

  it('falls back to spawnDlx for legacy npm-package resolutions', async () => {
    mockResolveSocketPatch.mockReturnValue({
      type: 'dlx',
      details: { name: 'socket-patch', version: '1.0.0' },
    })
    mockSpawnDlx.mockResolvedValue({ spawnPromise: 'p' })

    const result = await spawnSocketPatchDlx([], undefined, undefined)

    expect(mockSpawnDlx).toHaveBeenCalled()
    expect(result).toEqual({ spawnPromise: 'p' })
  })

  it('honors a custom stdio passed via spawnExtra', async () => {
    mockResolveSocketPatch.mockReturnValue({
      type: 'github-release',
      details: { name: 'socket-patch', version: '2.0.0' },
    })
    mockDownloadGitHubReleaseBinary.mockResolvedValue('/cache/socket-patch')
    mockSpawn.mockReturnValue('p')

    await spawnSocketPatchDlx([], undefined, { stdio: 'pipe' } as unknown)

    expect(mockSpawn).toHaveBeenCalledWith(
      '/cache/socket-patch',
      [],
      expect.objectContaining({ stdio: 'pipe' }),
    )
  })

  it('merges options.env into the child env (local path)', async () => {
    mockResolveSocketPatch.mockReturnValue({
      type: 'local',
      path: '/local/socket-patch',
    })
    mockDetectExecutableType.mockReturnValue({ type: 'binary' })
    mockSpawn.mockReturnValue('p')

    await spawnSocketPatchDlx([], { env: { FOO: 'bar' } } as unknown, undefined)

    const callEnv = mockSpawn.mock.calls[0][2].env
    expect(callEnv.FOO).toBe('bar')
  })
})
