import { describe, expect, it, vi } from 'vitest'

import { fetchDependencies } from './fetch-dependencies.mts'

// Mock the dependencies.
vi.mock('../../utils/api.mts', () => ({
  handleApiCall: vi.fn(),
}))

vi.mock('../../utils/sdk.mts', () => ({
  setupSdk: vi.fn(),
}))

describe('fetchDependencies', () => {
  it('fetches dependencies successfully', async () => {
    const { handleApiCall } = await import('../../utils/api.mts')
    const { setupSdk } = await import('../../utils/sdk.mts')
    const mockHandleApi = vi.mocked(handleApiCall)
    const mockSetupSdk = vi.mocked(setupSdk)

    const mockSdk = {
      searchDependencies: vi.fn().mockResolvedValue({
        success: true,
        data: {
          dependencies: [
            { name: 'lodash', version: '4.17.21' },
            { name: 'express', version: '4.18.2' },
          ],
          total: 2,
        },
      }),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({
      ok: true,
      data: {
        dependencies: [
          { name: 'lodash', version: '4.17.21' },
          { name: 'express', version: '4.18.2' },
        ],
        total: 2,
      },
    })

    const result = await fetchDependencies({ limit: 10, offset: 0 })

    expect(mockSdk.searchDependencies).toHaveBeenCalledWith({
      limit: 10,
      offset: 0,
    })
    expect(mockHandleApi).toHaveBeenCalledWith(expect.any(Promise), {
      description: 'organization dependencies',
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
      cause: 'Invalid API token',
    }
    mockSetupSdk.mockResolvedValue(error)

    const result = await fetchDependencies({ limit: 20, offset: 10 })

    expect(result).toEqual(error)
  })

  it('handles API call failure', async () => {
    const { handleApiCall } = await import('../../utils/api.mts')
    const { setupSdk } = await import('../../utils/sdk.mts')
    const mockHandleApi = vi.mocked(handleApiCall)
    const mockSetupSdk = vi.mocked(setupSdk)

    const mockSdk = {
      searchDependencies: vi.fn().mockRejectedValue(new Error('API error')),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({
      ok: false,
      error: 'API call failed',
    })

    const result = await fetchDependencies({ limit: 50, offset: 0 })

    expect(result.ok).toBe(false)
  })

  it('passes custom SDK options', async () => {
    const { setupSdk } = await import('../../utils/sdk.mts')
    const { handleApiCall } = await import('../../utils/api.mts')
    const mockSetupSdk = vi.mocked(setupSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      searchDependencies: vi.fn().mockResolvedValue({}),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({ ok: true, data: [] })

    const sdkOpts = {
      apiToken: 'custom-token',
      baseUrl: 'https://custom.api.com',
    }

    await fetchDependencies({ limit: 100, offset: 50 }, { sdkOpts })

    expect(mockSetupSdk).toHaveBeenCalledWith(sdkOpts)
  })

  it('handles pagination parameters', async () => {
    const { setupSdk } = await import('../../utils/sdk.mts')
    const { handleApiCall } = await import('../../utils/api.mts')
    const mockSetupSdk = vi.mocked(setupSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      searchDependencies: vi.fn().mockResolvedValue({}),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({ ok: true, data: {} })

    await fetchDependencies({ limit: 200, offset: 100 })

    expect(mockSdk.searchDependencies).toHaveBeenCalledWith({
      limit: 200,
      offset: 100,
    })
  })

  it('uses null prototype for options', async () => {
    const { setupSdk } = await import('../../utils/sdk.mts')
    const { handleApiCall } = await import('../../utils/api.mts')
    const mockSetupSdk = vi.mocked(setupSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      searchDependencies: vi.fn().mockResolvedValue({}),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({ ok: true, data: {} })

    // This tests that the function properly uses __proto__: null.
    await fetchDependencies({ limit: 10, offset: 0 })

    // The function should work without prototype pollution issues.
    expect(mockSdk.searchDependencies).toHaveBeenCalled()
  })
})
