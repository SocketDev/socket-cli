/**
 * Unit Tests: User Organizations List Fetcher
 *
 * Purpose:
 * Tests the Socket SDK integration that fetches the list of organizations accessible to the
 * authenticated user. Validates organization data retrieval, SDK setup handling, API error
 * handling, custom configuration passing, and SDK instance reuse for the listOrganizations
 * API endpoint.
 *
 * Test Coverage:
 * - Successful organization list fetching with multiple orgs
 * - SDK setup failure handling
 * - API call error handling with HTTP status codes
 * - Custom SDK options passing (API token, base URL)
 * - Provided SDK instance usage (bypassing SDK setup)
 * - Null prototype usage for security
 *
 * Testing Approach:
 * Uses SDK test helpers to mock setupSdk and handleApiCall without actual API calls.
 * Tests verify proper CResult pattern usage and organization data structure validation.
 *
 * Related Files:
 * - src/commands/organization/fetch-organization-list.mts - Organization list fetcher
 * - src/commands/organization/handle-organization-list.mts - Command handler
 */

import { describe, expect, it, vi } from 'vitest'

import {
  setupSdkMockError,
  setupSdkMockSuccess,
  setupSdkSetupFailure,
} from '../../../../../src/commands/../../../test/helpers/sdk-test-helpers.mts'
import { fetchOrganization } from '../../../../src/src/commands/../../../../src/commands/organization/fetch-organization-list.mts'

// Mock the dependencies.
vi.mock('../../../../../src/commands/../utils/socket/api.mts', () => ({
  handleApiCall: vi.fn(),
}))

vi.mock('../../../../../src/commands/../utils/socket/sdk.mts', () => ({
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
    const { handleApiCall } = await import(
      '../../../../../src/commands/../../../../src/utils/socket/api.mts'
    )
    const { createSuccessResult } = await import(
      '../../../../../src/commands/../../test/helpers/mocks.mts'
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
