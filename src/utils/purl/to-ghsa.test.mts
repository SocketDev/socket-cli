import { describe, expect, it, vi } from 'vitest'

import { convertPurlToGhsas } from './to-ghsa.mts'

// Mock the dependencies.
vi.mock('./github.mts', () => ({
  cacheFetch: vi.fn(),
  getOctokit: vi.fn(),
}))

vi.mock('./purl.mts', () => ({
  getPurlObject: vi.fn(),
}))

vi.mock('./errors.mts', () => ({
  getErrorCause: vi.fn(e => e?.message || String(e)),
}))

describe('convertPurlToGhsas', () => {
  it('returns error for invalid PURL format', async () => {
    const { getPurlObject } = await import('./purl.mts')
    const mockGetPurl = vi.mocked(getPurlObject)

    mockGetPurl.mockReturnValue(null)

    const result = await convertPurlToGhsas('invalid-purl')

    expect(result).toEqual({
      ok: false,
      message: 'Invalid PURL format: invalid-purl',
    })
  })

  it('returns error for unsupported ecosystem', async () => {
    const { getPurlObject } = await import('./purl.mts')
    const mockGetPurl = vi.mocked(getPurlObject)

    mockGetPurl.mockReturnValue({
      name: 'some-package',
      type: 'unsupported-ecosystem',
      version: '1.0.0',
    } as any)

    const result = await convertPurlToGhsas(
      'pkg:unsupported/some-package@1.0.0',
    )

    expect(result).toEqual({
      ok: false,
      message: 'Unsupported PURL ecosystem: unsupported-ecosystem',
    })
  })

  it('converts npm PURL to GHSA IDs', async () => {
    const { getPurlObject } = await import('./purl.mts')
    const { cacheFetch, getOctokit } = await import('./github.mts')
    const mockGetPurl = vi.mocked(getPurlObject)
    const mockCacheFetch = vi.mocked(cacheFetch)
    const mockGetOctokit = vi.mocked(getOctokit)

    mockGetPurl.mockReturnValue({
      name: 'lodash',
      type: 'npm',
      version: '4.17.20',
    } as any)

    const mockOctokit = {
      rest: {
        securityAdvisories: {
          listGlobalAdvisories: vi.fn(),
        },
      },
    }
    mockGetOctokit.mockReturnValue(mockOctokit as any)

    mockCacheFetch.mockImplementation(async (key, fn) => {
      return {
        data: [
          { ghsa_id: 'GHSA-1234-5678-9abc' },
          { ghsa_id: 'GHSA-abcd-efgh-ijkl' },
        ],
      }
    })

    const result = await convertPurlToGhsas('pkg:npm/lodash@4.17.20')

    expect(result).toEqual({
      ok: true,
      data: ['GHSA-1234-5678-9abc', 'GHSA-abcd-efgh-ijkl'],
    })
    expect(mockCacheFetch).toHaveBeenCalledWith(
      'purl-to-ghsa-npm-lodash-4.17.20',
      expect.any(Function),
    )
  })

  it('converts pypi PURL to pip ecosystem', async () => {
    const { getPurlObject } = await import('./purl.mts')
    const { cacheFetch, getOctokit } = await import('./github.mts')
    const mockGetPurl = vi.mocked(getPurlObject)
    const mockCacheFetch = vi.mocked(cacheFetch)
    const mockGetOctokit = vi.mocked(getOctokit)

    mockGetPurl.mockReturnValue({
      name: 'requests',
      type: 'pypi',
      version: '2.31.0',
    } as any)

    const mockOctokit = {
      rest: {
        securityAdvisories: {
          listGlobalAdvisories: vi.fn(),
        },
      },
    }
    mockGetOctokit.mockReturnValue(mockOctokit as any)

    mockCacheFetch.mockImplementation(async (key, fn) => {
      // Call the function to verify correct parameters.
      await fn()
      return { data: [] }
    })

    await convertPurlToGhsas('pkg:pypi/requests@2.31.0')

    expect(
      mockOctokit.rest.securityAdvisories.listGlobalAdvisories,
    ).toHaveBeenCalledWith({
      ecosystem: 'pip',
      affects: 'requests@2.31.0',
    })
  })

  it('handles PURL without version', async () => {
    const { getPurlObject } = await import('./purl.mts')
    const { cacheFetch, getOctokit } = await import('./github.mts')
    const mockGetPurl = vi.mocked(getPurlObject)
    const mockCacheFetch = vi.mocked(cacheFetch)
    const mockGetOctokit = vi.mocked(getOctokit)

    mockGetPurl.mockReturnValue({
      name: 'express',
      type: 'npm',
      version: undefined,
    } as any)

    const mockOctokit = {
      rest: {
        securityAdvisories: {
          listGlobalAdvisories: vi.fn(),
        },
      },
    }
    mockGetOctokit.mockReturnValue(mockOctokit as any)

    mockCacheFetch.mockImplementation(async (key, fn) => {
      await fn()
      return { data: [] }
    })

    await convertPurlToGhsas('pkg:npm/express')

    expect(
      mockOctokit.rest.securityAdvisories.listGlobalAdvisories,
    ).toHaveBeenCalledWith({
      ecosystem: 'npm',
      affects: 'express',
    })
    expect(mockCacheFetch).toHaveBeenCalledWith(
      'purl-to-ghsa-npm-express-latest',
      expect.any(Function),
    )
  })

  it('maps cargo to rust ecosystem', async () => {
    const { getPurlObject } = await import('./purl.mts')
    const { cacheFetch, getOctokit } = await import('./github.mts')
    const mockGetPurl = vi.mocked(getPurlObject)
    const mockCacheFetch = vi.mocked(cacheFetch)
    const mockGetOctokit = vi.mocked(getOctokit)

    mockGetPurl.mockReturnValue({
      name: 'tokio',
      type: 'cargo',
      version: '1.0.0',
    } as any)

    const mockOctokit = {
      rest: {
        securityAdvisories: {
          listGlobalAdvisories: vi.fn(),
        },
      },
    }
    mockGetOctokit.mockReturnValue(mockOctokit as any)

    mockCacheFetch.mockImplementation(async (key, fn) => {
      await fn()
      return { data: [] }
    })

    await convertPurlToGhsas('pkg:cargo/tokio@1.0.0')

    expect(
      mockOctokit.rest.securityAdvisories.listGlobalAdvisories,
    ).toHaveBeenCalledWith({
      ecosystem: 'rust',
      affects: 'tokio@1.0.0',
    })
  })

  it('maps gem to rubygems ecosystem', async () => {
    const { getPurlObject } = await import('./purl.mts')
    const { cacheFetch, getOctokit } = await import('./github.mts')
    const mockGetPurl = vi.mocked(getPurlObject)
    const mockCacheFetch = vi.mocked(cacheFetch)
    const mockGetOctokit = vi.mocked(getOctokit)

    mockGetPurl.mockReturnValue({
      name: 'rails',
      type: 'gem',
      version: '7.0.0',
    } as any)

    const mockOctokit = {
      rest: {
        securityAdvisories: {
          listGlobalAdvisories: vi.fn(),
        },
      },
    }
    mockGetOctokit.mockReturnValue(mockOctokit as any)

    mockCacheFetch.mockImplementation(async (key, fn) => {
      await fn()
      return { data: [] }
    })

    await convertPurlToGhsas('pkg:gem/rails@7.0.0')

    expect(
      mockOctokit.rest.securityAdvisories.listGlobalAdvisories,
    ).toHaveBeenCalledWith({
      ecosystem: 'rubygems',
      affects: 'rails@7.0.0',
    })
  })

  it('handles API errors gracefully', async () => {
    const { getPurlObject } = await import('./purl.mts')
    const { cacheFetch, getOctokit } = await import('./github.mts')
    const mockGetPurl = vi.mocked(getPurlObject)
    const mockCacheFetch = vi.mocked(cacheFetch)
    const mockGetOctokit = vi.mocked(getOctokit)

    mockGetPurl.mockReturnValue({
      name: 'package',
      type: 'npm',
      version: '1.0.0',
    } as any)

    mockGetOctokit.mockReturnValue({} as any)
    mockCacheFetch.mockRejectedValue(new Error('API rate limit exceeded'))

    const result = await convertPurlToGhsas('pkg:npm/package@1.0.0')

    expect(result).toEqual({
      ok: false,
      message: 'Failed to convert PURL to GHSA: API rate limit exceeded',
    })
  })

  it('returns empty array when no advisories found', async () => {
    const { getPurlObject } = await import('./purl.mts')
    const { cacheFetch, getOctokit } = await import('./github.mts')
    const mockGetPurl = vi.mocked(getPurlObject)
    const mockCacheFetch = vi.mocked(cacheFetch)
    const mockGetOctokit = vi.mocked(getOctokit)

    mockGetPurl.mockReturnValue({
      name: 'safe-package',
      type: 'npm',
      version: '1.0.0',
    } as any)

    mockGetOctokit.mockReturnValue({} as any)
    mockCacheFetch.mockResolvedValue({ data: [] })

    const result = await convertPurlToGhsas('pkg:npm/safe-package@1.0.0')

    expect(result).toEqual({
      ok: true,
      data: [],
    })
  })

  it('supports all ecosystem mappings', async () => {
    const { getPurlObject } = await import('./purl.mts')
    const { cacheFetch, getOctokit } = await import('./github.mts')
    const mockGetPurl = vi.mocked(getPurlObject)
    const mockCacheFetch = vi.mocked(cacheFetch)
    const mockGetOctokit = vi.mocked(getOctokit)

    const ecosystemMappings = [
      { purl: 'golang', github: 'go' },
      { purl: 'maven', github: 'maven' },
      { purl: 'nuget', github: 'nuget' },
      { purl: 'composer', github: 'composer' },
      { purl: 'swift', github: 'swift' },
    ]

    const mockOctokit = {
      rest: {
        securityAdvisories: {
          listGlobalAdvisories: vi.fn(),
        },
      },
    }
    mockGetOctokit.mockReturnValue(mockOctokit as any)
    mockCacheFetch.mockImplementation(async (key, fn) => {
      await fn()
      return { data: [] }
    })

    for (const { github, purl } of ecosystemMappings) {
      mockGetPurl.mockReturnValue({
        name: 'test-package',
        type: purl,
        version: '1.0.0',
      } as any)

      // eslint-disable-next-line no-await-in-loop
      await convertPurlToGhsas(`pkg:${purl}/test-package@1.0.0`)

      expect(
        mockOctokit.rest.securityAdvisories.listGlobalAdvisories,
      ).toHaveBeenCalledWith({
        ecosystem: github,
        affects: 'test-package@1.0.0',
      })
    }
  })
})
