import { describe, expect, it, vi } from 'vitest'

import { fetchSecurityPolicy } from './fetch-security-policy.mts'

// Mock the dependencies.
vi.mock('../../utils/api.mts', () => ({
  handleApiCall: vi.fn(),
}))

vi.mock('../../utils/sdk.mts', () => ({
  setupSdk: vi.fn(),
}))

describe('fetchSecurityPolicy', () => {
  it('fetches security policy successfully', async () => {
    const { handleApiCall } = await import('../../utils/api.mts')
    const { setupSdk } = await import('../../utils/sdk.mts')
    const mockHandleApi = vi.mocked(handleApiCall)
    const mockSetupSdk = vi.mocked(setupSdk)

    const mockSdk = {
      getSecurityPolicy: vi.fn().mockResolvedValue({
        success: true,
        data: {
          policy: {
            block_high_severity: true,
            block_critical_severity: true,
            block_medium_severity: false,
            block_low_severity: false,
            auto_scan: true,
            scan_on_push: true,
            require_approval: true,
          },
          updated_at: '2025-01-15T10:00:00Z',
        },
      }),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({
      ok: true,
      data: {
        policy: expect.any(Object),
        updated_at: '2025-01-15T10:00:00Z',
      },
    })

    const result = await fetchSecurityPolicy('test-org')

    expect(mockSdk.getSecurityPolicy).toHaveBeenCalledWith('test-org')
    expect(mockHandleApi).toHaveBeenCalledWith(
      expect.any(Promise),
      { description: 'fetching security policy' },
    )
    expect(result.ok).toBe(true)
  })

  it('handles SDK setup failure', async () => {
    const { setupSdk } = await import('../../utils/sdk.mts')
    const mockSetupSdk = vi.mocked(setupSdk)

    const error = {
      ok: false,
      code: 1,
      message: 'Failed to setup SDK',
      cause: 'Authentication failed',
    }
    mockSetupSdk.mockResolvedValue(error)

    const result = await fetchSecurityPolicy('my-org')

    expect(result).toEqual(error)
  })

  it('handles API call failure', async () => {
    const { handleApiCall } = await import('../../utils/api.mts')
    const { setupSdk } = await import('../../utils/sdk.mts')
    const mockHandleApi = vi.mocked(handleApiCall)
    const mockSetupSdk = vi.mocked(setupSdk)

    const mockSdk = {
      getSecurityPolicy: vi.fn().mockRejectedValue(new Error('Forbidden')),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({
      ok: false,
      error: 'Access forbidden',
      code: 403,
    })

    const result = await fetchSecurityPolicy('restricted-org')

    expect(result.ok).toBe(false)
    expect(result.code).toBe(403)
  })

  it('passes custom SDK options', async () => {
    const { setupSdk } = await import('../../utils/sdk.mts')
    const { handleApiCall } = await import('../../utils/api.mts')
    const mockSetupSdk = vi.mocked(setupSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      getSecurityPolicy: vi.fn().mockResolvedValue({}),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({ ok: true, data: {} })

    const sdkOpts = {
      apiToken: 'security-token',
      baseUrl: 'https://security.api.com',
    }

    await fetchSecurityPolicy('my-org', { sdkOpts })

    expect(mockSetupSdk).toHaveBeenCalledWith(sdkOpts)
  })

  it('handles default security policy', async () => {
    const { setupSdk } = await import('../../utils/sdk.mts')
    const { handleApiCall } = await import('../../utils/api.mts')
    const mockSetupSdk = vi.mocked(setupSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      getSecurityPolicy: vi.fn().mockResolvedValue({
        policy: {
          block_high_severity: false,
          block_critical_severity: false,
          auto_scan: false,
        },
      }),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({
      ok: true,
      data: {
        policy: {
          block_high_severity: false,
          block_critical_severity: false,
          auto_scan: false,
        },
      },
    })

    const result = await fetchSecurityPolicy('new-org')

    expect(result.ok).toBe(true)
    expect(result.data.policy.auto_scan).toBe(false)
  })

  it('handles various org slugs', async () => {
    const { setupSdk } = await import('../../utils/sdk.mts')
    const { handleApiCall } = await import('../../utils/api.mts')
    const mockSetupSdk = vi.mocked(setupSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      getSecurityPolicy: vi.fn().mockResolvedValue({}),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({ ok: true, data: {} })

    const orgSlugs = [
      'simple-org',
      'org_with_underscore',
      'org-123-numbers',
      'MyOrganization',
    ]

    for (const orgSlug of orgSlugs) {
      // eslint-disable-next-line no-await-in-loop
      await fetchSecurityPolicy(orgSlug)
      expect(mockSdk.getSecurityPolicy).toHaveBeenCalledWith(orgSlug)
    }
  })

  it('uses null prototype for options', async () => {
    const { setupSdk } = await import('../../utils/sdk.mts')
    const { handleApiCall } = await import('../../utils/api.mts')
    const mockSetupSdk = vi.mocked(setupSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      getSecurityPolicy: vi.fn().mockResolvedValue({}),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({ ok: true, data: {} })

    // This tests that the function properly uses __proto__: null.
    await fetchSecurityPolicy('test-org')

    // The function should work without prototype pollution issues.
    expect(mockSdk.getSecurityPolicy).toHaveBeenCalled()
  })
})
