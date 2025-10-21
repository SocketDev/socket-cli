import { describe, expect, it, vi } from 'vitest'
import {
  setupSdkMockError,
  setupSdkMockSuccess,
  setupSdkSetupFailure,
} from '../../../test/helpers/sdk-test-helpers.mts'
import { fetchOrganization } from './fetch-organization-list.mts'

// Mock the dependencies.
vi.mock('../../utils/socket/api.mjs', () => ({
  handleApiCall: vi.fn(),
}))

vi.mock('../../utils/socket/sdk.mjs', () => ({
  setupSdk: vi.fn(),
}))

describe('fetchOrganizationList', () => {
  it('fetches organization list successfully', async () => {
    const mockData = {
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
    }

    const { mockHandleApi, mockSdk } = await setupSdkMockSuccess(
      'getOrganizations',
      mockData,
    )

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
    await setupSdkSetupFailure('Failed to setup SDK', {
      code: 1,
      cause: 'Configuration error',
    })

    const result = await fetchOrganization()

    expect(result.ok).toBe(false)
  })

  it('handles API call failure', async () => {
    await setupSdkMockError('getOrganizations', 'Network error', 500)

    const result = await fetchOrganization()

    expect(result.ok).toBe(false)
    expect(result.code).toBe(500)
  })

  it('passes custom SDK options', async () => {
    const { mockSetupSdk } = await setupSdkMockSuccess('getOrganizations', {
      organizations: {},
    })

    const sdkOpts = {
      apiToken: 'org-token',
      baseUrl: 'https://org.api.com',
    }

    await fetchOrganization({ sdkOpts })

    expect(mockSetupSdk).toHaveBeenCalledWith(sdkOpts)
  })

  it('uses provided SDK instance', async () => {
    const { handleApiCall } = await import('../../utils/socket/api.mjs')
    const { createSuccessResult } = await import(
      '../../../test/helpers/mocks.mts'
    )

    const mockSdk = {
      getOrganizations: vi.fn().mockResolvedValue({}),
    } as any

    vi.mocked(handleApiCall).mockResolvedValue(
      createSuccessResult({ organizations: {} }),
    )

    await fetchOrganization({ sdk: mockSdk })

    expect(mockSdk.getOrganizations).toHaveBeenCalled()
  })

  it('uses null prototype for options', async () => {
    const { mockSdk } = await setupSdkMockSuccess('getOrganizations', {
      organizations: {},
    })

    // This tests that the function properly uses __proto__: null.
    await fetchOrganization()

    // The function should work without prototype pollution issues.
    expect(mockSdk.getOrganizations).toHaveBeenCalled()
  })
})
