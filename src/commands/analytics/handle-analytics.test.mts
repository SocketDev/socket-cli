import { beforeEach, describe, expect, it, vi } from 'vitest'

import { handleAnalytics } from './handle-analytics.mts'

// Mock the dependencies.
vi.mock('./fetch-org-analytics.mts', () => ({
  fetchOrgAnalyticsData: vi.fn(),
}))
vi.mock('./fetch-repo-analytics.mts', () => ({
  fetchRepoAnalyticsData: vi.fn(),
}))
vi.mock('./output-analytics.mts', () => ({
  outputAnalytics: vi.fn(),
}))

describe('handleAnalytics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches org analytics when scope is org', async () => {
    const { fetchOrgAnalyticsData } = await import('./fetch-org-analytics.mts')
    const { outputAnalytics } = await import('./output-analytics.mts')

    const mockData = [{ packages: 10, vulnerabilities: 2 }]
    vi.mocked(fetchOrgAnalyticsData).mockResolvedValue({
      ok: true,
      data: mockData,
    })

    await handleAnalytics({
      filepath: '/tmp/analytics.json',
      outputKind: 'json',
      repo: '',
      scope: 'org',
      time: 30,
    })

    expect(fetchOrgAnalyticsData).toHaveBeenCalledWith(30)
    expect(outputAnalytics).toHaveBeenCalledWith(
      { ok: true, data: mockData },
      {
        filepath: '/tmp/analytics.json',
        outputKind: 'json',
        repo: '',
        scope: 'org',
        time: 30,
      }
    )
  })

  it('fetches repo analytics when repo is provided', async () => {
    const { fetchRepoAnalyticsData } = await import('./fetch-repo-analytics.mts')
    const { outputAnalytics } = await import('./output-analytics.mts')

    const mockData = [{ packages: 5, vulnerabilities: 1 }]
    vi.mocked(fetchRepoAnalyticsData).mockResolvedValue({
      ok: true,
      data: mockData,
    })

    await handleAnalytics({
      filepath: '/tmp/analytics.json',
      outputKind: 'json',
      repo: 'test-repo',
      scope: 'repo',
      time: 7,
    })

    expect(fetchRepoAnalyticsData).toHaveBeenCalledWith('test-repo', 7)
    expect(outputAnalytics).toHaveBeenCalledWith(
      { ok: true, data: mockData },
      {
        filepath: '/tmp/analytics.json',
        outputKind: 'json',
        repo: 'test-repo',
        scope: 'repo',
        time: 7,
      }
    )
  })

  it('returns error when repo is missing and scope is not org', async () => {
    const { outputAnalytics } = await import('./output-analytics.mts')

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
      }
    )
  })

  it('handles empty analytics data for org', async () => {
    const { fetchOrgAnalyticsData } = await import('./fetch-org-analytics.mts')
    const { outputAnalytics } = await import('./output-analytics.mts')

    vi.mocked(fetchOrgAnalyticsData).mockResolvedValue({
      ok: true,
      data: [],
    })

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
        message: 'The analytics data for this organization is not yet available.',
        data: [],
      },
      expect.any(Object)
    )
  })

  it('handles empty analytics data for repo', async () => {
    const { fetchRepoAnalyticsData } = await import('./fetch-repo-analytics.mts')
    const { outputAnalytics } = await import('./output-analytics.mts')

    vi.mocked(fetchRepoAnalyticsData).mockResolvedValue({
      ok: true,
      data: [],
    })

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
      expect.any(Object)
    )
  })

  it('passes through fetch errors', async () => {
    const { fetchOrgAnalyticsData } = await import('./fetch-org-analytics.mts')
    const { outputAnalytics } = await import('./output-analytics.mts')

    const error = new Error('API error')
    vi.mocked(fetchOrgAnalyticsData).mockResolvedValue({
      ok: false,
      error,
    })

    await handleAnalytics({
      filepath: '/tmp/analytics.json',
      outputKind: 'json',
      repo: '',
      scope: 'org',
      time: 30,
    })

    expect(outputAnalytics).toHaveBeenCalledWith(
      { ok: false, error },
      expect.any(Object)
    )
  })

  it('handles markdown output kind', async () => {
    const { fetchOrgAnalyticsData } = await import('./fetch-org-analytics.mts')
    const { outputAnalytics } = await import('./output-analytics.mts')

    const mockData = [{ packages: 10, vulnerabilities: 2 }]
    vi.mocked(fetchOrgAnalyticsData).mockResolvedValue({
      ok: true,
      data: mockData,
    })

    await handleAnalytics({
      filepath: '',
      outputKind: 'markdown',
      repo: '',
      scope: 'org',
      time: 30,
    })

    expect(outputAnalytics).toHaveBeenCalledWith(
      { ok: true, data: mockData },
      {
        filepath: '',
        outputKind: 'markdown',
        repo: '',
        scope: 'org',
        time: 30,
      }
    )
  })

  it('handles text output kind', async () => {
    const { fetchOrgAnalyticsData } = await import('./fetch-org-analytics.mts')
    const { outputAnalytics } = await import('./output-analytics.mts')

    const mockData = [{ packages: 10, vulnerabilities: 2 }]
    vi.mocked(fetchOrgAnalyticsData).mockResolvedValue({
      ok: true,
      data: mockData,
    })

    await handleAnalytics({
      filepath: '',
      outputKind: 'text',
      repo: '',
      scope: 'org',
      time: 30,
    })

    expect(outputAnalytics).toHaveBeenCalledWith(
      { ok: true, data: mockData },
      {
        filepath: '',
        outputKind: 'text',
        repo: '',
        scope: 'org',
        time: 30,
      }
    )
  })
})