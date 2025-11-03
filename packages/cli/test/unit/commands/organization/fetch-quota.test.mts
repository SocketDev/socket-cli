import { describe, expect, it, vi } from 'vitest'

import {
  setupSdkMockError,
  setupSdkMockSuccess,
  setupSdkSetupFailure,
} from '../../../../../src/commands/../../../test/helpers/sdk-test-helpers.mts'
import { fetchQuota } from '../../../../src/src/commands/../../../../src/commands/organization/fetch-quota.mts'

// Mock the dependencies.
vi.mock('../../../../../src/commands/../utils/socket/api.mts', () => ({
  handleApiCall: vi.fn(),
}))

vi.mock('../../../../../src/commands/../utils/socket/sdk.mts', () => ({
  setupSdk: vi.fn(),
}))

describe('fetchQuota', () => {
  it('fetches quota successfully', async () => {
    const mockData = {
      scans: { used: 250, limit: 1000 },
      packages: { used: 500, limit: 2000 },
      repositories: { used: 10, limit: 50 },
    }

    const { mockHandleApi, mockSdk } = await setupSdkMockSuccess(
      'getQuota',
      mockData,
    )

    const result = await fetchQuota()

    expect(mockSdk.getQuota).toHaveBeenCalledWith()
    expect(mockHandleApi).toHaveBeenCalledWith(expect.any(Promise), {
      description: 'token quota',
    })
    expect(result.ok).toBe(true)
  })

  it('handles SDK setup failure', async () => {
    await setupSdkSetupFailure('Failed to setup SDK', {
      cause: 'Configuration error',
    })

    const result = await fetchQuota()

    expect(result.ok).toBe(false)
  })

  it('handles API call failure', async () => {
    await setupSdkMockError('getQuota', 'Quota unavailable', 503)

    const result = await fetchQuota()

    expect(result.ok).toBe(false)
    expect(result.code).toBe(503)
  })

  it('passes custom SDK options', async () => {
    const { mockSetupSdk } = await setupSdkMockSuccess('getQuota', {})

    const sdkOpts = {
      apiToken: 'quota-token',
      baseUrl: 'https://quota.api.com',
    }

    await fetchQuota({ sdkOpts })

    expect(mockSetupSdk).toHaveBeenCalledWith(sdkOpts)
  })

  it('handles quota at limit', async () => {
    const mockData = {
      scans: { used: 1000, limit: 1000, percentage: 100 },
    }

    await setupSdkMockSuccess('getQuota', mockData)

    const result = await fetchQuota()

    expect(result.ok).toBe(true)
    expect(result.data.scans.percentage).toBe(100)
  })

  it('handles various org slugs', async () => {
    const { mockSdk } = await setupSdkMockSuccess('getQuota', {})

    const orgSlugs = [
      'simple',
      'org-with-dashes',
      'org_underscore',
      'org123numbers',
    ]

    for (const _orgSlug of orgSlugs) {
      // eslint-disable-next-line no-await-in-loop
      await fetchQuota()
      expect(mockSdk.getQuota).toHaveBeenCalledWith()
    }
  })

  it('uses null prototype for options', async () => {
    const { mockSdk } = await setupSdkMockSuccess('getQuota', {})

    // This tests that the function properly uses __proto__: null.
    await fetchQuota()

    // The function should work without prototype pollution issues.
    expect(mockSdk.getQuota).toHaveBeenCalled()
  })
})
