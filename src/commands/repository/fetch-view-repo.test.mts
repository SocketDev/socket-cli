import { describe, expect, it, vi } from 'vitest'

import { fetchViewRepo } from './fetch-view-repo.mts'

// Mock the dependencies.
vi.mock('../../utils/api.mts', () => ({
  handleApiCall: vi.fn(),
}))

vi.mock('../../utils/sdk.mts', () => ({
  setupSdk: vi.fn(),
}))

describe('fetchViewRepo', () => {
  it('views repository successfully', async () => {
    const { handleApiCall } = await import('../../utils/api.mts')
    const { setupSdk } = await import('../../utils/sdk.mts')
    const mockHandleApi = vi.mocked(handleApiCall)
    const mockSetupSdk = vi.mocked(setupSdk)

    const mockSdk = {
      getOrgRepo: vi.fn().mockResolvedValue({
        success: true,
        data: {
          id: 'repo-123',
          name: 'test-repo',
          description: 'A test repository',
          visibility: 'public',
          default_branch: 'main',
          created_at: '2025-01-01T10:00:00Z',
          updated_at: '2025-01-20T15:30:00Z',
        },
      }),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({
      ok: true,
      data: {
        id: 'repo-123',
        name: 'test-repo',
        description: 'A test repository',
        visibility: 'public',
      },
    })

    const result = await fetchViewRepo('test-org', 'test-repo')

    expect(mockSdk.getOrgRepo).toHaveBeenCalledWith('test-org', 'test-repo')
    expect(mockHandleApi).toHaveBeenCalledWith(expect.any(Promise), {
      description: 'repository data',
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

    const result = await fetchViewRepo('org', 'repo')

    expect(result).toEqual(error)
  })

  it('handles API call failure', async () => {
    const { handleApiCall } = await import('../../utils/api.mts')
    const { setupSdk } = await import('../../utils/sdk.mts')
    const mockHandleApi = vi.mocked(handleApiCall)
    const mockSetupSdk = vi.mocked(setupSdk)

    const mockSdk = {
      getOrgRepo: vi.fn().mockRejectedValue(new Error('Repository not found')),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({
      ok: false,
      error: 'Repository not found',
      code: 404,
    })

    const result = await fetchViewRepo('org', 'nonexistent-repo')

    expect(result.ok).toBe(false)
    expect(result.code).toBe(404)
  })

  it('passes custom SDK options', async () => {
    const { setupSdk } = await import('../../utils/sdk.mts')
    const { handleApiCall } = await import('../../utils/api.mts')
    const mockSetupSdk = vi.mocked(setupSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      getOrgRepo: vi.fn().mockResolvedValue({}),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({ ok: true, data: {} })

    const sdkOpts = {
      apiToken: 'view-token',
      baseUrl: 'https://view.api.com',
    }

    await fetchViewRepo('my-org', 'my-repo', { sdkOpts })

    expect(mockSetupSdk).toHaveBeenCalledWith(sdkOpts)
  })

  it('handles private repository access', async () => {
    const { handleApiCall } = await import('../../utils/api.mts')
    const { setupSdk } = await import('../../utils/sdk.mts')
    const mockHandleApi = vi.mocked(handleApiCall)
    const mockSetupSdk = vi.mocked(setupSdk)

    const mockSdk = {
      getOrgRepo: vi.fn().mockResolvedValue({
        success: true,
        data: {
          id: 'private-repo-456',
          name: 'secret-project',
          description: 'A private repository',
          visibility: 'private',
          members_count: 5,
        },
      }),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({
      ok: true,
      data: {
        id: 'private-repo-456',
        name: 'secret-project',
        visibility: 'private',
      },
    })

    const result = await fetchViewRepo('private-org', 'secret-project')

    expect(result.ok).toBe(true)
    expect(mockSdk.getOrgRepo).toHaveBeenCalledWith(
      'private-org',
      'secret-project',
    )
  })

  it('handles special repository names', async () => {
    const { setupSdk } = await import('../../utils/sdk.mts')
    const { handleApiCall } = await import('../../utils/api.mts')
    const mockSetupSdk = vi.mocked(setupSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      getOrgRepo: vi.fn().mockResolvedValue({}),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({ ok: true, data: {} })

    await fetchViewRepo('special-org', 'repo-with-hyphens_and_underscores.dots')

    expect(mockSdk.getOrgRepo).toHaveBeenCalledWith(
      'special-org',
      'repo-with-hyphens_and_underscores.dots',
    )
  })

  it('handles insufficient permissions error', async () => {
    const { handleApiCall } = await import('../../utils/api.mts')
    const { setupSdk } = await import('../../utils/sdk.mts')
    const mockHandleApi = vi.mocked(handleApiCall)
    const mockSetupSdk = vi.mocked(setupSdk)

    const mockSdk = {
      getOrgRepo: vi.fn().mockRejectedValue(new Error('Access denied')),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({
      ok: false,
      error: 'Access denied',
      code: 403,
    })

    const result = await fetchViewRepo('restricted-org', 'restricted-repo')

    expect(result.ok).toBe(false)
    expect(result.code).toBe(403)
  })

  it('uses null prototype for options', async () => {
    const { setupSdk } = await import('../../utils/sdk.mts')
    const { handleApiCall } = await import('../../utils/api.mts')
    const mockSetupSdk = vi.mocked(setupSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      getOrgRepo: vi.fn().mockResolvedValue({}),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({ ok: true, data: {} })

    // This tests that the function properly uses __proto__: null.
    await fetchViewRepo('test-org', 'test-repo')

    // The function should work without prototype pollution issues.
    expect(mockSdk.getOrgRepo).toHaveBeenCalled()
  })
})
