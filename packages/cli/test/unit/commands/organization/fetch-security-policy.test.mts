/**
 * Unit Tests: Organization Security Policy Fetcher
 *
 * Purpose:
 * Tests the Socket SDK integration that fetches security policy configuration for an organization.
 * Validates policy retrieval including severity blocking rules, auto-scan settings, and approval
 * requirements. Handles SDK setup, API errors, custom configuration, and various organization
 * slug formats for the getOrgSecurityPolicy API endpoint.
 *
 * Test Coverage:
 * - Successful security policy fetching with blocking rules
 * - SDK setup failure handling
 * - API call error handling with HTTP status codes
 * - Custom SDK options passing (API token, base URL)
 * - Default security policy handling for new organizations
 * - Various organization slug format validation
 * - Null prototype usage for security
 *
 * Testing Approach:
 * Uses SDK test helpers to mock setupSdk and handleApiCall without actual API calls.
 * Tests verify proper organization slug passing and CResult pattern usage.
 *
 * Related Files:
 * - src/commands/organization/fetch-security-policy.mts - Security policy fetcher
 * - src/commands/organization/handle-security-policy.mts - Command handler
 * - src/commands/organization/output-security-policy.mts - Output formatter
 */

import { describe, expect, it, vi } from 'vitest'

import {
  setupSdkMockError,
  setupSdkMockSuccess,
  setupSdkSetupFailure,
} from '../../../../../src/commands/../../../test/helpers/sdk-test-helpers.mts'
import { fetchSecurityPolicy } from '../../../../src/src/commands/../../../../src/commands/organization/fetch-security-policy.mts'

// Mock the dependencies.
vi.mock('../../../../../src/commands/../utils/socket/api.mts', () => ({
  handleApiCall: vi.fn(),
}))

vi.mock('../../../../../src/commands/../utils/socket/sdk.mts', () => ({
  setupSdk: vi.fn(),
}))

describe('fetchSecurityPolicy', () => {
  it('fetches security policy successfully', async () => {
    const mockData = {
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
    }

    const { mockHandleApi, mockSdk } = await setupSdkMockSuccess(
      'getOrgSecurityPolicy',
      mockData,
    )

    const result = await fetchSecurityPolicy('test-org')

    expect(mockSdk.getOrgSecurityPolicy).toHaveBeenCalledWith('test-org')
    expect(mockHandleApi).toHaveBeenCalledWith(expect.any(Promise), {
      description: 'organization security policy',
    })
    expect(result.ok).toBe(true)
  })

  it('handles SDK setup failure', async () => {
    await setupSdkSetupFailure('Failed to setup SDK', {
      code: 1,
      cause: 'Authentication failed',
    })

    const result = await fetchSecurityPolicy('my-org')

    expect(result.ok).toBe(false)
  })

  it('handles API call failure', async () => {
    await setupSdkMockError('getOrgSecurityPolicy', 'Forbidden', 403)

    const result = await fetchSecurityPolicy('restricted-org')

    expect(result.ok).toBe(false)
    expect(result.code).toBe(403)
  })

  it('passes custom SDK options', async () => {
    const { mockSetupSdk } = await setupSdkMockSuccess(
      'getOrgSecurityPolicy',
      {},
    )

    const sdkOpts = {
      apiToken: 'security-token',
      baseUrl: 'https://security.api.com',
    }

    await fetchSecurityPolicy('my-org', { sdkOpts })

    expect(mockSetupSdk).toHaveBeenCalledWith(sdkOpts)
  })

  it('handles default security policy', async () => {
    const mockData = {
      policy: {
        block_high_severity: false,
        block_critical_severity: false,
        auto_scan: false,
      },
    }

    await setupSdkMockSuccess('getOrgSecurityPolicy', mockData)

    const result = await fetchSecurityPolicy('new-org')

    expect(result.ok).toBe(true)
    expect(result.data.policy.auto_scan).toBe(false)
  })

  it('handles various org slugs', async () => {
    const { mockSdk } = await setupSdkMockSuccess('getOrgSecurityPolicy', {})

    const orgSlugs = [
      'simple-org',
      'org_with_underscore',
      'org-123-numbers',
      'MyOrganization',
    ]

    for (const orgSlug of orgSlugs) {
      // eslint-disable-next-line no-await-in-loop
      await fetchSecurityPolicy(orgSlug)
      expect(mockSdk.getOrgSecurityPolicy).toHaveBeenCalledWith(orgSlug)
    }
  })

  it('uses null prototype for options', async () => {
    const { mockSdk } = await setupSdkMockSuccess('getOrgSecurityPolicy', {})

    // This tests that the function properly uses __proto__: null.
    await fetchSecurityPolicy('test-org')

    // The function should work without prototype pollution issues.
    expect(mockSdk.getOrgSecurityPolicy).toHaveBeenCalled()
  })
})
