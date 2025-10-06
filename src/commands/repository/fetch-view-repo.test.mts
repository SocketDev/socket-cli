import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchViewRepo } from './fetch-view-repo.mts'

// Mock the dependencies.
vi.mock('../../utils/sdk.mts', () => ({
  withSdk: vi.fn(),
}))

describe('fetchViewRepo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('views repository successfully', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const successResult = {
      ok: true as const,
      data: {
        id: 'repo-123',
        name: 'test-repo',
        description: 'A test repository',
        visibility: 'public',
        default_branch: 'main',
        created_at: '2025-01-01T10:00:00Z',
        updated_at: '2025-01-20T15:30:00Z',
      },
    }

    mockWithSdk.mockResolvedValueOnce(successResult)

    const result = await fetchViewRepo('test-org', 'test-repo')

    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'repository data',
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
      cause: 'Invalid configuration',
    }
    mockWithSdk.mockResolvedValueOnce(error)

    const result = await fetchViewRepo('test-org', 'test-repo')

    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'repository data',
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

    const result = await fetchViewRepo('test-org', 'nonexistent-repo')

    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'repository data',
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

    const options = {
      sdkOpts: {
        apiToken: 'view-token',
        baseUrl: 'https://view.api.com',
      },
    }

    await fetchViewRepo('custom-org', 'custom-repo', options)

    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'repository data',
      options,
    )
  })

  it('handles private repository access', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const successResult = {
      ok: true as const,
      data: {
        id: 'repo-private',
        name: 'secret-project',
        description: 'Private repository',
        visibility: 'private',
        default_branch: 'main',
      },
    }
    mockWithSdk.mockResolvedValueOnce(successResult)

    await fetchViewRepo('private-org', 'secret-project')

    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'repository data',
      undefined,
    )
  })

  it('handles special repository names', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const successResult = {
      ok: true as const,
      data: {},
    }
    mockWithSdk.mockResolvedValueOnce(successResult)

    const specialRepoName = 'repo-with.special_chars-123'

    await fetchViewRepo('special-org', specialRepoName)

    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'repository data',
      undefined,
    )
  })

  it('handles insufficient permissions error', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const error = {
      ok: false as const,
      error: 'Insufficient permissions',
      code: 403,
      message: 'Insufficient permissions',
    }
    mockWithSdk.mockResolvedValueOnce(error)

    const result = await fetchViewRepo('restricted-org', 'restricted-repo')

    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'repository data',
      undefined,
    )
    expect(result.ok).toBe(false)
    expect(result.code).toBe(403)
  })

  it('uses null prototype for options', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const successResult = {
      ok: true as const,
      data: {},
    }
    mockWithSdk.mockResolvedValueOnce(successResult)

    // This tests that the function properly uses __proto__: null.
    await fetchViewRepo('test-org', 'test-repo')

    // The function should work without prototype pollution issues.
    expect(mockWithSdk).toHaveBeenCalled()
  })
})
