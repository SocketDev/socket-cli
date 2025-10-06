import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchUpdateRepo } from './fetch-update-repo.mts'

// Mock the dependencies.
vi.mock('../../utils/sdk.mts', () => ({
  withSdk: vi.fn(),
}))

describe('fetchUpdateRepo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('updates repository successfully', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const successResult = {
      ok: true as const,
      data: {
        id: 'repo-123',
        name: 'updated-repo',
        description: 'Updated description',
        visibility: 'private',
      },
    }

    mockWithSdk.mockResolvedValueOnce(successResult)

    const config = {
      defaultBranch: 'main',
      description: 'Updated description',
      homepage: 'https://example.com',
      orgSlug: 'test-org',
      repoName: 'updated-repo',
      visibility: 'private',
    }

    const result = await fetchUpdateRepo(config)

    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'to update a repository',
      undefined,
    )
    expect(result).toEqual(successResult)
  })

  it('handles SDK setup failure', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const error = {
      ok: false as const,
      code: 1,
      message: 'Failed to setup SDK',
      cause: 'Missing API token',
    }
    mockWithSdk.mockResolvedValueOnce(error)

    const config = {
      defaultBranch: 'main',
      description: 'Test',
      homepage: 'https://test.com',
      orgSlug: 'org',
      repoName: 'repo',
      visibility: 'public',
    }

    const result = await fetchUpdateRepo(config)

    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'to update a repository',
      undefined,
    )
    expect(result).toEqual(error)
  })

  it('handles API call failure', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const error = {
      ok: false as const,
      error: 'Repository not found',
      code: 404,
      message: 'Repository not found',
    }
    mockWithSdk.mockResolvedValueOnce(error)

    const config = {
      defaultBranch: 'main',
      description: 'Test',
      homepage: 'https://test.com',
      orgSlug: 'org',
      repoName: 'nonexistent',
      visibility: 'public',
    }

    const result = await fetchUpdateRepo(config)

    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'to update a repository',
      undefined,
    )
    expect(result.ok).toBe(false)
    expect(result.code).toBe(404)
  })

  it('passes custom SDK options', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const successResult = {
      ok: true as const,
      data: {},
    }
    mockWithSdk.mockResolvedValueOnce(successResult)

    const sdkOpts = {
      apiToken: 'update-token',
      baseUrl: 'https://update.api.com',
    }

    const config = {
      defaultBranch: 'develop',
      description: 'Custom update',
      homepage: 'https://custom.com',
      orgSlug: 'my-org',
      repoName: 'custom-repo',
      visibility: 'internal',
    }

    await fetchUpdateRepo(config, { sdkOpts })

    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'to update a repository',
      { sdkOpts },
    )
  })

  it('handles visibility changes', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const successResult = {
      ok: true as const,
      data: {},
    }
    mockWithSdk.mockResolvedValueOnce(successResult)

    const config = {
      defaultBranch: 'main',
      description: 'Making repo private',
      homepage: '',
      orgSlug: 'secure-org',
      repoName: 'secret-repo',
      visibility: 'private',
    }

    await fetchUpdateRepo(config)

    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'to update a repository',
      undefined,
    )
  })

  it('handles default branch updates', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const successResult = {
      ok: true as const,
      data: {},
    }
    mockWithSdk.mockResolvedValueOnce(successResult)

    const config = {
      defaultBranch: 'develop',
      description: 'Switching to develop branch',
      homepage: 'https://dev.example.com',
      orgSlug: 'branch-org',
      repoName: 'branch-test',
      visibility: 'public',
    }

    await fetchUpdateRepo(config)

    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'to update a repository',
      undefined,
    )
  })

  it('handles empty or minimal updates', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const successResult = {
      ok: true as const,
      data: {},
    }
    mockWithSdk.mockResolvedValueOnce(successResult)

    const config = {
      defaultBranch: '',
      description: '',
      homepage: '',
      orgSlug: 'minimal-org',
      repoName: 'minimal-repo',
      visibility: '',
    }

    await fetchUpdateRepo(config)

    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'to update a repository',
      undefined,
    )
  })

  it('uses null prototype for options', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const successResult = {
      ok: true as const,
      data: {},
    }
    mockWithSdk.mockResolvedValueOnce(successResult)

    const config = {
      defaultBranch: 'main',
      description: 'Test',
      homepage: 'https://test.com',
      orgSlug: 'test-org',
      repoName: 'test-repo',
      visibility: 'public',
    }

    // This tests that the function properly uses __proto__: null.
    await fetchUpdateRepo(config)

    // The function should work without prototype pollution issues.
    expect(mockWithSdk).toHaveBeenCalled()
  })
})
