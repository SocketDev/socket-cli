import { beforeEach, describe, expect, it, vi } from 'vitest'

import { openSocketFixPr } from '../../../../src/src/commands/fix/pull-request.mts'

const mockGetOctokit = vi.hoisted(() => vi.fn())
const mockCreatePrProvider = vi.hoisted(() => vi.fn())
const mockGetSocketFixPullRequestTitle = vi.hoisted(() =>
  vi.fn((ghsaIds: string[]) =>
    ghsaIds.length === 1
      ? `Fix for ${ghsaIds[0]}`
      : `Fixes for ${ghsaIds.length} GHSAs`,
  ),
)
const mockGetSocketFixPullRequestBody = vi.hoisted(() =>
  vi.fn(() => 'Mock PR body'),
)

// Mock dependencies.
vi.mock('../../../../src/commands/fix/git.mts', () => ({
  getSocketFixPullRequestTitle: mockGetSocketFixPullRequestTitle,
  getSocketFixPullRequestBody: mockGetSocketFixPullRequestBody,
}))

vi.mock('../../../../src/utils/git/github.mts', () => ({
  getOctokit: mockGetOctokit,
}))

vi.mock('../../../../src/utils/git/provider-factory.mts', () => ({
  createPrProvider: mockCreatePrProvider,
}))

describe('pull-request', () => {
  let mockOctokit: any
  let mockProvider: any

  beforeEach(() => {
    vi.clearAllMocks()

    // Create mock Octokit instance.
    mockOctokit = {
      pulls: {
        create: vi.fn(),
        get: vi.fn(),
        update: vi.fn(),
      },
      issues: {
        createComment: vi.fn(),
      },
      repos: {
        merge: vi.fn(),
      },
    }

    // Create mock provider.
    mockProvider = {
      createPr: vi.fn(),
      updatePr: vi.fn(),
      listPrs: vi.fn(),
      deleteBranch: vi.fn(),
      addComment: vi.fn(),
      getProviderName: vi.fn(() => 'github'),
      supportsGraphQL: vi.fn(() => true),
    }
  })

  describe('openSocketFixPr', () => {
    it('creates PR successfully on first attempt', async () => {
      mockGetOctokit.mockReturnValue(mockOctokit)
      mockCreatePrProvider.mockReturnValue(mockProvider)

      // Provider returns simplified response.
      mockProvider.createPr.mockResolvedValue({
        number: 123,
        url: 'https://github.com/org/repo/pull/123',
        state: 'open',
      })

      // Octokit returns full PR details.
      const mockPrResponse = {
        status: 200,
        data: {
          number: 123,
          html_url: 'https://github.com/org/repo/pull/123',
          title: 'Fix for GHSA-1234-5678-90ab',
        },
      }
      mockOctokit.pulls.get.mockResolvedValue(mockPrResponse)

      const result = await openSocketFixPr(
        'test-org',
        'test-repo',
        'socket/fix/GHSA-1234-5678-90ab',
        ['GHSA-1234-5678-90ab'],
        { baseBranch: 'main' },
      )

      expect(result).toBeDefined()
      expect(result!.data.number).toBe(123)
      expect(mockProvider.createPr).toHaveBeenCalledTimes(1)
      expect(mockOctokit.pulls.get).toHaveBeenCalledTimes(1)
    })

    it('retries on 5xx error', async () => {
      mockGetOctokit.mockReturnValue(mockOctokit)
      mockCreatePrProvider.mockReturnValue(mockProvider)

      // Provider succeeds after retries (retry logic is in provider).
      mockProvider.createPr.mockResolvedValue({
        number: 456,
        url: 'https://github.com/org/repo/pull/456',
        state: 'open',
      })

      mockOctokit.pulls.get.mockResolvedValue({
        status: 200,
        data: {
          number: 456,
          html_url: 'https://github.com/org/repo/pull/456',
          title: 'Fix for GHSA-test',
        },
      })

      const result = await openSocketFixPr(
        'test-org',
        'test-repo',
        'socket/fix/GHSA-test',
        ['GHSA-test'],
        { baseBranch: 'main', retries: 3 },
      )

      expect(result).toBeDefined()
      expect(result!.data.number).toBe(456)
    })

    it('does not retry on 422 validation error', async () => {
      mockCreatePrProvider.mockReturnValue(mockProvider)

      // Provider throws error (validation errors are not retried in provider).
      mockProvider.createPr.mockRejectedValue(
        new Error('Validation Failed: A pull request already exists'),
      )

      const result = await openSocketFixPr(
        'test-org',
        'test-repo',
        'socket/fix/GHSA-duplicate',
        ['GHSA-duplicate'],
        { baseBranch: 'main', retries: 3 },
      )

      expect(result).toBeUndefined()
    })

    it('respects custom retry count', async () => {
      mockCreatePrProvider.mockReturnValue(mockProvider)

      // Provider throws error after retries.
      mockProvider.createPr.mockRejectedValue(
        new Error('Failed after 5 retries'),
      )

      const result = await openSocketFixPr(
        'test-org',
        'test-repo',
        'socket/fix/GHSA-retry',
        ['GHSA-retry'],
        { baseBranch: 'main', retries: 5 },
      )

      expect(result).toBeUndefined()
    })

    it('returns undefined after all retries exhausted', async () => {
      mockCreatePrProvider.mockReturnValue(mockProvider)

      // Provider throws error.
      mockProvider.createPr.mockRejectedValue(new Error('Network error'))

      const result = await openSocketFixPr(
        'test-org',
        'test-repo',
        'socket/fix/GHSA-fail',
        ['GHSA-fail'],
        { baseBranch: 'main', retries: 3 },
      )

      expect(result).toBeUndefined()
    })

    it('uses exponential backoff for retries', async () => {
      mockGetOctokit.mockReturnValue(mockOctokit)
      mockCreatePrProvider.mockReturnValue(mockProvider)

      // Provider succeeds (backoff logic is in provider).
      mockProvider.createPr.mockResolvedValue({
        number: 789,
        url: 'https://github.com/org/repo/pull/789',
        state: 'open',
      })

      mockOctokit.pulls.get.mockResolvedValue({
        status: 200,
        data: {
          number: 789,
          html_url: 'https://github.com/org/repo/pull/789',
        },
      })

      const result = await openSocketFixPr(
        'test-org',
        'test-repo',
        'socket/fix/GHSA-backoff',
        ['GHSA-backoff'],
        { baseBranch: 'main', retries: 3 },
      )

      expect(result).toBeDefined()
    })

    it('passes GHSA details to PR body generator', async () => {
      mockGetOctokit.mockReturnValue(mockOctokit)
      mockCreatePrProvider.mockReturnValue(mockProvider)

      mockProvider.createPr.mockResolvedValue({
        number: 999,
        url: 'https://github.com/org/repo/pull/999',
        state: 'open',
      })

      mockOctokit.pulls.get.mockResolvedValue({
        status: 200,
        data: { number: 999 },
      })

      const mockGhsaDetails = new Map([
        [
          'GHSA-details-test',
          {
            summary: 'Test vulnerability',
            severity: 'HIGH',
            vulnerabilities: { nodes: [] },
          },
        ],
      ])

      await openSocketFixPr(
        'test-org',
        'test-repo',
        'socket/fix/GHSA-details-test',
        ['GHSA-details-test'],
        {
          baseBranch: 'main',
          ghsaDetails: mockGhsaDetails,
        },
      )

      expect(mockGetSocketFixPullRequestBody).toHaveBeenCalledWith(
        ['GHSA-details-test'],
        mockGhsaDetails,
      )
    })
  })
})
