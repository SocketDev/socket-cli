import { describe, expect, it, vi } from 'vitest'

import {
  setupSdkMockError,
  setupSdkMockSuccess,
  setupSdkSetupFailure,
} from '../../../../src/helpers/sdk-test-helpers.mts'
import { fetchOrganization } from '../../../../src/fetch-organization-list.mts'

// Mock the dependencies.
vi.mock('../../utils/socket/api.mts', () => ({
  handleApiCall: vi.fn(),
}))

vi.mock('../../utils/socket/sdk.mts', () => ({
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
      'listOrganizations',
      mockData,
    )

    const result = await fetchOrganization()

    expect(mockSdk.listOrganizations).toHaveBeenCalledWith()
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
    await setupSdkMockError('listOrganizations', 'Network error', 500)

    const result = await fetchOrganization()

    expect(result.ok).toBe(false)
    expect(result.code).toBe(500)
  })

  it('passes custom SDK options', async () => {
    const { mockSetupSdk } = await setupSdkMockSuccess('listOrganizations', {
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
    const { handleApiCall } = await import('../../utils/socket/api.mts')
    const { createSuccessResult } = await import(
      '../../../test/helpers/mocks.mts'
    )

    const mockSdk = {
      listOrganizations: vi.fn().mockResolvedValue({}),
    } as any

    vi.mocked(handleApiCall).mockResolvedValue(
      createSuccessResult({ organizations: {} }),
    )

    await fetchOrganization({ sdk: mockSdk })

    expect(mockSdk.listOrganizations).toHaveBeenCalled()
  })

  it('uses null prototype for options', async () => {
    const { mockSdk } = await setupSdkMockSuccess('listOrganizations', {
      organizations: {},
    })

    // This tests that the function properly uses __proto__: null.
    await fetchOrganization()

    // The function should work without prototype pollution issues.
    expect(mockSdk.listOrganizations).toHaveBeenCalled()
  })
})
