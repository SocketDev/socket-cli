import { describe, expect, it, vi, beforeEach } from 'vitest'

import { spawnCoanaDlx } from './dlx.mts'

// Setup base mocks.
vi.mock('./dlx.mts', async importOriginal => {
  const actual = await importOriginal<typeof import('./dlx.mts')>()
  return {
    ...actual,
    spawnDlx: vi.fn().mockResolvedValue({
      stdout: 'coana output',
      stderr: '',
    }),
  }
})

describe('spawnCoanaDlx', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls spawnDlx with coana package', async () => {
    const { spawnDlx } = vi.mocked(await import('./dlx.mts'))

    await spawnCoanaDlx(['analyze', '--help'])

    expect(spawnDlx).toHaveBeenCalledWith(
      { name: '@coana-tech/cli' },
      ['analyze', '--help'],
      undefined,
    )
  })

  it('passes options through to spawnDlx', async () => {
    const { spawnDlx } = vi.mocked(await import('./dlx.mts'))

    const options = {
      env: { TEST: 'true' },
      timeout: 10000,
    }

    await spawnCoanaDlx(['--version'], options)

    expect(spawnDlx).toHaveBeenCalledWith(
      { name: '@coana-tech/cli' },
      ['--version'],
      options,
    )
  })

  it('returns spawnDlx result', async () => {
    const { spawnDlx } = vi.mocked(await import('./dlx.mts'))
    const expectedResult = {
      stdout: 'coana analysis complete',
      stderr: '',
    }
    spawnDlx.mockResolvedValue(expectedResult as any)

    const result = await spawnCoanaDlx(['analyze'])

    expect(result).toEqual(expectedResult)
  })

  it('handles empty args array', async () => {
    const { spawnDlx } = vi.mocked(await import('./dlx.mts'))

    await spawnCoanaDlx([])

    expect(spawnDlx).toHaveBeenCalledWith(
      { name: '@coana-tech/cli' },
      [],
      undefined,
    )
  })

  it('handles complex command arguments', async () => {
    const { spawnDlx } = vi.mocked(await import('./dlx.mts'))

    const complexArgs = [
      'analyze',
      '--project',
      '/path/to/project',
      '--output',
      'report.json',
      '--verbose',
    ]

    await spawnCoanaDlx(complexArgs)

    expect(spawnDlx).toHaveBeenCalledWith(
      { name: '@coana-tech/cli' },
      complexArgs,
      undefined,
    )
  })
})
