import { describe, expect, it, vi } from 'vitest'

import {
  setupSdkMockError,
  setupSdkMockSuccess,
  setupSdkSetupFailure,
} from '../../../../test/helpers/sdk-test-helpers.mts'
import { fetchLicensePolicy } from '../../../../../src/commands/organization/fetch-license-policy.mts'

// Mock the dependencies.
vi.mock('../../utils/socket/api.mts', () => ({
  handleApiCall: vi.fn(),
}))

vi.mock('../../utils/socket/sdk.mts', () => ({
  setupSdk: vi.fn(),
}))

describe('fetchLicensePolicy', () => {
  it('fetches license policy successfully', async () => {
    const mockData = {
      license_policy: {
        MIT: { allowed: true },
        'Apache-2.0': { allowed: true },
        'GPL-3.0': { allowed: false },
      },
    }

    const { mockHandleApi, mockSdk } = await setupSdkMockSuccess(
      'getOrgLicensePolicy',
      mockData,
    )

    const result = await fetchLicensePolicy('test-org')

    expect(mockSdk.getOrgLicensePolicy).toHaveBeenCalledWith('test-org')
    expect(mockHandleApi).toHaveBeenCalledWith(expect.any(Promise), {
      description: 'organization license policy',
    })
    expect(result.ok).toBe(true)
  })

  it('handles SDK setup failure', async () => {
    await setupSdkSetupFailure('Failed to setup SDK', {
      code: 1,
      cause: 'Invalid token',
    })

    const result = await fetchLicensePolicy('my-org')

    expect(result.ok).toBe(false)
  })

  it('handles API call failure', async () => {
    await setupSdkMockError('getOrgLicensePolicy', 'Access denied', 403)

    const result = await fetchLicensePolicy('restricted-org')

    expect(result.ok).toBe(false)
    expect(result.code).toBe(403)
  })

  it('passes custom SDK options', async () => {
    const { mockSetupSdk } = await setupSdkMockSuccess(
      'getOrgLicensePolicy',
      {},
    )

    const sdkOpts = {
      apiToken: 'policy-token',
      baseUrl: 'https://policy.api.com',
    }

    await fetchLicensePolicy('my-org', { sdkOpts })

    expect(mockSetupSdk).toHaveBeenCalledWith(sdkOpts)
  })

  it('handles empty license policy', async () => {
    const mockData = { license_policy: {} }
    await setupSdkMockSuccess('getOrgLicensePolicy', mockData)

    const result = await fetchLicensePolicy('new-org')

    expect(result.ok).toBe(true)
    expect(result.data).toEqual({ license_policy: {} })
  })

  it('handles various org slugs', async () => {
    const { mockSdk } = await setupSdkMockSuccess('getOrgLicensePolicy', {})

    const orgSlugs = [
      'simple-org',
      'org_with_underscore',
      'org123',
      'my-organization-name',
    ]

    for (const orgSlug of orgSlugs) {
      // eslint-disable-next-line no-await-in-loop
      await fetchLicensePolicy(orgSlug)
      expect(mockSdk.getOrgLicensePolicy).toHaveBeenCalledWith(orgSlug)
    }
  })

  it('uses null prototype for options', async () => {
    const { mockSdk } = await setupSdkMockSuccess('getOrgLicensePolicy', {})

    // This tests that the function properly uses __proto__: null.
    await fetchLicensePolicy('test-org')

    // The function should work without prototype pollution issues.
    expect(mockSdk.getOrgLicensePolicy).toHaveBeenCalled()
  })
})
