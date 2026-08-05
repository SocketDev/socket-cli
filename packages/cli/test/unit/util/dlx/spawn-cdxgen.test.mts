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

vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: mockSpawn,
}))

vi.mock(import('@socketsecurity/lib-stable/dlx/detect'), () => ({
  detectExecutableType: mockDetectExecutableType,
}))

vi.mock(import('../../../../src/util/dlx/spawn.mts'), () => ({
  spawnDlx: mockSpawnDlx,
}))

vi.mock(import('../../../../src/util/dlx/resolve-binary.mts'), () => ({
  resolveCdxgen: mockResolveCdxgen,
}))

// The local-override paths below are fixtures, not real files. Stub the
// on-disk check so these tests stay about spawning; the check itself is
// covered in cdxgen-diagnostics.test.mts.
const mockIsMissingCdxgenLocalPath = vi.hoisted(() =>
  vi.fn().mockReturnValue(false),
)

vi.mock(import('../../../../src/util/dlx/cdxgen-diagnostics.mts'), () => ({
  isMissingCdxgenLocalPath: mockIsMissingCdxgenLocalPath,
  formatMissingCdxgenLocalPathMessage: (p: string) =>
    `SOCKET_CLI_CDXGEN_LOCAL_PATH points at a file that does not exist: ${p}`,
}))

import { spawnCdxgenDlx } from '../../../../src/util/dlx/spawn-cdxgen.mts'

describe('spawnCdxgenDlx', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsMissingCdxgenLocalPath.mockReturnValue(false)
  })

  it('refuses a SOCKET_CLI_CDXGEN_LOCAL_PATH that is not on disk', async () => {
    mockResolveCdxgen.mockReturnValue({
      type: 'local',
      path: '/local/missing-cdxgen',
    })
    mockIsMissingCdxgenLocalPath.mockReturnValue(true)

    await expect(
      spawnCdxgenDlx(['-r', '.'], undefined, undefined),
    ).rejects.toThrow(/SOCKET_CLI_CDXGEN_LOCAL_PATH/)
    expect(mockSpawn).not.toHaveBeenCalled()
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
      process.execPath,
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

    await spawnCdxgenDlx([], undefined, { stdio: 'pipe' })

    expect(mockSpawn).toHaveBeenCalledWith(
      '/local/cdxgen',
      [],
      expect.objectContaining({ stdio: 'pipe' }),
    )
  })
})
