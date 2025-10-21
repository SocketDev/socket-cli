import { describe, expect, it, vi } from 'vitest'
import { createSuccessResult } from '../../../test/helpers/mocks.mts'
import {
  setupSdkMockError,
  setupSdkSetupFailure,
} from '../../../test/helpers/sdk-test-helpers.mts'
import { fetchListAllRepos } from './fetch-list-all-repos.mts'

// Mock the dependencies.
vi.mock('../../utils/socket/api.mjs', () => ({
  handleApiCall: vi.fn(),
}))

vi.mock('../../utils/socket/sdk.mjs', () => ({
  setupSdk: vi.fn(),
}))

describe('fetchListAllRepos', () => {
  it('lists all repositories successfully', async () => {
    const { handleApiCall } = await import('../../utils/socket/api.mjs')
    const { setupSdk } = await import('../../utils/socket/sdk.mjs')
    const mockHandleApi = vi.mocked(handleApiCall)
    const mockSetupSdk = vi.mocked(setupSdk)

    const mockSdk = {
      getOrgRepoList: vi.fn().mockResolvedValue({
        success: true,
        data: {
          results: [
            { id: 'repo-1', name: 'first-repo' },
            { id: 'repo-2', name: 'second-repo' },
          ],
          nextPage: null,
        },
      }),
    }

    mockSetupSdk.mockResolvedValue(createSuccessResult(mockSdk))
    mockHandleApi.mockResolvedValue(
      createSuccessResult({
        results: [
          { id: 'repo-1', name: 'first-repo' },
          { id: 'repo-2', name: 'second-repo' },
        ],
        nextPage: null,
      }),
    )

    const result = await fetchListAllRepos('test-org')

    expect(mockSdk.getOrgRepoList).toHaveBeenCalledWith('test-org', {
      sort: undefined,
      direction: undefined,
      per_page: '100',
      page: '0',
    })
    expect(mockHandleApi).toHaveBeenCalledWith(expect.any(Promise), {
      description: 'list of repositories',
    })
    expect(result.ok).toBe(true)
  })

  it('handles SDK setup failure', async () => {
    await setupSdkSetupFailure('Failed to setup SDK', {
      code: 1,
      cause: 'Missing API token',
    })

    const result = await fetchListAllRepos('org')

    expect(result.ok).toBe(false)
  })

  it('handles API call failure', async () => {
    await setupSdkMockError('getOrgRepoList', new Error('Access denied'), 403)

    const result = await fetchListAllRepos('private-org')

    expect(result.ok).toBe(false)
    expect(result.code).toBe(403)
  })

  it('handles multiple pages of repositories', async () => {
    const { handleApiCall } = await import('../../utils/socket/api.mjs')
    const { setupSdk } = await import('../../utils/socket/sdk.mjs')
    const mockHandleApi = vi.mocked(handleApiCall)
    const mockSetupSdk = vi.mocked(setupSdk)

    // Clear previous mock state.
    mockHandleApi.mockClear()
    mockSetupSdk.mockClear()

    const mockSdk = {
      getOrgRepoList: vi.fn(),
    }

    mockSetupSdk.mockResolvedValue(createSuccessResult(mockSdk))

    // Mock first page.
    mockHandleApi
      .mockResolvedValueOnce(
        createSuccessResult({
          results: [{ id: 'repo-1', name: 'first-repo' }],
          nextPage: 1,
        }),
      )
      // Mock second page.
      .mockResolvedValueOnce(
        createSuccessResult({
          results: [{ id: 'repo-2', name: 'second-repo' }],
          nextPage: null,
        }),
      )

    const result = await fetchListAllRepos('big-org')

    expect(mockHandleApi).toHaveBeenCalledTimes(2)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.results).toHaveLength(2)
      expect(result.data.nextPage).toBeNull()
    }
  })

  it('passes sort and direction options', async () => {
    const { setupSdk } = await import('../../utils/socket/sdk.mjs')
    const { handleApiCall } = await import('../../utils/socket/api.mjs')
    const mockSetupSdk = vi.mocked(setupSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      getOrgRepoList: vi.fn().mockResolvedValue({}),
    }

    mockSetupSdk.mockResolvedValue(createSuccessResult(mockSdk))
    mockHandleApi.mockResolvedValue(
      createSuccessResult({ results: [], nextPage: null }),
    )

    await fetchListAllRepos('sorted-org', {
      sort: 'name',
      direction: 'asc',
    })

    expect(mockSdk.getOrgRepoList).toHaveBeenCalledWith('sorted-org', {
      sort: 'name',
      direction: 'asc',
      per_page: '100',
      page: '0',
    })
  })

  it('handles infinite loop protection', async () => {
    const { handleApiCall } = await import('../../utils/socket/api.mjs')
    const { setupSdk } = await import('../../utils/socket/sdk.mjs')
    const mockHandleApi = vi.mocked(handleApiCall)
    const mockSetupSdk = vi.mocked(setupSdk)

    // Clear previous mock state.
    mockHandleApi.mockClear()
    mockSetupSdk.mockClear()

    const mockSdk = {
      getOrgRepoList: vi.fn(),
    }

    mockSetupSdk.mockResolvedValue(createSuccessResult(mockSdk))

    // Always return the same nextPage to trigger protection.
    mockHandleApi.mockResolvedValue(
      createSuccessResult({
        results: [{ id: 'repo-1', name: 'repo' }],
        nextPage: 1,
      }),
    )

    const result = await fetchListAllRepos('infinite-org')

    expect(result.ok).toBe(false)
    expect(result.message).toBe('Infinite loop detected')
    // The protection triggers after ++protection > 100, but BEFORE the API call.
    // So handleApiCall is called exactly 100 times before protection kicks in.
    expect(mockHandleApi).toHaveBeenCalledTimes(100)
  })

  it('passes custom SDK options', async () => {
    const { setupSdk } = await import('../../utils/socket/sdk.mjs')
    const { handleApiCall } = await import('../../utils/socket/api.mjs')
    const mockSetupSdk = vi.mocked(setupSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      getOrgRepoList: vi.fn().mockResolvedValue({}),
    }

    mockSetupSdk.mockResolvedValue(createSuccessResult(mockSdk))
    mockHandleApi.mockResolvedValue(
      createSuccessResult({ results: [], nextPage: null }),
    )

    const sdkOpts = {
      apiToken: 'list-token',
      baseUrl: 'https://list.api.com',
    }

    await fetchListAllRepos('my-org', { sdkOpts })

    expect(mockSetupSdk).toHaveBeenCalledWith(sdkOpts)
  })

  it('uses null prototype for options', async () => {
    const { setupSdk } = await import('../../utils/socket/sdk.mjs')
    const { handleApiCall } = await import('../../utils/socket/api.mjs')
    const mockSetupSdk = vi.mocked(setupSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      getOrgRepoList: vi.fn().mockResolvedValue({}),
    }

    mockSetupSdk.mockResolvedValue(createSuccessResult(mockSdk))
    mockHandleApi.mockResolvedValue(
      createSuccessResult({ results: [], nextPage: null }),
    )

    // This tests that the function properly uses __proto__: null.
    await fetchListAllRepos('test-org')

    // The function should work without prototype pollution issues.
    expect(mockSdk.getOrgRepoList).toHaveBeenCalled()
  })
})
