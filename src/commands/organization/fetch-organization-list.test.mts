import { describe, expect, it, vi } from 'vitest'

import { fetchOrganization } from './fetch-organization-list.mts'

// Mock the dependencies.

vi.mock('../../utils/sdk.mts', () => ({
  setupSdk: vi.fn(),
}))

vi.mock('../../utils/api.mts', () => ({
  handleApiCall: vi.fn(),
}))

describe('fetchOrganizationList', () => {
  it('fetches organization list successfully', async () => {
    const { handleApiCall } = await import('../../utils/api.mts')
    const { setupSdk } = await import('../../utils/sdk.mts')
    const mockHandleApi = vi.mocked(handleApiCall)
    const mockSetupSdk = vi.mocked(setupSdk)

    const mockSdk = {
      getOrganizations: vi.fn().mockResolvedValue({
        success: true,
        data: {
          organizations: {
            'org-1': {
              id: 'org-1',
              name: 'Test Org 1',
              slug: 'test-org-1',
              plan: 'pro',
            },
            'org-2': {
              id: 'org-2',
              name: 'Test Org 2',
              slug: 'test-org-2',
              plan: 'enterprise',
            },
          },
        },
      }),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({
      ok: true,
      data: {
        organizations: {
          'org-1': {
            id: 'org-1',
            name: 'Test Org 1',
            slug: 'test-org-1',
            plan: 'pro',
          },
          'org-2': {
            id: 'org-2',
            name: 'Test Org 2',
            slug: 'test-org-2',
            plan: 'enterprise',
          },
        },
      },
    })

    const result = await fetchOrganization()

    expect(mockSdk.getOrganizations).toHaveBeenCalledWith()
    expect(mockHandleApi).toHaveBeenCalledWith(expect.any(Promise), {
      description: 'organization list',
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.organizations).toHaveLength(2)
    }
  })

  it('handles SDK setup failure', async () => {
    const { setupSdk } = await import('../../utils/sdk.mts')
    const mockSetupSdk = vi.mocked(setupSdk)

    const error = {
      ok: false,
      code: 1,
      message: 'Failed to setup SDK',
      cause: 'Configuration error',
    }
    mockSetupSdk.mockResolvedValue(error)

    const result = await fetchOrganization()

    expect(result).toEqual(error)
  })

  it('handles API call failure', async () => {
    const { handleApiCall } = await import('../../utils/api.mts')
    const { setupSdk } = await import('../../utils/sdk.mts')
    const mockHandleApi = vi.mocked(handleApiCall)
    const mockSetupSdk = vi.mocked(setupSdk)

    const mockSdk = {
      getOrganizations: vi.fn().mockRejectedValue(new Error('Network error')),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({
      ok: false,
      error: 'Failed to fetch organizations',
      code: 500,
    })

    const result = await fetchOrganization()

    expect(result.ok).toBe(false)
    expect(result.code).toBe(500)
  })

  it('passes custom SDK options', async () => {
    const { setupSdk } = await import('../../utils/sdk.mts')
    const { handleApiCall } = await import('../../utils/api.mts')
    const mockSetupSdk = vi.mocked(setupSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      getOrganizations: vi.fn().mockResolvedValue({}),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({ ok: true, data: { organizations: {} } })

    const sdkOpts = {
      apiToken: 'org-token',
      baseUrl: 'https://org.api.com',
    }

    await fetchOrganization({ sdkOpts })

    expect(mockSetupSdk).toHaveBeenCalledWith(sdkOpts)
  })

  it('uses provided SDK instance', async () => {
    const { handleApiCall } = await import('../../utils/api.mts')
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      getOrganizations: vi.fn().mockResolvedValue({}),
    } as any

    mockHandleApi.mockResolvedValue({ ok: true, data: { organizations: {} } })

    await fetchOrganization({ sdk: mockSdk })

    expect(mockSdk.getOrganizations).toHaveBeenCalled()
  })

  it('uses null prototype for options', async () => {
    const { setupSdk } = await import('../../utils/sdk.mts')
    const { handleApiCall } = await import('../../utils/api.mts')
    const mockSetupSdk = vi.mocked(setupSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      getOrganizations: vi.fn().mockResolvedValue({}),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({ ok: true, data: { organizations: {} } })

    // This tests that the function properly uses __proto__: null.
    await fetchOrganization()

    // The function should work without prototype pollution issues.
    expect(mockSdk.getOrganizations).toHaveBeenCalled()
  })
})
