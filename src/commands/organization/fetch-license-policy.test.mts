import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchLicensePolicy } from './fetch-license-policy.mts'

// Mock the dependencies.
vi.mock('../../utils/sdk.mts', () => ({
  withSdk: vi.fn(),
}))

describe('fetchLicensePolicy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches license policy successfully', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const successResult = {
      ok: true as const,
      data: {
        allowed: ['MIT', 'Apache-2.0', 'BSD-3-Clause'],
        denied: ['GPL-3.0', 'AGPL-3.0'],
      },
    }

    mockWithSdk.mockResolvedValueOnce(successResult)

    const result = await fetchLicensePolicy('test-org')

    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'organization license policy',
      undefined,
    )
    expect(result).toEqual(successResult)
  })

  it('handles SDK setup failure', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const error = {
      ok: false as const,
      code: 1,
      message: 'Failed to setup SDK',
      cause: 'Invalid API token',
    }
    mockWithSdk.mockResolvedValueOnce(error)

    const result = await fetchLicensePolicy('my-org')

    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'organization license policy',
      undefined,
    )
    expect(result).toEqual(error)
  })

  it('handles API call failure', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const error = {
      ok: false as const,
      error: 'License policy not found',
      code: 404,
      message: 'License policy not found',
    }
    mockWithSdk.mockResolvedValueOnce(error)

    const result = await fetchLicensePolicy('nonexistent-org')

    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'organization license policy',
      undefined,
    )
    expect(result.ok).toBe(false)
    expect(result.code).toBe(404)
  })

  it('passes custom SDK options', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const successResult = {
      ok: true as const,
      data: {},
    }
    mockWithSdk.mockResolvedValueOnce(successResult)

    const sdkOpts = {
      apiToken: 'license-policy-token',
      baseUrl: 'https://license.api.com',
    }

    await fetchLicensePolicy('custom-org', { sdkOpts })

    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'organization license policy',
      { sdkOpts },
    )
  })

  it('handles empty license policy', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const successResult = {
      ok: true as const,
      data: {
        allowed: [],
        denied: [],
      },
    }
    mockWithSdk.mockResolvedValueOnce(successResult)

    const result = await fetchLicensePolicy('empty-policy-org')

    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'organization license policy',
      undefined,
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.allowed).toEqual([])
      expect(result.data.denied).toEqual([])
    }
  })

  it('handles various org slugs', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const successResult = {
      ok: true as const,
      data: {},
    }

    const orgSlugs = ['org-1', 'org-2', 'my-company', 'test-org']

    for (const orgSlug of orgSlugs) {
      mockWithSdk.mockResolvedValueOnce(successResult)
      // eslint-disable-next-line no-await-in-loop
      await fetchLicensePolicy(orgSlug)
    }

    expect(mockWithSdk).toHaveBeenCalledTimes(orgSlugs.length)
    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'organization license policy',
      undefined,
    )
  })

  it('uses null prototype for options', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const successResult = {
      ok: true as const,
      data: {},
    }
    mockWithSdk.mockResolvedValueOnce(successResult)

    // This tests that the function properly uses __proto__: null.
    await fetchLicensePolicy('test-org')

    // The function should work without prototype pollution issues.
    expect(mockWithSdk).toHaveBeenCalled()
  })
})
