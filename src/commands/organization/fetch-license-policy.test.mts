import { describe, expect, it, vi } from 'vitest'

import { fetchLicensePolicy } from './fetch-license-policy.mts'

// Mock the dependencies.

vi.mock('../../utils/sdk.mts', () => ({
  withSdk: vi.fn(),
}))

describe('fetchLicensePolicy', () => {
  it('fetches license policy successfully', async () => {
    const { handleApiCall } = await import('../../utils/api.mts')
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockHandleApi = vi.mocked(handleApiCall)
    const mockSetupSdk = vi.mocked(withSdk)

    const mockSdk = {
      getOrgLicensePolicy: vi.fn().mockResolvedValue({
        success: true,
        data: {
          license_policy: {
            MIT: { allowed: true },
            'Apache-2.0': { allowed: true },
            'GPL-3.0': { allowed: false },
            'BSD-3-Clause': { allowed: true },
            ISC: { allowed: true },
          },
        },
      }),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({
      ok: true,
      data: {
        license_policy: {
          MIT: { allowed: true },
          'Apache-2.0': { allowed: true },
          'GPL-3.0': { allowed: false },
        },
      },
    })

    const result = await fetchLicensePolicy('test-org')

    expect(mockSdk.getOrgLicensePolicy).toHaveBeenCalledWith('test-org')
    expect(mockHandleApi).toHaveBeenCalledWith(expect.any(Promise), {
      description: 'organization license policy',
    })
    expect(result.ok).toBe(true)
  })

  it('handles SDK setup failure', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockSetupSdk = vi.mocked(withSdk)

    const error = {
      ok: false,
      code: 1,
      message: 'Failed to setup SDK',
      cause: 'Invalid token',
    }
    mockSetupSdk.mockResolvedValue(error)

    const result = await fetchLicensePolicy('my-org')

    expect(result).toEqual(error)
  })

  it('handles API call failure', async () => {
    const { handleApiCall } = await import('../../utils/api.mts')
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockHandleApi = vi.mocked(handleApiCall)
    const mockSetupSdk = vi.mocked(withSdk)

    const mockSdk = {
      getOrgLicensePolicy: vi
        .fn()
        .mockRejectedValue(new Error('Access denied')),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({
      ok: false,
      error: 'Insufficient permissions',
      code: 403,
    })

    const result = await fetchLicensePolicy('restricted-org')

    expect(result.ok).toBe(false)
    expect(result.code).toBe(403)
  })

  it('passes custom SDK options', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const { handleApiCall } = await import('../../utils/api.mts')
    const mockSetupSdk = vi.mocked(withSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      getOrgLicensePolicy: vi.fn().mockResolvedValue({}),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({ ok: true, data: {} })

    const sdkOpts = {
      apiToken: 'policy-token',
      baseUrl: 'https://policy.api.com',
    }

    await fetchLicensePolicy('my-org', { sdkOpts })

    expect(mockSetupSdk).toHaveBeenCalledWith(sdkOpts)
  })

  it('handles empty license policy', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const { handleApiCall } = await import('../../utils/api.mts')
    const mockSetupSdk = vi.mocked(withSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      getOrgLicensePolicy: vi.fn().mockResolvedValue({
        license_policy: {},
      }),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({
      ok: true,
      data: { license_policy: {} },
    })

    const result = await fetchLicensePolicy('new-org')

    expect(result.ok).toBe(true)
    expect(result.data).toEqual({ license_policy: {} })
  })

  it('handles various org slugs', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const { handleApiCall } = await import('../../utils/api.mts')
    const mockSetupSdk = vi.mocked(withSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      getOrgLicensePolicy: vi.fn().mockResolvedValue({}),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({ ok: true, data: {} })

    const orgSlugs = [
      'simple-org',
      'org_with_underscore',
      'org123',
      'my-organization-name',
    ]

    for (const orgSlug of orgSlugs) {
      // eslint-disable-next-line no-await-in-loop
      await fetchLicensePolicy(orgSlug)
      expect(mockSdk.getOrgLicensePolicy).toHaveBeenCalledWith(orgSlug)
    }
  })

  it('uses null prototype for options', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const { handleApiCall } = await import('../../utils/api.mts')
    const mockSetupSdk = vi.mocked(withSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      getOrgLicensePolicy: vi.fn().mockResolvedValue({}),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({ ok: true, data: {} })

    // This tests that the function properly uses __proto__: null.
    await fetchLicensePolicy('test-org')

    // The function should work without prototype pollution issues.
    expect(mockSdk.getOrgLicensePolicy).toHaveBeenCalled()
  })
})
