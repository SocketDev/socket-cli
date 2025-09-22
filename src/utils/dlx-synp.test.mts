import { describe, expect, it, vi, beforeEach } from 'vitest'

import { spawnSynpDlx } from './dlx.mts'

// Setup base mocks.
vi.mock('./dlx.mts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./dlx.mts')>()
  return {
    ...actual,
    spawnDlx: vi.fn().mockResolvedValue({
      stdout: 'synp output',
      stderr: '',
    }),
  }
})

describe('spawnSynpDlx', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls spawnDlx with synp package', async () => {
    const { spawnDlx } = vi.mocked(await import('./dlx.mts'))

    await spawnSynpDlx(['--help'])

    expect(spawnDlx).toHaveBeenCalledWith(
      { name: 'synp' },
      ['--help'],
      undefined,
    )
  })

  it('passes options through to spawnDlx', async () => {
    const { spawnDlx } = vi.mocked(await import('./dlx.mts'))

    const options = {
      env: { NODE_ENV: 'production' },
      timeout: 15000,
    }

    await spawnSynpDlx(['--source-file', 'yarn.lock'], options)

    expect(spawnDlx).toHaveBeenCalledWith(
      { name: 'synp' },
      ['--source-file', 'yarn.lock'],
      options,
    )
  })

  it('returns spawnDlx result', async () => {
    const { spawnDlx } = vi.mocked(await import('./dlx.mts'))
    const expectedResult = {
      stdout: 'Converted yarn.lock to package-lock.json',
      stderr: '',
    }
    spawnDlx.mockResolvedValue(expectedResult as any)

    const result = await spawnSynpDlx([])

    expect(result).toEqual(expectedResult)
  })

  it('handles yarn to npm conversion arguments', async () => {
    const { spawnDlx } = vi.mocked(await import('./dlx.mts'))

    await spawnSynpDlx([
      '--source-file', 'yarn.lock',
      '--target-file', 'package-lock.json',
    ])

    expect(spawnDlx).toHaveBeenCalledWith(
      { name: 'synp' },
      ['--source-file', 'yarn.lock', '--target-file', 'package-lock.json'],
      undefined,
    )
  })

  it('handles npm to yarn conversion arguments', async () => {
    const { spawnDlx } = vi.mocked(await import('./dlx.mts'))

    await spawnSynpDlx([
      '--source-file', 'package-lock.json',
      '--target-file', 'yarn.lock',
      '--yarn-version', '1',
    ])

    expect(spawnDlx).toHaveBeenCalledWith(
      { name: 'synp' },
      ['--source-file', 'package-lock.json', '--target-file', 'yarn.lock', '--yarn-version', '1'],
      undefined,
    )
  })

  it('handles force conversion flag', async () => {
    const { spawnDlx } = vi.mocked(await import('./dlx.mts'))

    await spawnSynpDlx(['--force'], { force: true })

    expect(spawnDlx).toHaveBeenCalledWith(
      { name: 'synp' },
      ['--force'],
      { force: true },
    )
  })
})