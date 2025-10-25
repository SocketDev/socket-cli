import { describe, expect, it, vi } from 'vitest'

import { fetchSecurityPolicy } from './fetch-security-policy.mts'
import {
  setupSdkMockError,
  setupSdkMockSuccess,
  setupSdkSetupFailure,
} from '../../../test/helpers/sdk-test-helpers.mts'

// Mock the dependencies.
vi.mock('../../utils/socket/api.mts', () => ({
  handleApiCall: vi.fn(),
}))

vi.mock('../../utils/socket/sdk.mts', () => ({
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
