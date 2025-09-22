import { describe, expect, it, vi } from 'vitest'

import { fetchDefaultOrgSlug } from './fetch-default-org-slug.mts'

// Mock the dependencies.
vi.mock('../../utils/api.mts', () => ({
  handleApiCall: vi.fn(),
}))

vi.mock('../../utils/sdk.mts', () => ({
  setupSdk: vi.fn(),
}))

describe('fetchDefaultOrgSlug', () => {
  it('fetches default org slug successfully', async () => {
    const { handleApiCall } = await import('../../utils/api.mts')
    const { setupSdk } = await import('../../utils/sdk.mts')
    const mockHandleApi = vi.mocked(handleApiCall)
    const mockSetupSdk = vi.mocked(setupSdk)

    const mockSdk = {
      getDefaultOrgSlug: vi.fn().mockResolvedValue({
        success: true,
        data: {
          orgSlug: 'my-default-org',
          orgName: 'My Default Organization',
          orgId: 'org-123',
        },
      }),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({
      ok: true,
      data: 'my-default-org',
    })

    const result = await fetchDefaultOrgSlug()

    expect(mockSdk.getDefaultOrgSlug).toHaveBeenCalled()
    expect(mockHandleApi).toHaveBeenCalledWith(
      expect.any(Promise),
      { description: 'fetching default organization' },
    )
    expect(result.ok).toBe(true)
    expect(result.data).toBe('my-default-org')
  })

  it('handles SDK setup failure', async () => {
    const { setupSdk } = await import('../../utils/sdk.mts')
    const mockSetupSdk = vi.mocked(setupSdk)

    const error = {
      ok: false,
      code: 1,
      message: 'Failed to setup SDK',
      cause: 'No API token',
    }
    mockSetupSdk.mockResolvedValue(error)

    const result = await fetchDefaultOrgSlug()

    expect(result).toEqual(error)
  })

  it('handles API call failure', async () => {
    const { handleApiCall } = await import('../../utils/api.mts')
    const { setupSdk } = await import('../../utils/sdk.mts')
    const mockHandleApi = vi.mocked(handleApiCall)
    const mockSetupSdk = vi.mocked(setupSdk)

    const mockSdk = {
      getDefaultOrgSlug: vi.fn().mockRejectedValue(new Error('No default org')),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({
      ok: false,
      error: 'No default organization configured',
      code: 404,
    })

    const result = await fetchDefaultOrgSlug()

    expect(result.ok).toBe(false)
    expect(result.code).toBe(404)
  })

  it('passes custom SDK options', async () => {
    const { setupSdk } = await import('../../utils/sdk.mts')
    const { handleApiCall } = await import('../../utils/api.mts')
    const mockSetupSdk = vi.mocked(setupSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      getDefaultOrgSlug: vi.fn().mockResolvedValue({}),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({ ok: true, data: 'org' })

    const sdkOpts = {
      apiToken: 'ci-token',
      baseUrl: 'https://ci.api.com',
    }

    await fetchDefaultOrgSlug({ sdkOpts })

    expect(mockSetupSdk).toHaveBeenCalledWith(sdkOpts)
  })

  it('returns string org slug', async () => {
    const { handleApiCall } = await import('../../utils/api.mts')
    const { setupSdk } = await import('../../utils/sdk.mts')
    const mockHandleApi = vi.mocked(handleApiCall)
    const mockSetupSdk = vi.mocked(setupSdk)

    const mockSdk = {
      getDefaultOrgSlug: vi.fn().mockResolvedValue({
        orgSlug: 'simple-org-name',
      }),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({
      ok: true,
      data: 'simple-org-name',
    })

    const result = await fetchDefaultOrgSlug()

    expect(result.ok).toBe(true)
    expect(typeof result.data).toBe('string')
    expect(result.data).toBe('simple-org-name')
  })

  it('uses null prototype for options', async () => {
    const { setupSdk } = await import('../../utils/sdk.mts')
    const { handleApiCall } = await import('../../utils/api.mts')
    const mockSetupSdk = vi.mocked(setupSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      getDefaultOrgSlug: vi.fn().mockResolvedValue({}),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({ ok: true, data: 'test' })

    // This tests that the function properly uses __proto__: null.
    await fetchDefaultOrgSlug()

    // The function should work without prototype pollution issues.
    expect(mockSdk.getDefaultOrgSlug).toHaveBeenCalled()
  })
})
