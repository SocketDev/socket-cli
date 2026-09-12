import { beforeEach, describe, expect, it, vi } from 'vitest'
import { spawnSocketPatch } from '../../../../src/util/dlx/spawn-socket-patch.mts'

const mockSpawn = vi.hoisted(() => vi.fn())
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
}))

vi.mock(import('../../../../src/util/dlx/resolve-binary.mts'), () => ({
  resolveSocketPatch: mockResolveSocketPatch,
}))

describe('spawnSocketPatch', () => {
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

    const result = await spawnSocketPatch(['apply'], undefined, undefined)

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

    await spawnSocketPatch([], undefined, undefined)

    expect(mockSpawn).toHaveBeenCalledWith(
      process.execPath,
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

    const result = await spawnSocketPatch(['apply'], undefined, undefined)

    expect(mockDownloadGitHubReleaseBinary).toHaveBeenCalled()
    expect(mockSpawn).toHaveBeenCalledWith(
      '/cache/socket-patch',
      ['apply'],
      expect.objectContaining({ stdio: 'inherit' }),
    )
    expect(result).toEqual({ spawnPromise: 'p' })
  })

  it('honors a custom stdio passed via spawnExtra', async () => {
    mockResolveSocketPatch.mockReturnValue({
      type: 'github-release',
      details: { name: 'socket-patch', version: '2.0.0' },
    })
    mockDownloadGitHubReleaseBinary.mockResolvedValue('/cache/socket-patch')
    mockSpawn.mockReturnValue('p')

    await spawnSocketPatch([], undefined, { stdio: 'pipe' })

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

    await spawnSocketPatch([], { env: { FOO: 'bar' } }, undefined)

    const callEnv = mockSpawn.mock.calls[0][2].env
    expect(callEnv.FOO).toBe('bar')
  })
})
