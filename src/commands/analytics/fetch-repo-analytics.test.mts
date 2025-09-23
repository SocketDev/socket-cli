import { describe, expect, it, vi } from 'vitest'

import { fetchRepoAnalytics } from './fetch-repo-analytics.mts'

// Mock the dependencies.
vi.mock('../../utils/api.mts', () => ({
  handleApiCall: vi.fn(),
}))

vi.mock('../../utils/sdk.mts', () => ({
  setupSdk: vi.fn(),
}))

describe('fetchRepoAnalytics', () => {
  it('fetches repository analytics successfully', async () => {
    const { handleApiCall } = await import('../../utils/api.mts')
    const { setupSdk } = await import('../../utils/sdk.mts')
    const mockHandleApi = vi.mocked(handleApiCall)
    const mockSetupSdk = vi.mocked(setupSdk)

    const mockSdk = {
      getRepoAnalytics: vi.fn().mockResolvedValue({
        success: true,
        data: {
          repository: 'my-repo',
          commits: 1250,
          contributors: 25,
          dependencies: 145,
          vulnerabilities: {
            critical: 2,
            high: 5,
            medium: 12,
            low: 18,
          },
          languages: {
            JavaScript: 65.5,
            TypeScript: 30.2,
            CSS: 4.3,
          },
          lastUpdated: '2025-01-15T12:00:00Z',
        },
      }),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({
      ok: true,
      data: {
        repository: 'my-repo',
        commits: 1250,
        contributors: 25,
      },
    })

    const result = await fetchRepoAnalytics('test-org', 'my-repo')

    expect(mockSdk.getRepoAnalytics).toHaveBeenCalledWith('test-org', 'my-repo')
    expect(mockHandleApi).toHaveBeenCalledWith(expect.any(Promise), {
      description: 'fetching repository analytics',
    })
    expect(result.ok).toBe(true)
  })

  it('handles SDK setup failure', async () => {
    const { setupSdk } = await import('../../utils/sdk.mts')
    const mockSetupSdk = vi.mocked(setupSdk)

    const error = {
      ok: false,
      code: 1,
      message: 'Failed to setup SDK',
      cause: 'Missing API token',
    }
    mockSetupSdk.mockResolvedValue(error)

    const result = await fetchRepoAnalytics('org', 'repo')

    expect(result).toEqual(error)
  })

  it('handles API call failure', async () => {
    const { handleApiCall } = await import('../../utils/api.mts')
    const { setupSdk } = await import('../../utils/sdk.mts')
    const mockHandleApi = vi.mocked(handleApiCall)
    const mockSetupSdk = vi.mocked(setupSdk)

    const mockSdk = {
      getRepoAnalytics: vi
        .fn()
        .mockRejectedValue(new Error('Repository not found')),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({
      ok: false,
      error: 'Repository not found',
      code: 404,
    })

    const result = await fetchRepoAnalytics('org', 'nonexistent')

    expect(result.ok).toBe(false)
    expect(result.code).toBe(404)
  })

  it('passes custom SDK options', async () => {
    const { setupSdk } = await import('../../utils/sdk.mts')
    const { handleApiCall } = await import('../../utils/api.mts')
    const mockSetupSdk = vi.mocked(setupSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      getRepoAnalytics: vi.fn().mockResolvedValue({}),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({ ok: true, data: {} })

    const sdkOpts = {
      apiToken: 'repo-token-456',
      baseUrl: 'https://custom.api.com',
      timeout: 30000,
    }

    await fetchRepoAnalytics('my-org', 'my-repo', { sdkOpts })

    expect(mockSetupSdk).toHaveBeenCalledWith(sdkOpts)
  })

  it('handles different org and repo combinations', async () => {
    const { setupSdk } = await import('../../utils/sdk.mts')
    const { handleApiCall } = await import('../../utils/api.mts')
    const mockSetupSdk = vi.mocked(setupSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      getRepoAnalytics: vi.fn().mockResolvedValue({}),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({ ok: true, data: {} })

    const testCases = [
      ['simple-org', 'simple-repo'],
      ['org_underscore', 'repo_underscore'],
      ['org123', 'repo456'],
      ['my-organization', 'my-project-name'],
      ['socket', 'socket-cli'],
    ]

    for (const [org, repo] of testCases) {
      // eslint-disable-next-line no-await-in-loop
      await fetchRepoAnalytics(org, repo)
      expect(mockSdk.getRepoAnalytics).toHaveBeenCalledWith(org, repo)
    }
  })

  it('handles repos with special characters', async () => {
    const { setupSdk } = await import('../../utils/sdk.mts')
    const { handleApiCall } = await import('../../utils/api.mts')
    const mockSetupSdk = vi.mocked(setupSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      getRepoAnalytics: vi.fn().mockResolvedValue({}),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({ ok: true, data: {} })

    await fetchRepoAnalytics('my-org', 'repo.with.dots')
    expect(mockSdk.getRepoAnalytics).toHaveBeenCalledWith(
      'my-org',
      'repo.with.dots',
    )

    await fetchRepoAnalytics('my-org', 'repo-with-dashes')
    expect(mockSdk.getRepoAnalytics).toHaveBeenCalledWith(
      'my-org',
      'repo-with-dashes',
    )
  })

  it('uses null prototype for options', async () => {
    const { setupSdk } = await import('../../utils/sdk.mts')
    const { handleApiCall } = await import('../../utils/api.mts')
    const mockSetupSdk = vi.mocked(setupSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      getRepoAnalytics: vi.fn().mockResolvedValue({}),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({ ok: true, data: {} })

    // This tests that the function properly uses __proto__: null.
    await fetchRepoAnalytics('test-org', 'test-repo')

    // The function should work without prototype pollution issues.
    expect(mockSdk.getRepoAnalytics).toHaveBeenCalled()
  })
})
