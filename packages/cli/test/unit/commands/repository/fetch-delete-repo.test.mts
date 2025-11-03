import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createErrorResult,
  createSuccessResult,
} from '../../../../src/helpers/mocks.mts'
import { fetchDeleteRepo } from '../../../../../src/commands/repository/fetch-delete-repo.mts'

// Mock the dependencies.
vi.mock('../../utils/socket/api.mts', () => ({
  handleApiCall: vi.fn(),
}))

vi.mock('../../utils/socket/sdk.mts', () => ({
  setupSdk: vi.fn(),
}))

describe('fetchDeleteRepo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('deletes repository successfully', async () => {
    const { setupSdk } = await vi.importMock('../../utils/socket/sdk.mts')
    const { handleApiCall } = await vi.importMock('../../utils/socket/api.mts')
    const mockSetupSdk = vi.mocked(setupSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      deleteRepository: vi.fn().mockResolvedValue({
        success: true,
        data: {
          id: 'repo-123',
          name: 'deleted-repo',
          status: 'deleted',
        },
      }),
    }

    mockSetupSdk.mockResolvedValue(createSuccessResult(mockSdk as any))
    mockHandleApi.mockResolvedValue(
      createSuccessResult({
        id: 'repo-123',
        name: 'deleted-repo',
        status: 'deleted',
      }),
    )

    const result = await fetchDeleteRepo('test-org', 'deleted-repo')

    expect(mockSdk.deleteRepository).toHaveBeenCalledWith(
      'test-org',
      'deleted-repo',
    )
    expect(mockHandleApi).toHaveBeenCalledWith(expect.any(Promise), {
      description: 'to delete a repository',
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

    const result = await fetchDeleteRepo('org', 'repo')

    expect(result.ok).toBe(false)
  })

  it('handles API call failure', async () => {
    const { setupSdk } = await vi.importMock('../../utils/socket/sdk.mts')
    const { handleApiCall } = await vi.importMock('../../utils/socket/api.mts')
    const mockSetupSdk = vi.mocked(setupSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      deleteRepository: vi
        .fn()
        .mockRejectedValue(new Error('Repository not found')),
    }

    mockSetupSdk.mockResolvedValue(createSuccessResult(mockSdk as any))
    mockHandleApi.mockResolvedValue(
      createErrorResult('Repository not found', { code: 404 }),
    )

    const result = await fetchDeleteRepo('org', 'nonexistent-repo')

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
      deleteRepository: vi.fn().mockResolvedValue({}),
    }

    mockSetupSdk.mockResolvedValue(createSuccessResult(mockSdk as any))
    mockHandleApi.mockResolvedValue(createSuccessResult({}))

    const sdkOpts = {
      apiToken: 'delete-token',
      baseUrl: 'https://delete.api.com',
    }

    await fetchDeleteRepo('my-org', 'old-repo', { sdkOpts })

    expect(mockSetupSdk).toHaveBeenCalledWith(sdkOpts)
  })

  it('handles insufficient permissions error', async () => {
    const { setupSdk } = await vi.importMock('../../utils/socket/sdk.mts')
    const { handleApiCall } = await vi.importMock('../../utils/socket/api.mts')
    const mockSetupSdk = vi.mocked(setupSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      deleteRepository: vi
        .fn()
        .mockRejectedValue(new Error('Insufficient permissions')),
    }

    mockSetupSdk.mockResolvedValue(createSuccessResult(mockSdk as any))
    mockHandleApi.mockResolvedValue(
      createErrorResult('Insufficient permissions', { code: 403 }),
    )

    const result = await fetchDeleteRepo('protected-org', 'protected-repo')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe(403)
    }
  })
})
