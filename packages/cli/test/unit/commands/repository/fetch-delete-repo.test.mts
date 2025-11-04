import { describe, expect, it, vi } from 'vitest'

import {
  setupSdkMockError,
  setupSdkMockSuccess,
  setupSdkSetupFailure,
} from '../../../helpers/sdk-test-helpers.mts'
import { fetchDeleteRepo } from '../../../../src/commands/repository/fetch-delete-repo.mts'

// Mock the dependencies.
vi.mock('../../../../src/utils/socket/api.mts', () => ({
  handleApiCall: vi.fn(),
}))

vi.mock('../../../../src/utils/socket/sdk.mts', () => ({
  setupSdk: vi.fn(),
}))

describe('fetchDeleteRepo', () => {
  it('deletes repository successfully', async () => {
    const mockData = {
      id: 'repo-123',
      name: 'deleted-repo',
      status: 'deleted',
    }

    const { mockHandleApi, mockSdk } = await setupSdkMockSuccess(
      'deleteRepository',
      mockData,
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
    await setupSdkSetupFailure('Failed to setup SDK', {
      code: 1,
      cause: 'Missing API token',
    })

    const result = await fetchDeleteRepo('org', 'repo')

    expect(result.ok).toBe(false)
  })

  it('handles API call failure', async () => {
    await setupSdkMockError('deleteRepository', 'Repository not found', 404)

    const result = await fetchDeleteRepo('org', 'nonexistent-repo')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe(404)
    }
  })

  it('passes custom SDK options', async () => {
    const { mockSetupSdk } = await setupSdkMockSuccess('deleteRepository', {})

    const sdkOpts = {
      apiToken: 'delete-token',
      baseUrl: 'https://delete.api.com',
    }

    await fetchDeleteRepo('my-org', 'old-repo', { sdkOpts })

    expect(mockSetupSdk).toHaveBeenCalledWith(sdkOpts)
  })

  it('handles insufficient permissions error', async () => {
    await setupSdkMockError(
      'deleteRepository',
      'Insufficient permissions',
      403,
    )

    const result = await fetchDeleteRepo('protected-org', 'protected-repo')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe(403)
    }
  })
})
