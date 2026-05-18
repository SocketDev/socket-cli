/**
 * Unit tests for the bespoke `spawnSfwDlx` flow.
 *
 * The Vfs / auto-dispatch code is tested via define-tool-spawn.test.mts. This
 * file targets the sfw-specific paths: machine-mode application, local-override
 * execution, and the dlx fallback.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockSpawn = vi.hoisted(() => vi.fn())
const mockSpawnDlx = vi.hoisted(() => vi.fn())
const mockResolveSfw = vi.hoisted(() => vi.fn())
const mockDetectExecutableType = vi.hoisted(() => vi.fn())
const mockApplyMachineModeIfActive = vi.hoisted(() => vi.fn())
const mockInferSubcommand = vi.hoisted(() => vi.fn())

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
  resolveSfw: mockResolveSfw,
}))

vi.mock('../../../../src/util/spawn/apply-machine-mode.mts', () => ({
  applyMachineModeIfActive: mockApplyMachineModeIfActive,
  inferSubcommand: mockInferSubcommand,
}))

import { spawnSfwDlx } from '../../../../src/util/dlx/spawn-sfw.mts'

describe('spawnSfwDlx', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockInferSubcommand.mockReturnValue(undefined)
    mockApplyMachineModeIfActive.mockReturnValue({
      args: [],
      env: {},
    })
  })

  it('runs a local sfw binary when SOCKET_CLI_SFW_LOCAL_PATH is set', async () => {
    mockResolveSfw.mockReturnValue({
      type: 'local',
      path: '/local/sfw',
    })
    mockDetectExecutableType.mockReturnValue({ type: 'binary' })
    mockApplyMachineModeIfActive.mockReturnValue({
      args: ['install'],
      env: { MACHINE: '1' },
    })
    mockSpawn.mockReturnValue('spawn-promise')

    const result = await spawnSfwDlx(['npm', 'install'], undefined, undefined)

    expect(mockSpawn).toHaveBeenCalledWith(
      '/local/sfw',
      ['npm', 'install'],
      expect.objectContaining({ stdio: 'inherit' }),
    )
    expect(result).toEqual({ spawnPromise: 'spawn-promise' })
  })

  it('runs the local script via node when not a binary', async () => {
    mockResolveSfw.mockReturnValue({
      type: 'local',
      path: '/local/sfw.js',
    })
    mockDetectExecutableType.mockReturnValue({ type: 'script' })
    mockSpawn.mockReturnValue('p')

    await spawnSfwDlx(['npm'], undefined, undefined)

    expect(mockSpawn).toHaveBeenCalledWith(
      'node',
      ['/local/sfw.js', 'npm'],
      expect.objectContaining({ stdio: 'inherit' }),
    )
  })

  it('falls back to spawnDlx when resolution.type is "dlx"', async () => {
    mockResolveSfw.mockReturnValue({
      type: 'dlx',
      details: { name: 'sfw', version: '1.0.0' },
    })
    mockSpawnDlx.mockResolvedValue({ spawnPromise: 'dlx-promise' })

    const result = await spawnSfwDlx(['npm', 'install'], undefined, undefined)

    expect(mockSpawnDlx).toHaveBeenCalled()
    expect(result).toEqual({ spawnPromise: 'dlx-promise' })
  })

  it('throws when resolveSfw returns an unexpected type', async () => {
    mockResolveSfw.mockReturnValue({
      type: 'github-release',
      details: {} as unknown,
    })

    await expect(spawnSfwDlx([], undefined, undefined)).rejects.toThrow(
      /resolveSfw returned resolution\.type="github-release"/,
    )
  })

  it('honors a custom stdio passed via spawnExtra', async () => {
    mockResolveSfw.mockReturnValue({
      type: 'local',
      path: '/local/sfw',
    })
    mockDetectExecutableType.mockReturnValue({ type: 'binary' })
    mockSpawn.mockReturnValue('p')

    await spawnSfwDlx(['npm'], undefined, { stdio: 'pipe' } as unknown)

    expect(mockSpawn).toHaveBeenCalledWith(
      '/local/sfw',
      expect.any(Array),
      expect.objectContaining({ stdio: 'pipe' }),
    )
  })

  it('handles an empty args array (no inner tool)', async () => {
    mockResolveSfw.mockReturnValue({
      type: 'dlx',
      details: { name: 'sfw', version: '1.0.0' },
    })
    mockSpawnDlx.mockResolvedValue({ spawnPromise: 'p' })

    await spawnSfwDlx([], undefined, undefined)

    // applyMachineModeIfActive should NOT have been called for empty args.
    expect(mockApplyMachineModeIfActive).not.toHaveBeenCalled()
  })
})
