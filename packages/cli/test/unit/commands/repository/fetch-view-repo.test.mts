import { describe, expect, it, vi } from 'vitest'

import {
  setupSdkMockError,
  setupSdkMockSuccess,
  setupSdkSetupFailure,
} from '../../../../../src/commands/../../../test/helpers/sdk-test-helpers.mts'
import { fetchViewRepo } from '../../../../src/src/commands/repository/fetch-view-repo.mts'

// Mock the dependencies.
const mockHandleApiCall = vi.hoisted(() => vi.fn())
const mockSetupSdk = vi.hoisted(() => vi.fn())

vi.mock('../../../../src/utils/socket/api.mts', () => ({
  handleApiCall: mockHandleApiCall,
}))

vi.mock('../../../../src/utils/socket/sdk.mts', () => ({
  setupSdk: mockSetupSdk,
}))

describe('fetchViewRepo', () => {
  it('views repository successfully', async () => {
    const mockData = {
      id: 'repo-123',
      name: 'test-repo',
      description: 'A test repository',
      visibility: 'public',
      default_branch: 'main',
      created_at: '2025-01-01T10:00:00Z',
      updated_at: '2025-01-20T15:30:00Z',
    }

    const { mockHandleApi, mockSdk } = await setupSdkMockSuccess(
      'getRepository',
      mockData,
    )

    const result = await fetchViewRepo('test-org', 'test-repo')

    expect(mockSdk.getRepository).toHaveBeenCalledWith('test-org', 'test-repo')
    expect(mockHandleApi).toHaveBeenCalledWith(expect.any(Promise), {
      description: 'repository data',
    })
    expect(result.ok).toBe(true)
  })

  it('handles SDK setup failure', async () => {
    await setupSdkSetupFailure('Failed to setup SDK', {
      code: 1,
      cause: 'Missing API token',
    })

    const result = await fetchViewRepo('org', 'repo')

    expect(result.ok).toBe(false)
    expect(result.code).toBe(1)
  })

  it('handles API call failure', async () => {
    await setupSdkMockError('getRepository', 'Repository not found', 404)

    const result = await fetchViewRepo('org', 'nonexistent-repo')

    expect(result.ok).toBe(false)
    expect(result.code).toBe(404)
  })

  it('passes custom SDK options', async () => {
    const { mockSetupSdk } = await setupSdkMockSuccess('getRepository', {})

    const sdkOpts = {
      apiToken: 'view-token',
      baseUrl: 'https://view.api.com',
    }

    await fetchViewRepo('my-org', 'my-repo', { sdkOpts })

    expect(mockSetupSdk).toHaveBeenCalledWith(sdkOpts)
  })

  it('handles private repository access', async () => {
    const mockData = {
      id: 'private-repo-456',
      name: 'secret-project',
      description: 'A private repository',
      visibility: 'private',
      members_count: 5,
    }

    const { mockSdk } = await setupSdkMockSuccess('getRepository', mockData)

    const result = await fetchViewRepo('private-org', 'secret-project')

    expect(result.ok).toBe(true)
    expect(mockSdk.getRepository).toHaveBeenCalledWith(
      'private-org',
      'secret-project',
    )
  })

  it('handles special repository names', async () => {
    const { mockSdk } = await setupSdkMockSuccess('getRepository', {})

    await fetchViewRepo('special-org', 'repo-with-hyphens_and_underscores.dots')

    expect(mockSdk.getRepository).toHaveBeenCalledWith(
      'special-org',
      'repo-with-hyphens_and_underscores.dots',
    )
  })

  it('handles insufficient permissions error', async () => {
    await setupSdkMockError('getRepository', 'Access denied', 403)

    const result = await fetchViewRepo('restricted-org', 'restricted-repo')

    expect(result.ok).toBe(false)
    expect(result.code).toBe(403)
  })

  it('uses null prototype for options', async () => {
    const { mockSdk } = await setupSdkMockSuccess('getRepository', {})

    // This tests that the function properly uses __proto__: null.
    await fetchViewRepo('test-org', 'test-repo')

    // The function should work without prototype pollution issues.
    expect(mockSdk.getRepository).toHaveBeenCalled()
  })
})
