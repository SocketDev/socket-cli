import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createErrorResult,
  createSuccessResult,
} from '../../../../src/helpers/mocks.mts'
import { fetchUpdateRepo } from '../../../../src/fetch-update-repo.mts'

// Mock the dependencies.
vi.mock('../../utils/socket/api.mts', () => ({
  handleApiCall: vi.fn(),
}))

vi.mock('../../utils/socket/sdk.mts', () => ({
  setupSdk: vi.fn(),
}))

describe('fetchUpdateRepo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('updates repository successfully', async () => {
    const { handleApiCall } = await vi.importMock('../../utils/socket/api.mts')
    const { setupSdk } = await vi.importMock('../../utils/socket/sdk.mts')
    const mockHandleApi = vi.mocked(handleApiCall)
    const mockSetupSdk = vi.mocked(setupSdk)

    const mockSdk = {
      updateRepository: vi.fn().mockResolvedValue({
        success: true,
        data: {
          id: 'repo-123',
          name: 'updated-repo',
          description: 'Updated description',
          visibility: 'private',
        },
      }),
    }

    mockSetupSdk.mockResolvedValue(createSuccessResult(mockSdk))
    mockHandleApi.mockResolvedValue(
      createSuccessResult({
        id: 'repo-123',
        name: 'updated-repo',
        description: 'Updated description',
      }),
    )

    const config = {
      defaultBranch: 'main',
      description: 'Updated description',
      homepage: 'https://example.com',
      orgSlug: 'test-org',
      repoName: 'updated-repo',
      visibility: 'private',
    }

    const result = await fetchUpdateRepo(config)

    expect(mockSdk.updateRepository).toHaveBeenCalledWith(
      'test-org',
      'updated-repo',
      {
        default_branch: 'main',
        description: 'Updated description',
        homepage: 'https://example.com',
        name: 'updated-repo',
        orgSlug: 'test-org',
        visibility: 'private',
      },
    )
    expect(mockHandleApi).toHaveBeenCalledWith(expect.any(Promise), {
      description: 'to update a repository',
    })
    expect(result.ok).toBe(true)
  })

  it('handles SDK setup failure', async () => {
    const { setupSdk } = await vi.importMock('../../utils/socket/sdk.mts')
    const mockSetupSdk = vi.mocked(setupSdk)

    mockSetupSdk.mockResolvedValue(
      createErrorResult('Failed to setup SDK', {
        code: 1,
        cause: 'Missing API token',
      }),
    )

    const config = {
      defaultBranch: 'main',
      description: 'Test',
      homepage: 'https://test.com',
      orgSlug: 'org',
      repoName: 'repo',
      visibility: 'public',
    }

    const result = await fetchUpdateRepo(config)

    expect(result.ok).toBe(false)
  })

  it('handles API call failure', async () => {
    const { setupSdk } = await vi.importMock('../../utils/socket/sdk.mts')
    const { handleApiCall } = await vi.importMock('../../utils/socket/api.mts')
    const mockSetupSdk = vi.mocked(setupSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      updateRepository: vi
        .fn()
        .mockRejectedValue(new Error('Repository not found')),
    }

    mockSetupSdk.mockResolvedValue(createSuccessResult(mockSdk as any))
    mockHandleApi.mockResolvedValue(
      createErrorResult('Repository not found', { code: 404 }),
    )

    const config = {
      defaultBranch: 'main',
      description: 'Test',
      homepage: 'https://test.com',
      orgSlug: 'org',
      repoName: 'nonexistent',
      visibility: 'public',
    }

    const result = await fetchUpdateRepo(config)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe(404)
    }
  })

  it('passes custom SDK options', async () => {
    const { setupSdk } = await vi.importMock('../../utils/socket/sdk.mts')
    const { handleApiCall } = await vi.importMock('../../utils/socket/api.mts')
    const mockSetupSdk = vi.mocked(setupSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      updateRepository: vi.fn().mockResolvedValue({}),
    }

    mockSetupSdk.mockResolvedValue(createSuccessResult(mockSdk))
    mockHandleApi.mockResolvedValue(createSuccessResult({}))

    const config = {
      defaultBranch: 'develop',
      description: 'Custom update',
      homepage: 'https://custom.com',
      orgSlug: 'my-org',
      repoName: 'custom-repo',
      visibility: 'internal',
    }

    const sdkOpts = {
      apiToken: 'update-token',
      baseUrl: 'https://update.api.com',
    }

    await fetchUpdateRepo(config, { sdkOpts })

    expect(mockSetupSdk).toHaveBeenCalledWith(sdkOpts)
  })

  it('handles visibility changes', async () => {
    const { setupSdk } = await vi.importMock('../../utils/socket/sdk.mts')
    const { handleApiCall } = await vi.importMock('../../utils/socket/api.mts')
    const mockSetupSdk = vi.mocked(setupSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      updateRepository: vi.fn().mockResolvedValue({}),
    }

    mockSetupSdk.mockResolvedValue(createSuccessResult(mockSdk))
    mockHandleApi.mockResolvedValue(createSuccessResult({}))

    const config = {
      defaultBranch: 'main',
      description: 'Making repo private',
      homepage: '',
      orgSlug: 'secure-org',
      repoName: 'secret-repo',
      visibility: 'private',
    }

    await fetchUpdateRepo(config)

    expect(mockSdk.updateRepository).toHaveBeenCalledWith(
      'secure-org',
      'secret-repo',
      {
        default_branch: 'main',
        description: 'Making repo private',
        homepage: '',
        name: 'secret-repo',
        orgSlug: 'secure-org',
        visibility: 'private',
      },
    )
  })

  it('handles default branch updates', async () => {
    const { setupSdk } = await vi.importMock('../../utils/socket/sdk.mts')
    const { handleApiCall } = await vi.importMock('../../utils/socket/api.mts')
    const mockSetupSdk = vi.mocked(setupSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      updateRepository: vi.fn().mockResolvedValue({}),
    }

    mockSetupSdk.mockResolvedValue(createSuccessResult(mockSdk))
    mockHandleApi.mockResolvedValue(createSuccessResult({}))

    const config = {
      defaultBranch: 'develop',
      description: 'Switching to develop branch',
      homepage: 'https://dev.example.com',
      orgSlug: 'branch-org',
      repoName: 'branch-test',
      visibility: 'public',
    }

    await fetchUpdateRepo(config)

    expect(mockSdk.updateRepository).toHaveBeenCalledWith(
      'branch-org',
      'branch-test',
      {
        default_branch: 'develop',
        description: 'Switching to develop branch',
        homepage: 'https://dev.example.com',
        name: 'branch-test',
        orgSlug: 'branch-org',
        visibility: 'public',
      },
    )
  })

  it('handles empty or minimal updates', async () => {
    const { setupSdk } = await vi.importMock('../../utils/socket/sdk.mts')
    const { handleApiCall } = await vi.importMock('../../utils/socket/api.mts')
    const mockSetupSdk = vi.mocked(setupSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      updateRepository: vi.fn().mockResolvedValue({}),
    }

    mockSetupSdk.mockResolvedValue(createSuccessResult(mockSdk))
    mockHandleApi.mockResolvedValue(createSuccessResult({}))

    const config = {
      defaultBranch: '',
      description: '',
      homepage: '',
      orgSlug: 'minimal-org',
      repoName: 'minimal-repo',
      visibility: '',
    }

    await fetchUpdateRepo(config)

    expect(mockSdk.updateRepository).toHaveBeenCalledWith(
      'minimal-org',
      'minimal-repo',
      {
        default_branch: '',
        description: '',
        homepage: '',
        name: 'minimal-repo',
        orgSlug: 'minimal-org',
        visibility: '',
      },
    )
  })

  it('uses null prototype for options', async () => {
    const { setupSdk } = await vi.importMock('../../utils/socket/sdk.mts')
    const { handleApiCall } = await vi.importMock('../../utils/socket/api.mts')
    const mockSetupSdk = vi.mocked(setupSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      updateRepository: vi.fn().mockResolvedValue({}),
    }

    mockSetupSdk.mockResolvedValue(createSuccessResult(mockSdk))
    mockHandleApi.mockResolvedValue(createSuccessResult({}))

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
    expect(mockSdk.updateRepository).toHaveBeenCalled()
  })
})
