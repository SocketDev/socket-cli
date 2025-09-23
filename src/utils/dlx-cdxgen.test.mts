import { describe, expect, it, vi, beforeEach } from 'vitest'

import { spawnCdxgenDlx } from './dlx.mts'

// Setup base mocks.
vi.mock('./dlx.mts', async importOriginal => {
  const actual = await importOriginal<typeof import('./dlx.mts')>()
  return {
    ...actual,
    spawnDlx: vi.fn().mockResolvedValue({
      stdout: 'cdxgen output',
      stderr: '',
    }),
  }
})

describe('spawnCdxgenDlx', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls spawnDlx with cdxgen package', async () => {
    const { spawnDlx } = vi.mocked(await import('./dlx.mts'))

    await spawnCdxgenDlx(['--help'])

    expect(spawnDlx).toHaveBeenCalledWith(
      { name: '@cyclonedx/cdxgen' },
      ['--help'],
      undefined,
    )
  })

  it('passes options through to spawnDlx', async () => {
    const { spawnDlx } = vi.mocked(await import('./dlx.mts'))

    const options = {
      env: { CDXGEN_OUTPUT: 'sbom.json' },
      timeout: 30000,
      force: true,
    }

    await spawnCdxgenDlx(['--output', 'sbom.json'], options)

    expect(spawnDlx).toHaveBeenCalledWith(
      { name: '@cyclonedx/cdxgen' },
      ['--output', 'sbom.json'],
      options,
    )
  })

  it('returns spawnDlx result', async () => {
    const { spawnDlx } = vi.mocked(await import('./dlx.mts'))
    const expectedResult = {
      stdout: '{"bomFormat": "CycloneDX"}',
      stderr: '',
    }
    spawnDlx.mockResolvedValue(expectedResult as any)

    const result = await spawnCdxgenDlx(['--type', 'npm'])

    expect(result).toEqual(expectedResult)
  })

  it('handles SBOM generation arguments', async () => {
    const { spawnDlx } = vi.mocked(await import('./dlx.mts'))

    const sbomArgs = [
      '--type',
      'npm',
      '--output',
      '/tmp/sbom.json',
      '--spec-version',
      '1.4',
      '--project-name',
      'test-project',
    ]

    await spawnCdxgenDlx(sbomArgs)

    expect(spawnDlx).toHaveBeenCalledWith(
      { name: '@cyclonedx/cdxgen' },
      sbomArgs,
      undefined,
    )
  })

  it('handles recursive scanning arguments', async () => {
    const { spawnDlx } = vi.mocked(await import('./dlx.mts'))

    await spawnCdxgenDlx(['-r', '/path/to/scan'])

    expect(spawnDlx).toHaveBeenCalledWith(
      { name: '@cyclonedx/cdxgen' },
      ['-r', '/path/to/scan'],
      undefined,
    )
  })
})
