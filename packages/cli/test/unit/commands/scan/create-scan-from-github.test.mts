/**
 * Unit tests for createScanFromGithub rate-limit short-circuiting.
 *
 * Purpose: Drives the full createScanFromGithub function through mocked
 * Octokit calls (via the withGitHubRetry wrapper) to verify that a
 * rate-limited, abuse-detected, or unauthenticated GitHub response
 * short-circuits the per-repo scan loop instead of silently swallowing the
 * failure.
 *
 * Related Files: - src/commands/scan/create-scan-from-github.mts
 * (implementation) - src/util/git/github.mts (GitHub utilities)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'

const mockOctokit = vi.hoisted(() => ({
  repos: {
    get: vi.fn(),
    listCommits: vi.fn(),
    getContent: vi.fn(),
  },
  git: {
    getTree: vi.fn(),
  },
}))

const mockWithGitHubRetry = vi.hoisted(() =>
  vi.fn(async (operation: () => Promise<unknown>, context: string) => {
    try {
      const result = await operation()
      return { ok: true, data: result }
    } catch (e) {
      return {
        ok: false,
        message: 'GitHub API error',
        cause: `Error while ${context}: ${errorMessage(e)}`,
      }
    }
  }),
)

// Mock dependencies.
vi.mock(import('../../../../src/util/git/github.mts'), () => ({
  GITHUB_ERR_ABUSE_DETECTION: 'GitHub abuse detection triggered',
  GITHUB_ERR_AUTH_FAILED: 'GitHub authentication failed',
  GITHUB_ERR_GRAPHQL_RATE_LIMIT: 'GitHub GraphQL rate limit exceeded',
  GITHUB_ERR_RATE_LIMIT: 'GitHub rate limit exceeded',
  getOctokit: vi.fn(() => mockOctokit),
  withGitHubRetry: mockWithGitHubRetry,
}))

vi.mock(import('@socketsecurity/lib-stable/debug/output'), () => ({
  debug: vi.fn(),
  debugDir: vi.fn(),
}))

vi.mock(import('@socketsecurity/lib-stable/logger/default'), () => ({
  getDefaultLogger: vi.fn(() => ({
    fail: vi.fn(),
    group: vi.fn(),
    groupEnd: vi.fn(),
    info: vi.fn(),
    log: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
  })),
}))

// Mock other dependencies to isolate the functions under test.
vi.mock(
  import('../../../../src/commands/scan/fetch-supported-scan-file-names.mts'),
  () => ({
    fetchSupportedScanFileNames: vi.fn().mockResolvedValue({
      ok: true,
      data: ['package.json', 'package-lock.json', 'yarn.lock'],
    }),
  }),
)

vi.mock(
  import('../../../../src/commands/scan/handle-create-new-scan.mts'),
  () => ({
    handleCreateNewScan: vi
      .fn()
      .mockResolvedValue({ ok: true, data: undefined }),
  }),
)

vi.mock(
  import('../../../../src/commands/repository/fetch-list-all-repos.mts'),
  () => ({
    fetchListAllRepos: vi.fn().mockResolvedValue({
      ok: true,
      data: { results: [{ slug: 'test-repo' }] },
    }),
  }),
)

// Regression tests: the bulk loop in createScanFromGithub used to
// swallow per-repo failures, so a rate-limited token returned ok:true
// with "0 manifests". These drive the full function through mocked
// octokit calls.
describe('createScanFromGithub rate-limit short-circuit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns ok:false and stops the loop on GitHub rate limit', async () => {
    // First call (getRepoDetails for repo-a) fails with rate limit.
    mockWithGitHubRetry.mockResolvedValueOnce({
      ok: false,
      message: 'GitHub rate limit exceeded',
      cause: 'GitHub API rate limit exceeded.',
    })

    const { createScanFromGithub } =
      await import('../../../../src/commands/scan/create-scan-from-github.mts')

    const result = await createScanFromGithub({
      all: false,
      githubApiUrl: '',
      githubToken: '',
      interactive: false,
      orgGithub: 'org',
      orgSlug: 'org',
      outputKind: 'text',
      repos: 'repo-a,repo-b,repo-c',
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toBe('GitHub rate limit exceeded')
    }
    // Short-circuit: only the first repo's getRepoDetails should have run.
    expect(mockWithGitHubRetry).toHaveBeenCalledTimes(1)
  })

  it('returns ok:false and stops on GitHub GraphQL rate limit', async () => {
    mockWithGitHubRetry.mockResolvedValueOnce({
      ok: false,
      message: 'GitHub GraphQL rate limit exceeded',
      cause: 'GraphQL rate limit hit.',
    })

    const { createScanFromGithub } =
      await import('../../../../src/commands/scan/create-scan-from-github.mts')

    const result = await createScanFromGithub({
      all: false,
      githubApiUrl: '',
      githubToken: '',
      interactive: false,
      orgGithub: 'org',
      orgSlug: 'org',
      outputKind: 'text',
      repos: 'repo-a,repo-b,repo-c',
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toBe('GitHub GraphQL rate limit exceeded')
    }
    expect(mockWithGitHubRetry).toHaveBeenCalledTimes(1)
  })

  it('returns ok:false and stops on GitHub abuse detection', async () => {
    mockWithGitHubRetry.mockResolvedValueOnce({
      ok: false,
      message: 'GitHub abuse detection triggered',
      cause: 'Secondary rate limit hit.',
    })

    const { createScanFromGithub } =
      await import('../../../../src/commands/scan/create-scan-from-github.mts')

    const result = await createScanFromGithub({
      all: false,
      githubApiUrl: '',
      githubToken: '',
      interactive: false,
      orgGithub: 'org',
      orgSlug: 'org',
      outputKind: 'text',
      repos: 'repo-a,repo-b,repo-c',
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toBe('GitHub abuse detection triggered')
    }
    expect(mockWithGitHubRetry).toHaveBeenCalledTimes(1)
  })

  it('returns ok:false and stops on GitHub auth failure', async () => {
    mockWithGitHubRetry.mockResolvedValueOnce({
      ok: false,
      message: 'GitHub authentication failed',
      cause: 'Bad credentials.',
    })

    const { createScanFromGithub } =
      await import('../../../../src/commands/scan/create-scan-from-github.mts')

    const result = await createScanFromGithub({
      all: false,
      githubApiUrl: '',
      githubToken: '',
      interactive: false,
      orgGithub: 'org',
      orgSlug: 'org',
      outputKind: 'text',
      repos: 'repo-a,repo-b',
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toBe('GitHub authentication failed')
    }
    expect(mockWithGitHubRetry).toHaveBeenCalledTimes(1)
  })

  it('returns "All repos failed to scan" when every repo errors with a non-blocking reason', async () => {
    // Each repo's getRepoDetails fails with a non-rate-limit error;
    // the loop should finish all repos and return the catch-all error.
    mockWithGitHubRetry.mockResolvedValue({
      ok: false,
      message: 'GitHub resource not found',
      cause: 'Not found.',
    })

    const { createScanFromGithub } =
      await import('../../../../src/commands/scan/create-scan-from-github.mts')

    const result = await createScanFromGithub({
      all: false,
      githubApiUrl: '',
      githubToken: '',
      interactive: false,
      orgGithub: 'org',
      orgSlug: 'org',
      outputKind: 'text',
      repos: 'repo-a,repo-b',
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toBe('All repos failed to scan')
      expect(result.cause).toContain('repo-a')
    }
    // Both repos should have been attempted (no short-circuit for 404).
    expect(mockWithGitHubRetry).toHaveBeenCalledTimes(2)
  })

  it('uses fetchListAllRepos when all=true (lines 57-64)', async () => {
    const { fetchListAllRepos } =
      await import('../../../../src/commands/repository/fetch-list-all-repos.mts')
    vi.mocked(fetchListAllRepos).mockResolvedValueOnce({
      ok: true,
      data: { results: [{ slug: 'a' }, { slug: 'b' }] },
    } as unknown)
    // Make all repos fail with a quick 404 so the test exits cleanly.
    mockWithGitHubRetry.mockResolvedValue({
      ok: false,
      message: 'GitHub resource not found',
      cause: 'Not found.',
    })
    const { createScanFromGithub } =
      await import('../../../../src/commands/scan/create-scan-from-github.mts')
    const result = await createScanFromGithub({
      all: true,
      githubApiUrl: '',
      githubToken: '',
      interactive: false,
      orgGithub: 'org',
      orgSlug: 'org',
      outputKind: 'text',
      repos: '',
    })
    expect(fetchListAllRepos).toHaveBeenCalled()
    expect(result.ok).toBe(false)
  })

  it('returns ok:false on fetchListAllRepos failure (lines 61-62)', async () => {
    const { fetchListAllRepos } =
      await import('../../../../src/commands/repository/fetch-list-all-repos.mts')
    vi.mocked(fetchListAllRepos).mockResolvedValueOnce({
      ok: false,
      message: 'API Error',
      cause: 'Something broke',
    } as unknown)
    const { createScanFromGithub } =
      await import('../../../../src/commands/scan/create-scan-from-github.mts')
    const result = await createScanFromGithub({
      all: true,
      githubApiUrl: '',
      githubToken: '',
      interactive: false,
      orgGithub: 'org',
      orgSlug: 'org',
      outputKind: 'text',
      repos: '',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toBe('API Error')
    }
  })

  it('returns "No repo found" when targetRepos is empty (lines 73-79)', async () => {
    const { fetchListAllRepos } =
      await import('../../../../src/commands/repository/fetch-list-all-repos.mts')
    vi.mocked(fetchListAllRepos).mockResolvedValueOnce({
      ok: true,
      data: { results: [] },
    } as unknown)
    const { createScanFromGithub } =
      await import('../../../../src/commands/scan/create-scan-from-github.mts')
    const result = await createScanFromGithub({
      all: true,
      githubApiUrl: '',
      githubToken: '',
      interactive: false,
      orgGithub: 'org',
      orgSlug: 'org',
      outputKind: 'text',
      repos: '',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toBe('No repo found')
    }
  })
})
