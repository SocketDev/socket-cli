import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createErrorResult,
  createSuccessResult,
} from '../../../../src/helpers/mocks.mts'
import { handleAnalytics } from '../../../../src/src/commands/analytics/handle-analytics.mts'
import { fetchOrgAnalyticsData } from '../../../../src/src/commands/analytics/fetch-org-analytics.mts'
import { fetchRepoAnalyticsData } from '../../../../src/src/commands/analytics/fetch-repo-analytics.mts'
import { outputAnalytics } from '../../../../src/src/commands/analytics/output-analytics.mts'

// Mock the dependencies.
const mockFetchOrgAnalyticsData = vi.hoisted(() => vi.fn())
const mockFetchRepoAnalyticsData = vi.hoisted(() => vi.fn())
const mockOutputAnalytics = vi.hoisted(() => vi.fn())

vi.mock('../../../../src/commands/analytics/fetch-org-analytics.mts', () => ({
  fetchOrgAnalyticsData: mockFetchOrgAnalyticsData,
}))
vi.mock('../../../../src/commands/analytics/fetch-repo-analytics.mts', () => ({
  fetchRepoAnalyticsData: mockFetchRepoAnalyticsData,
}))
vi.mock('../../../../src/commands/analytics/output-analytics.mts', () => ({
  outputAnalytics: mockOutputAnalytics,
}))

describe('handleAnalytics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches org analytics when scope is org', async () => {
    const mockData = [{ packages: 10, vulnerabilities: 2 }]
    mockFetchOrgAnalyticsData.mockResolvedValue(
      createSuccessResult(mockData),
    )

    await handleAnalytics({
      filepath: '/tmp/analytics.json',
      outputKind: 'json',
      repo: '',
      scope: 'org',
      time: 30,
    })

    expect(fetchOrgAnalyticsData).toHaveBeenCalledWith(30)
    expect(outputAnalytics).toHaveBeenCalledWith(
      createSuccessResult(mockData),
      {
        filepath: '/tmp/analytics.json',
        outputKind: 'json',
        repo: '',
        scope: 'org',
        time: 30,
      },
    )
  })

  it('fetches repo analytics when repo is provided', async () => {
    const mockData = [{ packages: 5, vulnerabilities: 1 }]
    mockFetchRepoAnalyticsData.mockResolvedValue(
      createSuccessResult(mockData),
    )

    await handleAnalytics({
      filepath: '/tmp/analytics.json',
      outputKind: 'json',
      repo: 'test-repo',
      scope: 'repo',
      time: 7,
    })

    expect(fetchRepoAnalyticsData).toHaveBeenCalledWith('test-repo', 7)
    expect(outputAnalytics).toHaveBeenCalledWith(
      createSuccessResult(mockData),
      {
        filepath: '/tmp/analytics.json',
        outputKind: 'json',
        repo: 'test-repo',
        scope: 'repo',
        time: 7,
      },
    )
  })

  it('returns error when repo is missing and scope is not org', async () => {
    await handleAnalytics({
      filepath: '/tmp/analytics.json',
      outputKind: 'json',
      repo: '',
      scope: 'repo',
      time: 30,
    })

    expect(outputAnalytics).toHaveBeenCalledWith(
      {
        ok: false,
        message: 'Missing repository name in command',
      },
      {
        filepath: '/tmp/analytics.json',
        outputKind: 'json',
        repo: '',
        scope: 'repo',
        time: 30,
      },
    )
  })

  it('handles empty analytics data for org', async () => {
    mockFetchOrgAnalyticsData.mockResolvedValue(createSuccessResult([]))

    await handleAnalytics({
      filepath: '/tmp/analytics.json',
      outputKind: 'json',
      repo: '',
      scope: 'org',
      time: 30,
    })

    expect(outputAnalytics).toHaveBeenCalledWith(
      {
        ok: true,
        message:
          'The analytics data for this organization is not yet available.',
        data: [],
      },
      expect.any(Object),
    )
  })

  it('handles empty analytics data for repo', async () => {
    mockFetchRepoAnalyticsData.mockResolvedValue(createSuccessResult([]))

    await handleAnalytics({
      filepath: '/tmp/analytics.json',
      outputKind: 'json',
      repo: 'test-repo',
      scope: 'repo',
      time: 7,
    })

    expect(outputAnalytics).toHaveBeenCalledWith(
      {
        ok: true,
        message: 'The analytics data for this repository is not yet available.',
        data: [],
      },
      expect.any(Object),
    )
  })

  it('passes through fetch errors', async () => {
    const errorResult = createErrorResult('API error')
    mockFetchOrgAnalyticsData.mockResolvedValue(errorResult)

    await handleAnalytics({
      filepath: '/tmp/analytics.json',
      outputKind: 'json',
      repo: '',
      scope: 'org',
      time: 30,
    })

    expect(outputAnalytics).toHaveBeenCalledWith(
      errorResult,
      expect.any(Object),
    )
  })

  it('handles markdown output kind', async () => {
    const mockData = [{ packages: 10, vulnerabilities: 2 }]
    mockFetchOrgAnalyticsData.mockResolvedValue(
      createSuccessResult(mockData),
    )

    await handleAnalytics({
      filepath: '',
      outputKind: 'markdown',
      repo: '',
      scope: 'org',
      time: 30,
    })

    expect(outputAnalytics).toHaveBeenCalledWith(
      createSuccessResult(mockData),
      {
        filepath: '',
        outputKind: 'markdown',
        repo: '',
        scope: 'org',
        time: 30,
      },
    )
  })

  it('handles text output kind', async () => {
    const mockData = [{ packages: 10, vulnerabilities: 2 }]
    mockFetchOrgAnalyticsData.mockResolvedValue(
      createSuccessResult(mockData),
    )

    await handleAnalytics({
      filepath: '',
      outputKind: 'text',
      repo: '',
      scope: 'org',
      time: 30,
    })

    expect(outputAnalytics).toHaveBeenCalledWith(
      createSuccessResult(mockData),
      {
        filepath: '',
        outputKind: 'text',
        repo: '',
        scope: 'org',
        time: 30,
      },
    )
  })
})
