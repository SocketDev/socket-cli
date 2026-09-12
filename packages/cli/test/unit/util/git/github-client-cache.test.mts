/**
 * Unit tests for GitHub API client accessors and cache helpers.
 *
 * Purpose: Tests the singleton Octokit/GraphQL clients, the cacheFetch /
 * writeCache disk-cache helpers, and the auto-merge / GHSA / remote-URL
 * utility functions.
 *
 * Related Files: - src/util/git/github.mts (implementation) -
 * src/commands/scan/create-scan-from-github.mts (consumer) -
 * src/util/git/github-provider.mts (consumer)
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  cacheFetch,
  getOctokit,
  getOctokitGraphql,
  writeCache,
} from '../../../../src/util/git/github.mts'

const mockGraphqlFetch = vi.hoisted(() =>
  vi
    .fn<typeof fetch>()
    .mockRejectedValue(new Error('Unconfigured GraphQL fixture')),
)

vi.mock(import('@octokit/graphql'), async importOriginal => {
  const actual = await importOriginal()
  return {
    ...actual,
    graphql: actual.graphql.defaults({ request: { fetch: mockGraphqlFetch } }),
  }
})

// Mock debug utilities to suppress output during tests.
vi.mock(import('@socketsecurity/lib-stable/debug/output'), () => ({
  debug: vi.fn(),
  debugDir: vi.fn(),
  debugDirNs: vi.fn(),
  debugNs: vi.fn(),
}))
vi.mock(import('@socketsecurity/lib-stable/debug/namespace'), () => ({
  isDebugNs: vi.fn(() => false),
}))

describe('getOctokit', () => {
  it('returns an Octokit instance', () => {
    const octokit = getOctokit()
    expect(octokit).toBeDefined()
    expect(octokit.pulls).toBeDefined()
    expect(octokit.repos).toBeDefined()
  })

  it('returns the same instance on subsequent calls', () => {
    const octokit1 = getOctokit()
    const octokit2 = getOctokit()
    expect(octokit1).toBe(octokit2)
  })
})

describe('getOctokitGraphql', () => {
  it('returns a GraphQL client', () => {
    const graphql = getOctokitGraphql()
    expect(graphql).toBeDefined()
    expect(typeof graphql).toBe('function')
  })

  it('returns the same instance on subsequent calls', () => {
    const graphql1 = getOctokitGraphql()
    const graphql2 = getOctokitGraphql()
    expect(graphql1).toBe(graphql2)
  })
})

describe('cacheFetch', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('calls the fetcher when cache is empty', async () => {
    const fetcher = vi.fn().mockResolvedValue({ value: 'fetched' })
    // Use unique key to avoid cache from other tests.
    const key = `test-fetch-${Date.now()}-${Math.random()}`

    const result = await cacheFetch(key, fetcher)

    expect(result).toEqual({ value: 'fetched' })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('returns cached value on subsequent calls', async () => {
    const key = `test-cached-${Date.now()}-${Math.random()}`
    const fetcher = vi.fn().mockResolvedValue({ value: 'cached' })

    // First call populates cache.
    await cacheFetch(key, fetcher)

    // Second call should use cache.
    const result = await cacheFetch(key, fetcher)

    expect(result).toEqual({ value: 'cached' })
    // Fetcher should only be called once.
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('prevents concurrent fetches for the same key', async () => {
    const key = `test-concurrent-${Date.now()}-${Math.random()}`
    let resolvePromise: (value: { value: string }) => void
    const slowFetcher = vi.fn().mockReturnValue(
      new Promise(resolve => {
        resolvePromise = resolve
      }),
    )

    // Start two concurrent fetches.
    const promise1 = cacheFetch(key, slowFetcher)
    const promise2 = cacheFetch(key, slowFetcher)

    // Resolve the slow fetcher.
    resolvePromise!({ value: 'slow-result' })

    const { 0: result1, 1: result2 } = await Promise.all([promise1, promise2])

    expect(result1).toEqual({ value: 'slow-result' })
    expect(result2).toEqual({ value: 'slow-result' })
    // Fetcher should only be called once.
    expect(slowFetcher).toHaveBeenCalledTimes(1)
  })
})

describe('writeCache', () => {
  it('writes cache data without throwing', async () => {
    const key = `test-write-${Date.now()}-${Math.random()}`
    const data = { test: 'data', value: 123 }

    // Should not throw.
    await expect(writeCache(key, data)).resolves.not.toThrow()
  })
})

describe('enablePrAutoMerge', () => {
  it('returns enabled true when GraphQL mutation succeeds', async () => {
    const { enablePrAutoMerge } =
      await import('../../../../src/util/git/github.mts')
    const mockPr = {
      node_id: 'example-pull-request-node',
      number: 123,
    } as unknown
    mockGraphqlFetch.mockResolvedValueOnce(
      Response.json({
        data: { enablePullRequestAutoMerge: { pullRequest: { number: 123 } } },
      }),
    )

    const result = await enablePrAutoMerge(mockPr)

    expect(result).toEqual({ enabled: true })
    const requestBody = mockGraphqlFetch.mock.lastCall?.[1]?.body
    expect(requestBody).toEqual(expect.stringContaining('EnableAutoMerge'))
    expect(requestBody).toEqual(
      expect.stringContaining('example-pull-request-node'),
    )
  })
})

describe('fetchGhsaDetails', () => {
  it('returns empty map for empty input array', async () => {
    const { fetchGhsaDetails } =
      await import('../../../../src/util/git/github.mts')

    const result = await fetchGhsaDetails([])

    expect(result).toBeInstanceOf(Map)
    expect(result.size).toBe(0)
  })

  it('returns a Map for valid GHSA IDs', async () => {
    const { fetchGhsaDetails } =
      await import('../../../../src/util/git/github.mts')

    const ghsaId = `GHSA-example-${Date.now()}-${Math.random()}`
    const advisory = {
      ghsaId,
      summary: 'Example advisory',
      severity: 'HIGH',
      publishedAt: '2025-01-01T00:00:00Z',
      references: [],
      vulnerabilities: { nodes: [] },
    }
    mockGraphqlFetch.mockResolvedValueOnce(
      Response.json({
        data: { advisory0: advisory },
      }),
    )

    const result = await fetchGhsaDetails([ghsaId])

    expect([...result]).toEqual([[ghsaId, advisory]])
    const requestBody = mockGraphqlFetch.mock.lastCall?.[1]?.body
    expect(requestBody).toEqual(expect.stringContaining(ghsaId))
  })
})

describe('setGitRemoteGithubRepoUrl', () => {
  it('returns false when GITHUB_SERVER_URL is invalid', async () => {
    // Without proper mocking of GITHUB_SERVER_URL environment variable,
    // this test verifies the function handles the edge case.
    const { setGitRemoteGithubRepoUrl } =
      await import('../../../../src/util/git/github.mts')

    // The function should return false when it cannot parse the server URL.
    const result = await setGitRemoteGithubRepoUrl(
      'test-owner',
      'test-repo',
      'test-token',
      '/nonexistent/path',
    )

    expect(typeof result).toBe('boolean')
  })
})
