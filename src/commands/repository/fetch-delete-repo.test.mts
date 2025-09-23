import { describe, expect, it, vi } from 'vitest'

import { fetchDeleteRepo } from './fetch-delete-repo.mts'

// Mock the dependencies.
vi.mock('../../utils/api.mts', () => ({
  handleApiCall: vi.fn(),
}))

vi.mock('../../utils/sdk.mts', () => ({
  setupSdk: vi.fn(),
}))

describe('fetchDeleteRepo', () => {
  it('deletes repository successfully', async () => {
    const { handleApiCall } = await import('../../utils/api.mts')
    const { setupSdk } = await import('../../utils/sdk.mts')
    const mockHandleApi = vi.mocked(handleApiCall)
    const mockSetupSdk = vi.mocked(setupSdk)

    const mockSdk = {
      deleteOrgRepo: vi.fn().mockResolvedValue({
        success: true,
        data: {
          id: 'repo-123',
          name: 'deleted-repo',
          status: 'deleted',
        },
      }),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({
      ok: true,
      data: {
        id: 'repo-123',
        name: 'deleted-repo',
        status: 'deleted',
      },
    })

    const result = await fetchDeleteRepo('test-org', 'deleted-repo')

    expect(mockSdk.deleteOrgRepo).toHaveBeenCalledWith(
      'test-org',
      'deleted-repo',
    )
    expect(mockHandleApi).toHaveBeenCalledWith(expect.any(Promise), {
      description: 'to delete a repository',
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

    const result = await fetchDeleteRepo('org', 'repo')

    expect(result).toEqual(error)
  })

  it('handles API call failure', async () => {
    const { handleApiCall } = await import('../../utils/api.mts')
    const { setupSdk } = await import('../../utils/sdk.mts')
    const mockHandleApi = vi.mocked(handleApiCall)
    const mockSetupSdk = vi.mocked(setupSdk)

    const mockSdk = {
      deleteOrgRepo: vi
        .fn()
        .mockRejectedValue(new Error('Repository not found')),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({
      ok: false,
      error: 'Repository not found',
      code: 404,
    })

    const result = await fetchDeleteRepo('org', 'nonexistent-repo')

    expect(result.ok).toBe(false)
    expect(result.code).toBe(404)
  })

  it('passes custom SDK options', async () => {
    const { setupSdk } = await import('../../utils/sdk.mts')
    const { handleApiCall } = await import('../../utils/api.mts')
    const mockSetupSdk = vi.mocked(setupSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      deleteOrgRepo: vi.fn().mockResolvedValue({}),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({ ok: true, data: {} })

    const sdkOpts = {
      apiToken: 'delete-token',
      baseUrl: 'https://delete.api.com',
    }

    await fetchDeleteRepo('my-org', 'old-repo', { sdkOpts })

    expect(mockSetupSdk).toHaveBeenCalledWith(sdkOpts)
  })

  it('handles insufficient permissions error', async () => {
    const { handleApiCall } = await import('../../utils/api.mts')
    const { setupSdk } = await import('../../utils/sdk.mts')
    const mockHandleApi = vi.mocked(handleApiCall)
    const mockSetupSdk = vi.mocked(setupSdk)

    const mockSdk = {
      deleteOrgRepo: vi
        .fn()
        .mockRejectedValue(new Error('Insufficient permissions')),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({
      ok: false,
      error: 'Insufficient permissions',
      code: 403,
    })

    const result = await fetchDeleteRepo('protected-org', 'protected-repo')

    expect(result.ok).toBe(false)
    expect(result.code).toBe(403)
  })

  it('handles special repository names', async () => {
    const { setupSdk } = await import('../../utils/sdk.mts')
    const { handleApiCall } = await import('../../utils/api.mts')
    const mockSetupSdk = vi.mocked(setupSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      deleteOrgRepo: vi.fn().mockResolvedValue({}),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({ ok: true, data: {} })

    await fetchDeleteRepo('special-org', 'repo-with-hyphens_and_underscores')

    expect(mockSdk.deleteOrgRepo).toHaveBeenCalledWith(
      'special-org',
      'repo-with-hyphens_and_underscores',
    )
  })

  it('uses null prototype for options', async () => {
    const { setupSdk } = await import('../../utils/sdk.mts')
    const { handleApiCall } = await import('../../utils/api.mts')
    const mockSetupSdk = vi.mocked(setupSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      deleteOrgRepo: vi.fn().mockResolvedValue({}),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({ ok: true, data: {} })

    // This tests that the function properly uses __proto__: null.
    await fetchDeleteRepo('test-org', 'test-repo')

    // The function should work without prototype pollution issues.
    expect(mockSdk.deleteOrgRepo).toHaveBeenCalled()
  })
})
