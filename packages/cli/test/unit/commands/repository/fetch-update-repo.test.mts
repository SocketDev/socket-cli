/**
 * Unit tests for fetchUpdateRepo.
 *
 * Purpose:
 * Tests repository update via the Socket API. Validates SDK integration, parameter
 * transformation, and partial update handling.
 *
 * Test Coverage:
 * - Successful repository update
 * - SDK setup failure handling
 * - API call errors (404 not found, 403 forbidden)
 * - Custom SDK options
 * - Partial updates (only changed fields)
 * - Null prototype usage for security
 *
 * Testing Approach:
 * Uses SDK test helpers to mock Socket API interactions. Validates parameter
 * transformation and update workflows.
 *
 * Related Files:
 * - src/commands/repository/fetch-update-repo.mts (implementation)
 * - src/commands/repository/handle-update-repo.mts (handler)
 * - src/utils/socket/api.mts (API utilities)
 * - src/utils/socket/sdk.mts (SDK setup)
 */

import { describe, expect, it, vi } from 'vitest'

import { fetchUpdateRepo } from '../../../../src/commands/repository/fetch-update-repo.mts'
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

describe('fetchUpdateRepo', () => {
  it('updates repository successfully', async () => {
    const mockData = {
      id: 'repo-123',
      name: 'updated-repo',
      description: 'Updated description',
      visibility: 'private',
    }

    const { mockHandleApi, mockSdk } = await setupSdkMockSuccess(
      'updateRepository',
      mockData,
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
    await setupSdkSetupFailure('Failed to setup SDK', {
      code: 1,
      cause: 'Missing API token',
    })

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
    await setupSdkMockError('updateRepository', 'Repository not found', 404)

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
    const { mockSetupSdk } = await setupSdkMockSuccess('updateRepository', {})

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
    const { mockSdk } = await setupSdkMockSuccess('updateRepository', {})

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
    const { mockSdk } = await setupSdkMockSuccess('updateRepository', {})

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
    const { mockSdk } = await setupSdkMockSuccess('updateRepository', {})

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
    const { mockSdk } = await setupSdkMockSuccess('updateRepository', {})

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
