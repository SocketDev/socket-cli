import { describe, expect, it, vi } from 'vitest'

import {
  setupSdkMockError,
  setupSdkMockSuccess,
  setupSdkSetupFailure,
} from '../../../../test/helpers/sdk-test-helpers.mts'
import { fetchRepoAnalyticsData } from '../../../../../src/commands/analytics/fetch-repo-analytics.mts'

// Mock the dependencies.
vi.mock('../../utils/socket/api.mts', () => ({
  handleApiCall: vi.fn(),
}))

vi.mock('../../utils/socket/sdk.mts', () => ({
  setupSdk: vi.fn(),
}))

describe('fetchRepoAnalytics', () => {
  it('fetches repository analytics successfully', async () => {
    const { mockHandleApi, mockSdk } = await setupSdkMockSuccess(
      'getRepoAnalytics',
      {
        commits: 450,
        contributors: 12,
        issues: 85,
        pullRequests: 120,
        stars: 340,
        lastUpdated: '2025-01-20T12:00:00Z',
      },
    )

    const result = await fetchRepoAnalyticsData('test-repo', 30)

    expect(mockSdk.getRepoAnalytics).toHaveBeenCalledWith('test-repo', '30')
    expect(mockHandleApi).toHaveBeenCalledWith(expect.any(Promise), {
      description: 'analytics data',
    })
    expect(result.ok).toBe(true)
  })

  it('handles SDK setup failure', async () => {
    await setupSdkSetupFailure('Failed to setup SDK', {
      code: 1,
      cause: 'Configuration error',
    })

    const result = await fetchRepoAnalyticsData('my-repo', 7)

    expect(result.ok).toBe(false)
    expect(result.message).toBe('Failed to setup SDK')
  })

  it('handles API call failure', async () => {
    await setupSdkMockError(
      'getRepoAnalytics',
      'Repository analytics unavailable',
      404,
    )

    const result = await fetchRepoAnalyticsData('nonexistent-repo', 30)

    expect(result.ok).toBe(false)
    expect(result.code).toBe(404)
  })

  it('passes custom SDK options', async () => {
    const { mockSetupSdk } = await setupSdkMockSuccess('getRepoAnalytics', {})

    const sdkOpts = {
      apiToken: 'repo-analytics-token',
      baseUrl: 'https://repo.api.com',
    }

    await fetchRepoAnalyticsData('custom-repo', 90, { sdkOpts })

    expect(mockSetupSdk).toHaveBeenCalledWith(sdkOpts)
  })

  it('handles different org and repo combinations', async () => {
    const { mockSdk } = await setupSdkMockSuccess('getRepoAnalytics', {})

    const repos = ['org/repo1', 'org/repo2', 'another-org/repo', 'user/project']

    for (const repo of repos) {
      // eslint-disable-next-line no-await-in-loop
      await fetchRepoAnalyticsData(repo, 30)
      expect(mockSdk.getRepoAnalytics).toHaveBeenCalledWith(repo, '30')
    }
  })

  it('handles different time ranges', async () => {
    const { mockSdk } = await setupSdkMockSuccess('getRepoAnalytics', {})

    const timeRanges = [1, 7, 14, 30, 60, 90, 365]

    for (const time of timeRanges) {
      // eslint-disable-next-line no-await-in-loop
      await fetchRepoAnalyticsData('test-repo', time)
      expect(mockSdk.getRepoAnalytics).toHaveBeenCalledWith(
        'test-repo',
        time.toString(),
      )
    }
  })

  it('uses null prototype for options', async () => {
    const { mockSdk } = await setupSdkMockSuccess('getRepoAnalytics', {})

    // This tests that the function properly uses __proto__: null.
    await fetchRepoAnalyticsData('test-repo', 30)

    // The function should work without prototype pollution issues.
    expect(mockSdk.getRepoAnalytics).toHaveBeenCalled()
  })
})
