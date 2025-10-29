import { RequestError } from '@octokit/request-error'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { openSocketFixPr } from './pull-request.mts'

// Mock dependencies.
vi.mock('./git.mts', () => ({
  getSocketFixPullRequestTitle: vi.fn((ghsaIds: string[]) =>
    ghsaIds.length === 1 ? `Fix for ${ghsaIds[0]}` : `Fixes for ${ghsaIds.length} GHSAs`,
  ),
  getSocketFixPullRequestBody: vi.fn(() => 'Mock PR body'),
}))

vi.mock('../../utils/git/github.mts', () => ({
  getOctokit: vi.fn(),
}))

describe('pull-request', () => {
  let mockOctokit: any

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
  })

  describe('openSocketFixPr', () => {
    it('creates PR successfully on first attempt', async () => {
      const { getOctokit } = await import('../../utils/git/github.mts')
      vi.mocked(getOctokit).mockReturnValue(mockOctokit)

      const mockPrResponse = {
        status: 201,
        data: {
          number: 123,
          html_url: 'https://github.com/org/repo/pull/123',
          title: 'Fix for GHSA-1234-5678-90ab',
        },
      }
      mockOctokit.pulls.create.mockResolvedValue(mockPrResponse)

      const result = await openSocketFixPr(
        'test-org',
        'test-repo',
        'socket/fix/GHSA-1234-5678-90ab',
        ['GHSA-1234-5678-90ab'],
        { baseBranch: 'main' },
      )

      expect(result).toBeDefined()
      expect(result!.data.number).toBe(123)
      expect(mockOctokit.pulls.create).toHaveBeenCalledTimes(1)
    })

    it('retries on 5xx error', async () => {
      const { getOctokit } = await import('../../utils/git/github.mts')
      vi.mocked(getOctokit).mockReturnValue(mockOctokit)

      const mockError = new RequestError('Service Unavailable', 503, {
        request: {
          method: 'POST',
          url: 'https://api.github.com/repos/org/repo/pulls',
          headers: {},
        },
        response: {
          status: 503,
          url: 'https://api.github.com/repos/org/repo/pulls',
          headers: {},
          data: {},
        },
      })

      const mockSuccess = {
        status: 201,
        data: {
          number: 456,
          html_url: 'https://github.com/org/repo/pull/456',
          title: 'Fix for GHSA-test',
        },
      }

      // Fail first two attempts, succeed on third.
      mockOctokit.pulls.create
        .mockRejectedValueOnce(mockError)
        .mockRejectedValueOnce(mockError)
        .mockResolvedValueOnce(mockSuccess)

      const result = await openSocketFixPr(
        'test-org',
        'test-repo',
        'socket/fix/GHSA-test',
        ['GHSA-test'],
        { baseBranch: 'main', retries: 3 },
      )

      expect(result).toBeDefined()
      expect(result!.data.number).toBe(456)
      expect(mockOctokit.pulls.create).toHaveBeenCalledTimes(3)
    })

    it('does not retry on 422 validation error', async () => {
      const { getOctokit } = await import('../../utils/git/github.mts')
      vi.mocked(getOctokit).mockReturnValue(mockOctokit)

      const mockError = new RequestError('Validation Failed', 422, {
        request: {
          method: 'POST',
          url: 'https://api.github.com/repos/org/repo/pulls',
          headers: {},
        },
        response: {
          status: 422,
          url: 'https://api.github.com/repos/org/repo/pulls',
          headers: {},
          data: {
            errors: [
              {
                message: 'A pull request already exists',
                resource: 'PullRequest',
                field: 'base',
                code: 'custom',
              },
            ],
          },
        },
      })

      mockOctokit.pulls.create.mockRejectedValue(mockError)

      const result = await openSocketFixPr(
        'test-org',
        'test-repo',
        'socket/fix/GHSA-duplicate',
        ['GHSA-duplicate'],
        { baseBranch: 'main', retries: 3 },
      )

      expect(result).toBeUndefined()
      // Should only try once, not retry on 422.
      expect(mockOctokit.pulls.create).toHaveBeenCalledTimes(1)
    })

    it('respects custom retry count', async () => {
      const { getOctokit } = await import('../../utils/git/github.mts')
      vi.mocked(getOctokit).mockReturnValue(mockOctokit)

      const mockError = new RequestError('Internal Server Error', 500, {
        request: {
          method: 'POST',
          url: 'https://api.github.com/repos/org/repo/pulls',
          headers: {},
        },
        response: {
          status: 500,
          url: 'https://api.github.com/repos/org/repo/pulls',
          headers: {},
          data: {},
        },
      })

      mockOctokit.pulls.create.mockRejectedValue(mockError)

      const result = await openSocketFixPr(
        'test-org',
        'test-repo',
        'socket/fix/GHSA-retry',
        ['GHSA-retry'],
        { baseBranch: 'main', retries: 5 },
      )

      expect(result).toBeUndefined()
      // Should try 5 times as specified.
      expect(mockOctokit.pulls.create).toHaveBeenCalledTimes(5)
    })

    it('returns undefined after all retries exhausted', async () => {
      const { getOctokit } = await import('../../utils/git/github.mts')
      vi.mocked(getOctokit).mockReturnValue(mockOctokit)

      const mockError = new Error('Network error')
      mockOctokit.pulls.create.mockRejectedValue(mockError)

      const result = await openSocketFixPr(
        'test-org',
        'test-repo',
        'socket/fix/GHSA-fail',
        ['GHSA-fail'],
        { baseBranch: 'main', retries: 3 },
      )

      expect(result).toBeUndefined()
      expect(mockOctokit.pulls.create).toHaveBeenCalledTimes(3)
    })

    it('uses exponential backoff for retries', async () => {
      const { getOctokit } = await import('../../utils/git/github.mts')
      vi.mocked(getOctokit).mockReturnValue(mockOctokit)

      // Mock sleep to capture delay times.
      const sleepSpy = vi.spyOn(global, 'setTimeout')

      const mockError = new Error('Temporary failure')
      const mockSuccess = {
        status: 201,
        data: { number: 789, html_url: 'https://github.com/org/repo/pull/789' },
      }

      mockOctokit.pulls.create
        .mockRejectedValueOnce(mockError)
        .mockRejectedValueOnce(mockError)
        .mockResolvedValueOnce(mockSuccess)

      await openSocketFixPr(
        'test-org',
        'test-repo',
        'socket/fix/GHSA-backoff',
        ['GHSA-backoff'],
        { baseBranch: 'main', retries: 3 },
      )

      // First retry: 1000ms (1s), second retry: 2000ms (2s).
      expect(sleepSpy).toHaveBeenCalledWith(expect.any(Function), 1000)
      expect(sleepSpy).toHaveBeenCalledWith(expect.any(Function), 2000)

      sleepSpy.mockRestore()
    })

    it('passes GHSA details to PR body generator', async () => {
      const { getOctokit } = await import('../../utils/git/github.mts')
      const { getSocketFixPullRequestBody } = await import('./git.mts')
      vi.mocked(getOctokit).mockReturnValue(mockOctokit)

      mockOctokit.pulls.create.mockResolvedValue({
        status: 201,
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

      expect(getSocketFixPullRequestBody).toHaveBeenCalledWith(
        ['GHSA-details-test'],
        mockGhsaDetails,
      )
    })
  })
})
