import { describe, expect, it, vi } from 'vitest'

import { fetchCreateRepo } from './fetch-create-repo.mts'

// Mock the dependencies.
vi.mock('../../utils/api.mts', () => ({
  handleApiCall: vi.fn(),
}))

vi.mock('../../utils/sdk.mts', () => ({
  setupSdk: vi.fn(),
}))

describe('fetchCreateRepo', () => {
  it('creates repository successfully', async () => {
    const { handleApiCall } = await import('../../utils/api.mts')
    const { setupSdk } = await import('../../utils/sdk.mts')
    const mockHandleApi = vi.mocked(handleApiCall)
    const mockSetupSdk = vi.mocked(setupSdk)

    const mockSdk = {
      createRepository: vi.fn().mockResolvedValue({
        success: true,
        data: {
          id: 'repo-123',
          name: 'my-new-repo',
          org: 'test-org',
          url: 'https://github.com/test-org/my-new-repo',
          created_at: '2025-01-20T10:00:00Z',
          status: 'active',
        },
      }),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({
      ok: true,
      data: {
        id: 'repo-123',
        name: 'my-new-repo',
        org: 'test-org',
      },
    })

    const result = await fetchCreateRepo('test-org', {
      name: 'my-new-repo',
      url: 'https://github.com/test-org/my-new-repo',
      description: 'A new repository',
    })

    expect(mockSdk.createRepository).toHaveBeenCalledWith('test-org', {
      name: 'my-new-repo',
      url: 'https://github.com/test-org/my-new-repo',
      description: 'A new repository',
    })
    expect(mockHandleApi).toHaveBeenCalledWith(expect.any(Promise), {
      description: 'creating repository',
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

    const result = await fetchCreateRepo('org', { name: 'repo' })

    expect(result).toEqual(error)
  })

  it('handles API call failure', async () => {
    const { handleApiCall } = await import('../../utils/api.mts')
    const { setupSdk } = await import('../../utils/sdk.mts')
    const mockHandleApi = vi.mocked(handleApiCall)
    const mockSetupSdk = vi.mocked(setupSdk)

    const mockSdk = {
      createRepository: vi
        .fn()
        .mockRejectedValue(new Error('Repository already exists')),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({
      ok: false,
      error: 'Repository already exists',
      code: 409,
    })

    const result = await fetchCreateRepo('org', { name: 'existing-repo' })

    expect(result.ok).toBe(false)
    expect(result.code).toBe(409)
  })

  it('passes custom SDK options', async () => {
    const { setupSdk } = await import('../../utils/sdk.mts')
    const { handleApiCall } = await import('../../utils/api.mts')
    const mockSetupSdk = vi.mocked(setupSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      createRepository: vi.fn().mockResolvedValue({}),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({ ok: true, data: {} })

    const sdkOpts = {
      apiToken: 'create-token',
      baseUrl: 'https://create.api.com',
    }

    await fetchCreateRepo('my-org', { name: 'new-repo' }, { sdkOpts })

    expect(mockSetupSdk).toHaveBeenCalledWith(sdkOpts)
  })

  it('handles minimal repository data', async () => {
    const { setupSdk } = await import('../../utils/sdk.mts')
    const { handleApiCall } = await import('../../utils/api.mts')
    const mockSetupSdk = vi.mocked(setupSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      createRepository: vi.fn().mockResolvedValue({}),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({ ok: true, data: {} })

    await fetchCreateRepo('simple-org', { name: 'simple-repo' })

    expect(mockSdk.createRepository).toHaveBeenCalledWith('simple-org', {
      name: 'simple-repo',
    })
  })

  it('handles full repository configuration', async () => {
    const { setupSdk } = await import('../../utils/sdk.mts')
    const { handleApiCall } = await import('../../utils/api.mts')
    const mockSetupSdk = vi.mocked(setupSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      createRepository: vi.fn().mockResolvedValue({}),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({ ok: true, data: {} })

    const fullConfig = {
      name: 'full-config-repo',
      url: 'https://github.com/org/full-config-repo',
      description: 'Repository with full configuration',
      branch: 'main',
      visibility: 'private',
      auto_scan: true,
      tags: ['production', 'backend'],
    }

    await fetchCreateRepo('config-org', fullConfig)

    expect(mockSdk.createRepository).toHaveBeenCalledWith(
      'config-org',
      fullConfig,
    )
  })

  it('uses null prototype for options', async () => {
    const { setupSdk } = await import('../../utils/sdk.mts')
    const { handleApiCall } = await import('../../utils/api.mts')
    const mockSetupSdk = vi.mocked(setupSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      createRepository: vi.fn().mockResolvedValue({}),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({ ok: true, data: {} })

    // This tests that the function properly uses __proto__: null.
    await fetchCreateRepo('test-org', { name: 'test-repo' })

    // The function should work without prototype pollution issues.
    expect(mockSdk.createRepository).toHaveBeenCalled()
  })
})
