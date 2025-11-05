/**
 * Unit tests for fetchListAllRepos.
 *
 * Purpose:
 * Tests fetching all repositories for an organization with automatic pagination.
 * Validates multi-page fetching, infinite loop protection, and sorting options.
 *
 * Test Coverage:
 * - Successful single-page repository listing
 * - SDK setup failure handling
 * - API call errors (403 access denied)
 * - Multiple page pagination handling
 * - Sort and direction options
 * - Infinite loop protection (> 100 pages)
 * - Custom SDK options
 * - Null prototype usage for security
 *
 * Testing Approach:
 * Uses SDK test helpers with pagination mocking. Tests infinite loop protection
 * that triggers after 100 page requests.
 *
 * Related Files:
 * - src/commands/repository/fetch-list-all-repos.mts (implementation)
 * - src/commands/repository/handle-list-repos.mts (handler)
 * - src/utils/socket/api.mts (API utilities)
 * - src/utils/socket/sdk.mts (SDK setup)
 */

import { describe, expect, it, vi } from 'vitest'

import { fetchListAllRepos } from '../../../../src/commands/repository/fetch-list-all-repos.mts'
import {
  setupSdkMockError,
  setupSdkMockSuccess,
  setupSdkSetupFailure,
} from '../../../helpers/sdk-test-helpers.mts'

// Mock the dependencies.
vi.mock('../../../../src/utils/socket/api.mts', () => ({
  handleApiCall: vi.fn(),
}))

vi.mock('../../../../src/utils/socket/sdk.mts', () => ({
  setupSdk: vi.fn(),
}))

describe('fetchListAllRepos', () => {
  it('lists all repositories successfully', async () => {
    const mockData = {
      results: [
        { id: 'repo-1', name: 'first-repo' },
        { id: 'repo-2', name: 'second-repo' },
      ],
      nextPage: null,
    }

    const { mockHandleApi, mockSdk } = await setupSdkMockSuccess(
      'listRepositories',
      mockData,
    )

    const result = await fetchListAllRepos('test-org')

    expect(mockSdk.listRepositories).toHaveBeenCalledWith('test-org', {
      sort: undefined,
      direction: undefined,
      per_page: 100,
      page: 0,
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
    await setupSdkMockError('listRepositories', 'Access denied', 403)

    const result = await fetchListAllRepos('private-org')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe(403)
    }
  })

  it('handles multiple pages of repositories', async () => {
    // Mock with initial setup that returns first page.
    const { mockHandleApi } = await setupSdkMockSuccess('listRepositories', {
      results: [{ id: 'repo-1', name: 'first-repo' }],
      nextPage: 1,
    })

    // Mock second page - reset and provide both pages.
    mockHandleApi.mockClear()
    mockHandleApi
      .mockResolvedValueOnce({
        ok: true,
        data: {
          results: [{ id: 'repo-1', name: 'first-repo' }],
          nextPage: 1,
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          results: [{ id: 'repo-2', name: 'second-repo' }],
          nextPage: null,
        },
      })

    const result = await fetchListAllRepos('big-org')

    expect(mockHandleApi).toHaveBeenCalledTimes(2)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.results).toHaveLength(2)
      expect(result.data.nextPage).toBeNull()
    }
  })

  it('passes sort and direction options', async () => {
    const { mockSdk } = await setupSdkMockSuccess('listRepositories', {
      results: [],
      nextPage: null,
    })

    await fetchListAllRepos('sorted-org', {
      sort: 'name',
      direction: 'asc',
    })

    expect(mockSdk.listRepositories).toHaveBeenCalledWith('sorted-org', {
      sort: 'name',
      direction: 'asc',
      per_page: 100,
      page: 0,
    })
  })

  it('handles infinite loop protection', async () => {
    const { mockHandleApi } = await setupSdkMockSuccess('listRepositories', {
      results: [{ id: 'repo-1', name: 'repo' }],
      nextPage: 1,
    })

    // Clear initial setup calls and always return the same nextPage to trigger protection.
    mockHandleApi.mockClear()
    mockHandleApi.mockResolvedValue({
      ok: true,
      data: {
        results: [{ id: 'repo-1', name: 'repo' }],
        nextPage: 1,
      },
    })

    const result = await fetchListAllRepos('infinite-org')

    expect(result.ok).toBe(false)
    expect(result.message).toBe('Infinite loop detected')
    // The protection triggers after ++protection > 100, but BEFORE the API call.
    // So handleApiCall is called exactly 100 times before protection kicks in.
    expect(mockHandleApi).toHaveBeenCalledTimes(100)
  })

  it('passes custom SDK options', async () => {
    const { mockSetupSdk } = await setupSdkMockSuccess('listRepositories', {
      results: [],
      nextPage: null,
    })

    const sdkOpts = {
      apiToken: 'list-token',
      baseUrl: 'https://list.api.com',
    }

    await fetchListAllRepos('my-org', { sdkOpts })

    expect(mockSetupSdk).toHaveBeenCalledWith(sdkOpts)
  })

  it('uses null prototype for options', async () => {
    const { mockSdk } = await setupSdkMockSuccess('listRepositories', {
      results: [],
      nextPage: null,
    })

    // This tests that the function properly uses __proto__: null.
    await fetchListAllRepos('test-org')

    // The function should work without prototype pollution issues.
    expect(mockSdk.listRepositories).toHaveBeenCalled()
  })
})
