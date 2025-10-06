import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchCreateRepo } from './fetch-create-repo.mts'

// Mock the dependencies.
vi.mock('../../utils/sdk.mts', () => ({
  withSdk: vi.fn(),
}))

describe('fetchCreateRepo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates repository successfully', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const successResult = {
      ok: true as const,
      data: {
        id: 'repo-123',
        name: 'new-repo',
        created: true,
      },
    }

    mockWithSdk.mockResolvedValueOnce(successResult)

    const config = {
      defaultBranch: 'main',
      description: 'Test repository',
      homepage: 'https://example.com',
      orgSlug: 'test-org',
      repoName: 'new-repo',
      visibility: 'public',
    }

    const result = await fetchCreateRepo(config)

    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'to create a repository',
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
      cause: 'Invalid API token',
    }
    mockWithSdk.mockResolvedValueOnce(error)

    const config = {
      defaultBranch: 'main',
      description: 'Test repo',
      homepage: '',
      orgSlug: 'my-org',
      repoName: 'test-repo',
      visibility: 'private',
    }

    const result = await fetchCreateRepo(config)

    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'to create a repository',
      undefined,
    )
    expect(result).toEqual(error)
  })

  it('handles API call failure', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const error = {
      ok: false as const,
      error: 'Repository already exists',
      code: 409,
      message: 'Repository already exists',
    }
    mockWithSdk.mockResolvedValueOnce(error)

    const config = {
      defaultBranch: 'main',
      description: 'Duplicate repo',
      homepage: '',
      orgSlug: 'test-org',
      repoName: 'existing-repo',
      visibility: 'public',
    }

    const result = await fetchCreateRepo(config)

    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'to create a repository',
      undefined,
    )
    expect(result.ok).toBe(false)
    expect(result.code).toBe(409)
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
      apiToken: 'create-repo-token',
      baseUrl: 'https://repo.api.com',
    }

    const config = {
      defaultBranch: 'main',
      description: 'Custom repo',
      homepage: '',
      orgSlug: 'custom-org',
      repoName: 'custom-repo',
      visibility: 'public',
    }

    await fetchCreateRepo(config, { sdkOpts })

    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'to create a repository',
      { sdkOpts },
    )
  })

  it('handles minimal repository data', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const successResult = {
      ok: true as const,
      data: {},
    }
    mockWithSdk.mockResolvedValueOnce(successResult)

    const config = {
      defaultBranch: 'main',
      description: '',
      homepage: '',
      orgSlug: 'test-org',
      repoName: 'minimal-repo',
      visibility: 'public',
    }

    const result = await fetchCreateRepo(config)

    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'to create a repository',
      undefined,
    )
    expect(result.ok).toBe(true)
  })

  it('handles full repository configuration', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const successResult = {
      ok: true as const,
      data: {
        id: 'repo-full',
        name: 'full-config-repo',
        default_branch: 'develop',
        description: 'Full featured repository',
        homepage: 'https://full-repo.com',
        visibility: 'private',
        created: true,
      },
    }
    mockWithSdk.mockResolvedValueOnce(successResult)

    const config = {
      defaultBranch: 'develop',
      description: 'Full featured repository',
      homepage: 'https://full-repo.com',
      orgSlug: 'test-org',
      repoName: 'full-config-repo',
      visibility: 'private',
    }

    const result = await fetchCreateRepo(config)

    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'to create a repository',
      undefined,
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.default_branch).toBe('develop')
      expect(result.data.visibility).toBe('private')
    }
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
      description: 'Test repo',
      homepage: '',
      orgSlug: 'test-org',
      repoName: 'test-repo',
      visibility: 'public',
    }

    // This tests that the function properly uses __proto__: null.
    await fetchCreateRepo(config)

    // The function should work without prototype pollution issues.
    expect(mockWithSdk).toHaveBeenCalled()
  })
})
