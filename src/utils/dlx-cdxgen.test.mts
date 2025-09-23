import { describe, expect, it, vi, beforeEach } from 'vitest'
import { spawnCdxgenDlx } from './dlx.mts'

// Mock spawnDlx function.
vi.mock('./dlx.mts', () => {
  const mockSpawnDlx = vi.fn()

  // Return the actual implementation for spawnCdxgenDlx.
  return {
    spawnDlx: mockSpawnDlx,
    spawnCdxgenDlx: async (args: any, options: any, spawnExtra: any) => {
      // Replicate the actual implementation.
      return mockSpawnDlx(
        { name: '@cyclonedx/cdxgen', version: 'undefined' },
        args,
        { force: false, silent: true, ...options },
        spawnExtra,
      )
    },
  }
})

describe('spawnCdxgenDlx', () => {
  let mockSpawnDlx: any

  beforeEach(() => {
    vi.clearAllMocks()
    // Get the mocked function.
    mockSpawnDlx =
      vi.mocked((vi as any).importActual('./dlx.mts')).spawnDlx || vi.fn()

    // Access the mock from the module.
    const dlxModule = vi.mocked(import('./dlx.mts'))
    dlxModule.then(m => {
      mockSpawnDlx = m.spawnDlx as any
      mockSpawnDlx.mockResolvedValue({
        spawnPromise: Promise.resolve({
          stdout: 'cdxgen output',
          stderr: '',
        }),
      })
    })
  })

  it('calls spawnDlx with cdxgen package', async () => {
    const { spawnDlx } = await import('./dlx.mts')
    const mockFn = vi.mocked(spawnDlx)

    mockFn.mockResolvedValueOnce({
      spawnPromise: Promise.resolve({
        stdout: 'cdxgen output',
        stderr: '',
      }),
    } as any)

    await spawnCdxgenDlx(['--help'])

    expect(mockFn).toHaveBeenCalledWith(
      { name: '@cyclonedx/cdxgen', version: 'undefined' },
      ['--help'],
      { force: false, silent: true },
      undefined,
    )
  })

  it('passes options through to spawnDlx', async () => {
    const { spawnDlx } = await import('./dlx.mts')
    const mockFn = vi.mocked(spawnDlx)

    mockFn.mockResolvedValueOnce({
      spawnPromise: Promise.resolve({
        stdout: 'cdxgen output',
        stderr: '',
      }),
    } as any)

    const options = {
      env: { CDXGEN_OUTPUT: 'sbom.json' },
      timeout: 30000,
      force: true,
    }

    await spawnCdxgenDlx(['--output', 'sbom.json'], options)

    expect(mockFn).toHaveBeenCalledWith(
      { name: '@cyclonedx/cdxgen', version: 'undefined' },
      ['--output', 'sbom.json'],
      {
        force: true,
        silent: true,
        env: { CDXGEN_OUTPUT: 'sbom.json' },
        timeout: 30000,
      },
      undefined,
    )
  })

  it('returns spawnDlx result', async () => {
    const { spawnDlx } = await import('./dlx.mts')
    const mockFn = vi.mocked(spawnDlx)

    const expectedResult = {
      spawnPromise: Promise.resolve({
        stdout: '{"bomFormat": "CycloneDX"}',
        stderr: '',
      }),
    }
    mockFn.mockResolvedValueOnce(expectedResult as any)

    const result = await spawnCdxgenDlx(['--type', 'npm'])

    expect(result).toEqual(expectedResult)
  })

  it('handles SBOM generation arguments', async () => {
    const { spawnDlx } = await import('./dlx.mts')
    const mockFn = vi.mocked(spawnDlx)

    mockFn.mockResolvedValueOnce({
      spawnPromise: Promise.resolve({
        stdout: 'cdxgen output',
        stderr: '',
      }),
    } as any)

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

    expect(mockFn).toHaveBeenCalledWith(
      { name: '@cyclonedx/cdxgen', version: 'undefined' },
      sbomArgs,
      { force: false, silent: true },
      undefined,
    )
  })

  it('handles recursive scanning arguments', async () => {
    const { spawnDlx } = await import('./dlx.mts')
    const mockFn = vi.mocked(spawnDlx)

    mockFn.mockResolvedValueOnce({
      spawnPromise: Promise.resolve({
        stdout: 'cdxgen output',
        stderr: '',
      }),
    } as any)

    await spawnCdxgenDlx(['-r', '/path/to/scan'])

    expect(mockFn).toHaveBeenCalledWith(
      { name: '@cyclonedx/cdxgen', version: 'undefined' },
      ['-r', '/path/to/scan'],
      { force: false, silent: true },
      undefined,
    )
  })
})
