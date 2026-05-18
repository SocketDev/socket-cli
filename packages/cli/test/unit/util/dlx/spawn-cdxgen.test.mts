/**
 * Unit tests for the bespoke `spawnCdxgenDlx` flow.
 *
 * The Vfs / auto-dispatch code is tested via define-tool-spawn.test.mts. This
 * file targets the cdxgen-specific paths: local-override execution (binary or
 * JS via node) and the `spawnDlx` fallback for the npm dlx route.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockSpawn = vi.hoisted(() => vi.fn())
const mockSpawnDlx = vi.hoisted(() => vi.fn())
const mockResolveCdxgen = vi.hoisted(() => vi.fn())
const mockDetectExecutableType = vi.hoisted(() => vi.fn())

vi.mock('@socketsecurity/lib/spawn', () => ({
  spawn: mockSpawn,
}))

vi.mock('@socketsecurity/lib/dlx/detect', () => ({
  detectExecutableType: mockDetectExecutableType,
}))

vi.mock('../../../../src/util/dlx/spawn.mts', () => ({
  spawnDlx: mockSpawnDlx,
}))

vi.mock('../../../../src/util/dlx/resolve-binary.mts', () => ({
  resolveCdxgen: mockResolveCdxgen,
}))

import { spawnCdxgenDlx } from '../../../../src/util/dlx/spawn-cdxgen.mts'

describe('spawnCdxgenDlx', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('runs a local cdxgen binary when SOCKET_CLI_CDXGEN_LOCAL_PATH is set', async () => {
    mockResolveCdxgen.mockReturnValue({
      type: 'local',
      path: '/local/cdxgen',
    })
    mockDetectExecutableType.mockReturnValue({ type: 'binary' })
    mockSpawn.mockReturnValue('p')

    const result = await spawnCdxgenDlx(['-r', '.'], undefined, undefined)

    expect(mockSpawn).toHaveBeenCalledWith(
      '/local/cdxgen',
      ['-r', '.'],
      expect.objectContaining({ stdio: 'inherit' }),
    )
    expect(result).toEqual({ spawnPromise: 'p' })
  })

  it('runs the local cdxgen.js via node when not a binary', async () => {
    mockResolveCdxgen.mockReturnValue({
      type: 'local',
      path: '/local/cdxgen.js',
    })
    mockDetectExecutableType.mockReturnValue({ type: 'script' })
    mockSpawn.mockReturnValue('p')

    await spawnCdxgenDlx([], undefined, undefined)

    expect(mockSpawn).toHaveBeenCalledWith(
      'node',
      ['/local/cdxgen.js'],
      expect.any(Object),
    )
  })

  it('falls back to spawnDlx when resolution.type is "dlx"', async () => {
    mockResolveCdxgen.mockReturnValue({
      type: 'dlx',
      details: { name: '@cyclonedx/cdxgen', version: '11.0.0' },
    })
    mockSpawnDlx.mockResolvedValue({ spawnPromise: 'p' })

    const result = await spawnCdxgenDlx([], undefined, undefined)

    expect(mockSpawnDlx).toHaveBeenCalled()
    expect(result).toEqual({ spawnPromise: 'p' })
  })

  it('throws when resolveCdxgen returns an unexpected type', async () => {
    mockResolveCdxgen.mockReturnValue({
      type: 'github-release',
      details: {} as unknown,
    })

    await expect(spawnCdxgenDlx([], undefined, undefined)).rejects.toThrow(
      /resolveCdxgen returned resolution\.type="github-release"/,
    )
  })

  it('honors a custom stdio passed via spawnExtra', async () => {
    mockResolveCdxgen.mockReturnValue({
      type: 'local',
      path: '/local/cdxgen',
    })
    mockDetectExecutableType.mockReturnValue({ type: 'binary' })
    mockSpawn.mockReturnValue('p')

    await spawnCdxgenDlx([], undefined, { stdio: 'pipe' } as unknown)

    expect(mockSpawn).toHaveBeenCalledWith(
      '/local/cdxgen',
      [],
      expect.objectContaining({ stdio: 'pipe' }),
    )
  })
})
