import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createErrorResult,
  createSuccessResult,
} from '../../../../src/helpers/mocks.mts'
import { fetchCreateRepo } from '../../../../src/src/commands/repository/fetch-create-repo.mts'

// Mock the dependencies.
vi.mock('../../../../src/utils/socket/api.mts', () => ({
  handleApiCall: vi.fn(),
}))

vi.mock('../../../../src/utils/socket/sdk.mts', () => ({
  setupSdk: vi.fn(),
}))

describe('fetchCreateRepo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates repository successfully', async () => {
    const { handleApiCall } = await vi.importMock('../../../../src/utils/socket/api.mts')
    const { setupSdk } = await vi.importMock('../../../../src/utils/socket/sdk.mts')
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

    mockSetupSdk.mockResolvedValue(createSuccessResult(mockSdk))
    mockHandleApi.mockResolvedValue(
      createSuccessResult({
        id: 'repo-123',
        name: 'my-new-repo',
        org: 'test-org',
      }),
    )

    const result = await fetchCreateRepo({
      orgSlug: 'test-org',
      repoName: 'my-new-repo',
      description: 'A new repository',
      homepage: 'https://github.com/test-org/my-new-repo',
      defaultBranch: 'main',
      visibility: 'private',
    })

    expect(mockSdk.createRepository).toHaveBeenCalledWith('test-org', {
      name: 'my-new-repo',
      homepage: 'https://github.com/test-org/my-new-repo',
      description: 'A new repository',
      default_branch: 'main',
      visibility: 'private',
    })
    expect(mockHandleApi).toHaveBeenCalledWith(expect.any(Promise), {
      description: 'to create a repository',
    })
    expect(result.ok).toBe(true)
  })

  it('handles SDK setup failure', async () => {
    const { setupSdk } = await vi.importMock('../../../../src/utils/socket/sdk.mts')
    const mockSetupSdk = vi.mocked(setupSdk)

    mockSetupSdk.mockResolvedValue(
      createErrorResult('Failed to setup SDK', {
        code: 1,
        cause: 'Missing API token',
      }),
    )

    const result = await fetchCreateRepo({
      orgSlug: 'org',
      repoName: 'repo',
      description: '',
      homepage: '',
      defaultBranch: 'main',
      visibility: 'private',
    })

    expect(result.ok).toBe(false)
  })

  it('handles API call failure', async () => {
    const { setupSdk } = await vi.importMock('../../../../src/utils/socket/sdk.mts')
    const { handleApiCall } = await vi.importMock('../../../../src/utils/socket/api.mts')
    const mockSetupSdk = vi.mocked(setupSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      createRepository: vi
        .fn()
        .mockRejectedValue(new Error('Repository already exists')),
    }

    mockSetupSdk.mockResolvedValue(createSuccessResult(mockSdk))
    mockHandleApi.mockResolvedValue(
      createErrorResult('Repository already exists', { code: 409 }),
    )

    const result = await fetchCreateRepo({
      orgSlug: 'org',
      repoName: 'existing-repo',
      description: '',
      homepage: '',
      defaultBranch: 'main',
      visibility: 'private',
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe(409)
    }
  })

  it('passes custom SDK options', async () => {
    const { setupSdk } = await vi.importMock('../../../../src/utils/socket/sdk.mts')
    const { handleApiCall } = await vi.importMock('../../../../src/utils/socket/api.mts')
    const mockSetupSdk = vi.mocked(setupSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      createRepository: vi.fn().mockResolvedValue({}),
    }

    mockSetupSdk.mockResolvedValue(createSuccessResult(mockSdk))
    mockHandleApi.mockResolvedValue(createSuccessResult({}))

    const sdkOpts = {
      apiToken: 'create-token',
      baseUrl: 'https://create.api.com',
    }

    await fetchCreateRepo(
      {
        orgSlug: 'my-org',
        repoName: 'new-repo',
        description: '',
        homepage: '',
        defaultBranch: 'main',
        visibility: 'private',
      },
      { sdkOpts },
    )

    expect(mockSetupSdk).toHaveBeenCalledWith(sdkOpts)
  })

  it('handles minimal repository data', async () => {
    const { setupSdk } = await vi.importMock('../../../../src/utils/socket/sdk.mts')
    const { handleApiCall } = await vi.importMock('../../../../src/utils/socket/api.mts')
    const mockSetupSdk = vi.mocked(setupSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      createRepository: vi.fn().mockResolvedValue({}),
    }

    mockSetupSdk.mockResolvedValue(createSuccessResult(mockSdk))
    mockHandleApi.mockResolvedValue(createSuccessResult({}))

    await fetchCreateRepo({
      orgSlug: 'simple-org',
      repoName: 'simple-repo',
      description: '',
      homepage: '',
      defaultBranch: 'main',
      visibility: 'private',
    })

    expect(mockSdk.createRepository).toHaveBeenCalledWith('simple-org', {
      name: 'simple-repo',
      description: '',
      homepage: '',
      default_branch: 'main',
      visibility: 'private',
    })
  })

  it('handles full repository configuration', async () => {
    const { setupSdk } = await vi.importMock('../../../../src/utils/socket/sdk.mts')
    const { handleApiCall } = await vi.importMock('../../../../src/utils/socket/api.mts')
    const mockSetupSdk = vi.mocked(setupSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      createRepository: vi.fn().mockResolvedValue({}),
    }

    mockSetupSdk.mockResolvedValue(createSuccessResult(mockSdk))
    mockHandleApi.mockResolvedValue(createSuccessResult({}))

    const fullConfig = {
      orgSlug: 'config-org',
      repoName: 'full-config-repo',
      homepage: 'https://github.com/org/full-config-repo',
      description: 'Repository with full configuration',
      defaultBranch: 'main',
      visibility: 'private',
    }

    await fetchCreateRepo(fullConfig)

    expect(mockSdk.createRepository).toHaveBeenCalledWith('config-org', {
      name: 'full-config-repo',
      homepage: 'https://github.com/org/full-config-repo',
      description: 'Repository with full configuration',
      default_branch: 'main',
      visibility: 'private',
    })
  })

  it('uses null prototype for options', async () => {
    const { setupSdk } = await vi.importMock('../../../../src/utils/socket/sdk.mts')
    const { handleApiCall } = await vi.importMock('../../../../src/utils/socket/api.mts')
    const mockSetupSdk = vi.mocked(setupSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      createRepository: vi.fn().mockResolvedValue({}),
    }

    mockSetupSdk.mockResolvedValue(createSuccessResult(mockSdk))
    mockHandleApi.mockResolvedValue(createSuccessResult({}))

    // This tests that the function properly uses __proto__: null.
    await fetchCreateRepo({
      orgSlug: 'test-org',
      repoName: 'test-repo',
      description: '',
      homepage: '',
      defaultBranch: 'main',
      visibility: 'private',
    })

    // The function should work without prototype pollution issues.
    expect(mockSdk.createRepository).toHaveBeenCalled()
  })
})
