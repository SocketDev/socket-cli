import { beforeEach, describe, expect, it, vi } from 'vitest'
import { spawnSynp } from '../../../../src/util/dlx/spawn-synp.mts'

const mockSpawnDlx = vi.hoisted(() => vi.fn())
const mockGetSynpVersion = vi.hoisted(() => vi.fn(() => '1.9.0'))

vi.mock(import('../../../../src/util/dlx/spawn.mts'), () => ({
  spawnDlx: mockSpawnDlx,
}))

vi.mock(import('../../../../src/env/synp-version.mts'), () => ({
  getSynpVersion: mockGetSynpVersion,
}))

describe('spawnSynp', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSynpVersion.mockReturnValue('1.9.0')
  })

  it('delegates to spawnDlx with the synp version pin', async () => {
    mockSpawnDlx.mockResolvedValue({ spawnPromise: 'p' })

    const result = await spawnSynp(['--source-file', 'yarn.lock'])

    expect(mockSpawnDlx).toHaveBeenCalledWith(
      { name: 'synp', version: '1.9.0' },
      ['--source-file', 'yarn.lock'],
      { force: false },
      undefined,
    )
    expect(result).toEqual({ spawnPromise: 'p' })
  })

  it('merges caller options over the default { force: false }', async () => {
    mockSpawnDlx.mockResolvedValue({ spawnPromise: 'p' })

    await spawnSynp(['arg'], { force: true })

    expect(mockSpawnDlx).toHaveBeenCalledWith(
      { name: 'synp', version: '1.9.0' },
      ['arg'],
      { force: true },
      undefined,
    )
  })

  it('forwards spawnExtra to spawnDlx', async () => {
    mockSpawnDlx.mockResolvedValue({ spawnPromise: 'p' })
    const spawnExtra = { stdioString: true }

    await spawnSynp(['arg'], undefined, spawnExtra)

    expect(mockSpawnDlx).toHaveBeenCalledWith(
      { name: 'synp', version: '1.9.0' },
      ['arg'],
      { force: false },
      spawnExtra,
    )
  })
})
