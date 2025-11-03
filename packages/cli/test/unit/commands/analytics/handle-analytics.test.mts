import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createErrorResult,
  createSuccessResult,
} from '../../../helpers/mocks.mts'
import { handleAnalytics } from '../../../../src/commands/analytics/handle-analytics.mts'
import { fetchOrgAnalyticsData } from '../../../../src/commands/analytics/fetch-org-analytics.mts'
import { fetchRepoAnalyticsData } from '../../../../src/commands/analytics/fetch-repo-analytics.mts'
import { outputAnalytics } from '../../../../src/commands/analytics/output-analytics.mts'

// Mock the dependencies.
vi.mock('../../../../src/commands/analytics/fetch-org-analytics.mts', () => ({
  fetchOrgAnalyticsData: vi.fn(),
}))
vi.mock('../../../../src/commands/analytics/fetch-repo-analytics.mts', () => ({
  fetchRepoAnalyticsData: vi.fn(),
}))
vi.mock('../../../../src/commands/analytics/output-analytics.mts', () => ({
  outputAnalytics: vi.fn(),
}))

describe('handleAnalytics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches org analytics when scope is org', async () => {
    const mockData = [{ packages: 10, vulnerabilities: 2 }]
    vi.mocked(fetchOrgAnalyticsData).mockResolvedValue(
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
    vi.mocked(fetchRepoAnalyticsData).mockResolvedValue(
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
    vi.mocked(fetchOrgAnalyticsData).mockResolvedValue(createSuccessResult([]))

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
    vi.mocked(fetchRepoAnalyticsData).mockResolvedValue(createSuccessResult([]))

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
    vi.mocked(fetchOrgAnalyticsData).mockResolvedValue(errorResult)

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
    vi.mocked(fetchOrgAnalyticsData).mockResolvedValue(
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
    vi.mocked(fetchOrgAnalyticsData).mockResolvedValue(
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
