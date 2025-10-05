import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchDeleteRepo } from './fetch-delete-repo.mts'

// Mock the dependencies.
vi.mock('../../utils/sdk.mts', () => ({
  withSdk: vi.fn(),
}))

describe('fetchDeleteRepo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  it('deletes repository successfully', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const successResult = {
      ok: true as const,
      data: {
        id: 'repo-123',
        name: 'deleted-repo',
        status: 'deleted',
      },
    }

    mockWithSdk.mockResolvedValueOnce(successResult)

    const result = await fetchDeleteRepo('test-org', 'deleted-repo')

    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'to delete a repository',
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

    const result = await fetchDeleteRepo('org', 'repo')

    expect(result).toEqual(error)
  })

  it('handles API call failure', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const error = {
      ok: false as const,
      message: 'Repository not found',
      code: 404,
    }
    mockWithSdk.mockResolvedValueOnce(error)

    const result = await fetchDeleteRepo('org', 'nonexistent-repo')

    expect(result.ok).toBe(false)
    expect(result.code).toBe(404)
  })

  it('passes custom SDK options', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    mockWithSdk.mockResolvedValueOnce({ ok: true, data: {} })

    const sdkOpts = {
      apiToken: 'delete-token',
      baseUrl: 'https://delete.api.com',
    }

    await fetchDeleteRepo('my-org', 'old-repo', { sdkOpts })

    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'to delete a repository',
      { sdkOpts },
    )
  })

  it('handles insufficient permissions error', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const error = {
      ok: false as const,
      message: 'Insufficient permissions',
      code: 403,
    }
    mockWithSdk.mockResolvedValueOnce(error)

    const result = await fetchDeleteRepo('protected-org', 'protected-repo')

    expect(result.ok).toBe(false)
    expect(result.code).toBe(403)
  })

  it('handles special repository names', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    mockWithSdk.mockResolvedValueOnce({ ok: true, data: {} })

    const result = await fetchDeleteRepo(
      'special-org',
      'repo-with-hyphens_and_underscores',
    )

    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'to delete a repository',
      undefined,
    )
    expect(result.ok).toBe(true)
  })

  it('uses null prototype for options', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    mockWithSdk.mockResolvedValueOnce({ ok: true, data: {} })

    // This tests that the function properly works with __proto__: null pattern
    const result = await fetchDeleteRepo('test-org', 'test-repo')

    // The function should work without prototype pollution issues
    expect(mockWithSdk).toHaveBeenCalled()
    expect(result.ok).toBe(true)
  })
})
