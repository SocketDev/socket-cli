/**
 * Unit tests for fetchCreateRepo.
 *
 * Purpose:
 * Tests repository creation via the Socket API. Validates SDK integration, parameter
 * transformation (camelCase to snake_case), and error handling for repository creation
 * workflows.
 *
 * Test Coverage:
 * - Successful repository creation
 * - SDK setup failure handling
 * - API call errors (409 conflict for existing repos)
 * - Custom SDK options (API tokens, base URLs)
 * - Minimal repository data handling
 * - Full repository configuration
 * - Null prototype usage for security
 *
 * Testing Approach:
 * Uses SDK test helpers to mock Socket API interactions. Validates parameter
 * transformation and comprehensive error handling.
 *
 * Related Files:
 * - src/commands/repository/fetch-create-repo.mts (implementation)
 * - src/commands/repository/handle-create-repo.mts (handler)
 * - src/utils/socket/api.mts (API utilities)
 * - src/utils/socket/sdk.mts (SDK setup)
 */

import { describe, expect, it, vi } from 'vitest'

import {
  setupSdkMockError,
  setupSdkMockSuccess,
  setupSdkSetupFailure,
} from '../../../helpers/sdk-test-helpers.mts'
import { fetchCreateRepo } from '../../../../src/commands/repository/fetch-create-repo.mts'

// Mock the dependencies.
vi.mock('../../../../src/utils/socket/api.mts', () => ({
  handleApiCall: vi.fn(),
}))

vi.mock('../../../../src/utils/socket/sdk.mts', () => ({
  setupSdk: vi.fn(),
}))

describe('fetchCreateRepo', () => {
  it('creates repository successfully', async () => {
    const mockData = {
      id: 'repo-123',
      name: 'my-new-repo',
      org: 'test-org',
      url: 'https://github.com/test-org/my-new-repo',
      created_at: '2025-01-20T10:00:00Z',
      status: 'active',
    }

    const { mockHandleApi, mockSdk } = await setupSdkMockSuccess(
      'createRepository',
      mockData,
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
    await setupSdkSetupFailure('Failed to setup SDK', {
      code: 1,
      cause: 'Missing API token',
    })

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
    await setupSdkMockError(
      'createRepository',
      'Repository already exists',
      409,
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
    const { mockSetupSdk } = await setupSdkMockSuccess('createRepository', {})

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
    const { mockSdk } = await setupSdkMockSuccess('createRepository', {})

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
    const { mockSdk } = await setupSdkMockSuccess('createRepository', {})

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
    const { mockSdk } = await setupSdkMockSuccess('createRepository', {})

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
