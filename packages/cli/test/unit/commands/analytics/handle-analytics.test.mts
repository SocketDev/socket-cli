/**
 * Unit tests for analytics command handler.
 *
 * Tests the main handler logic that orchestrates analytics data fetching and output.
 * Validates routing between organization and repository analytics based on scope.
 *
 * Test Coverage:
 * - Organization analytics fetch when scope is 'org'
 * - Repository analytics fetch when repo is provided and scope is 'repo'
 * - Missing repository name error when scope is 'repo' but repo is empty
 * - Empty analytics data handling for organization
 * - Empty analytics data handling for repository
 * - Fetch error pass-through to output layer
 * - Multiple output kinds (json, markdown, text)
 * - Different time ranges (7, 30 days)
 * - Filepath handling (with and without path)
 *
 * Testing Approach:
 * - Mock fetchOrgAnalyticsData and fetchRepoAnalyticsData
 * - Mock outputAnalytics to verify output layer calls
 * - Use createSuccessResult/createErrorResult helpers for CResult pattern
 * - Verify correct function selection based on scope parameter
 * - Test validation logic before API calls
 *
 * Related Files:
 * - src/commands/analytics/handle-analytics.mts - Implementation
 * - src/commands/analytics/fetch-org-analytics.mts - Org data fetcher
 * - src/commands/analytics/fetch-repo-analytics.mts - Repo data fetcher
 * - src/commands/analytics/output-analytics.mts - Output formatter
 */

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
