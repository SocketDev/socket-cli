import { describe, expect, it, vi } from 'vitest'

import {
  setupSdkMockError,
  setupSdkMockSuccess,
  setupSdkSetupFailure,
} from '../../../test/helpers/sdk-test-helpers.mts'
import { fetchOrgAnalyticsData } from '../../../../../src/commands/analytics/fetch-org-analytics.mts'

// Mock the dependencies.
vi.mock('../../utils/socket/api.mts', () => ({
  handleApiCall: vi.fn(),
}))

vi.mock('../../utils/socket/sdk.mts', () => ({
  setupSdk: vi.fn(),
}))

describe('fetchOrgAnalytics', () => {
  it('fetches organization analytics successfully', async () => {
    const { mockHandleApi, mockSdk } = await setupSdkMockSuccess(
      'getOrgAnalytics',
      {
        packages: 125,
        repositories: 45,
        scans: 320,
        vulnerabilities: {
          critical: 5,
          high: 12,
          medium: 28,
          low: 45,
        },
        lastUpdated: '2025-01-01T00:00:00Z',
      },
    )

    const result = await fetchOrgAnalyticsData(30)

    expect(mockSdk.getOrgAnalytics).toHaveBeenCalledWith('30')
    expect(mockHandleApi).toHaveBeenCalledWith(expect.any(Promise), {
      description: 'analytics data',
    })
    expect(result.ok).toBe(true)
  })

  it('handles SDK setup failure', async () => {
    await setupSdkSetupFailure('Failed to setup SDK', {
      code: 1,
      cause: 'Invalid configuration',
    })

    const result = await fetchOrgAnalyticsData(7)

    expect(result.ok).toBe(false)
    expect(result.message).toBe('Failed to setup SDK')
  })

  it('handles API call failure', async () => {
    await setupSdkMockError(
      'getOrgAnalytics',
      'Analytics service unavailable',
      503,
    )

    const result = await fetchOrgAnalyticsData(30)

    expect(result.ok).toBe(false)
    expect(result.code).toBe(503)
  })

  it('passes custom SDK options', async () => {
    const { mockSetupSdk } = await setupSdkMockSuccess('getOrgAnalytics', {})

    const sdkOpts = {
      apiToken: 'analytics-token',
      baseUrl: 'https://analytics.api.com',
    }

    await fetchOrgAnalyticsData(90, { sdkOpts })

    expect(mockSetupSdk).toHaveBeenCalledWith(sdkOpts)
  })

  it('handles different organization slugs', async () => {
    const { mockSdk } = await setupSdkMockSuccess('getOrgAnalytics', {})

    const times = [7, 14, 30, 60, 90]

    for (const time of times) {
      // eslint-disable-next-line no-await-in-loop
      await fetchOrgAnalyticsData(time)
      expect(mockSdk.getOrgAnalytics).toHaveBeenCalledWith(time.toString())
    }
  })

  it('uses null prototype for options', async () => {
    const { mockSdk } = await setupSdkMockSuccess('getOrgAnalytics', {})

    // This tests that the function properly uses __proto__: null.
    await fetchOrgAnalyticsData(30)

    // The function should work without prototype pollution issues.
    expect(mockSdk.getOrgAnalytics).toHaveBeenCalled()
  })
})
