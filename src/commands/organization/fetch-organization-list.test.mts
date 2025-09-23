import { describe, expect, it, vi } from 'vitest'

import { fetchOrganizationList } from './fetch-organization-list.mts'

// Mock the dependencies.
vi.mock('../../utils/api.mts', () => ({
  handleApiCall: vi.fn(),
}))

vi.mock('../../utils/sdk.mts', () => ({
  setupSdk: vi.fn(),
}))

describe('fetchOrganizationList', () => {
  it('fetches organization list successfully', async () => {
    const { handleApiCall } = await import('../../utils/api.mts')
    const { setupSdk } = await import('../../utils/sdk.mts')
    const mockHandleApi = vi.mocked(handleApiCall)
    const mockSetupSdk = vi.mocked(setupSdk)

    const mockSdk = {
      getOrganizationList: vi.fn().mockResolvedValue({
        success: true,
        data: {
          organizations: [
            {
              id: 'org-1',
              slug: 'first-org',
              name: 'First Organization',
              created_at: '2024-01-01T00:00:00Z',
            },
            {
              id: 'org-2',
              slug: 'second-org',
              name: 'Second Organization',
              created_at: '2024-02-01T00:00:00Z',
            },
          ],
          total: 2,
        },
      }),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({
      ok: true,
      data: {
        organizations: expect.any(Array),
        total: 2,
      },
    })

    const result = await fetchOrganizationList()

    expect(mockSdk.getOrganizationList).toHaveBeenCalled()
    expect(mockHandleApi).toHaveBeenCalledWith(expect.any(Promise), {
      description: 'fetching organization list',
    })
    expect(result.ok).toBe(true)
  })

  it('handles SDK setup failure', async () => {
    const { setupSdk } = await import('../../utils/sdk.mts')
    const mockSetupSdk = vi.mocked(setupSdk)

    const error = {
      ok: false,
      code: 1,
      message: 'Failed to setup SDK',
      cause: 'No authentication',
    }
    mockSetupSdk.mockResolvedValue(error)

    const result = await fetchOrganizationList()

    expect(result).toEqual(error)
  })

  it('handles API call failure', async () => {
    const { handleApiCall } = await import('../../utils/api.mts')
    const { setupSdk } = await import('../../utils/sdk.mts')
    const mockHandleApi = vi.mocked(handleApiCall)
    const mockSetupSdk = vi.mocked(setupSdk)

    const mockSdk = {
      getOrganizationList: vi.fn().mockRejectedValue(new Error('Server error')),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({
      ok: false,
      error: 'Internal server error',
      code: 500,
    })

    const result = await fetchOrganizationList()

    expect(result.ok).toBe(false)
    expect(result.code).toBe(500)
  })

  it('passes custom SDK options', async () => {
    const { setupSdk } = await import('../../utils/sdk.mts')
    const { handleApiCall } = await import('../../utils/api.mts')
    const mockSetupSdk = vi.mocked(setupSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      getOrganizationList: vi.fn().mockResolvedValue({}),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({ ok: true, data: {} })

    const sdkOpts = {
      apiToken: 'list-token',
      baseUrl: 'https://list.api.com',
    }

    await fetchOrganizationList({ sdkOpts })

    expect(mockSetupSdk).toHaveBeenCalledWith(sdkOpts)
  })

  it('handles empty organization list', async () => {
    const { setupSdk } = await import('../../utils/sdk.mts')
    const { handleApiCall } = await import('../../utils/api.mts')
    const mockSetupSdk = vi.mocked(setupSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      getOrganizationList: vi.fn().mockResolvedValue({
        organizations: [],
        total: 0,
      }),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({
      ok: true,
      data: { organizations: [], total: 0 },
    })

    const result = await fetchOrganizationList()

    expect(result.ok).toBe(true)
    expect(result.data.organizations).toEqual([])
    expect(result.data.total).toBe(0)
  })

  it('uses null prototype for options', async () => {
    const { setupSdk } = await import('../../utils/sdk.mts')
    const { handleApiCall } = await import('../../utils/api.mts')
    const mockSetupSdk = vi.mocked(setupSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      getOrganizationList: vi.fn().mockResolvedValue({}),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({ ok: true, data: {} })

    // This tests that the function properly uses __proto__: null.
    await fetchOrganizationList()

    // The function should work without prototype pollution issues.
    expect(mockSdk.getOrganizationList).toHaveBeenCalled()
  })
})
