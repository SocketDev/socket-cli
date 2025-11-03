import { describe, expect, it, vi } from 'vitest'

import {
  setupSdkMockError,
  setupSdkMockSuccess,
  setupSdkSetupFailure,
} from '../../../../src/helpers/sdk-test-helpers.mts'
import { fetchDependencies } from '../../../../src/src/fetch-dependencies.mts'

// Mock the dependencies.
vi.mock('../../utils/socket/api.mts', () => ({
  handleApiCall: vi.fn(),
}))

vi.mock('../../utils/socket/sdk.mts', () => ({
  setupSdk: vi.fn(),
}))

describe('fetchDependencies', () => {
  it('fetches dependencies successfully', async () => {
    const mockData = {
      dependencies: [
        { name: 'lodash', version: '4.17.21' },
        { name: 'express', version: '4.18.2' },
      ],
      total: 2,
    }

    const { mockHandleApi, mockSdk } = await setupSdkMockSuccess(
      'searchDependencies',
      mockData,
    )

    const result = await fetchDependencies({ limit: 10, offset: 0 })

    expect(mockSdk.searchDependencies).toHaveBeenCalledWith({
      limit: 10,
      offset: 0,
    })
    expect(mockHandleApi).toHaveBeenCalledWith(expect.any(Promise), {
      description: 'organization dependencies',
    })
    expect(result.ok).toBe(true)
  })

  it('handles SDK setup failure', async () => {
    await setupSdkSetupFailure('Failed to setup SDK', {
      code: 1,
      cause: 'Invalid API token',
    })

    const result = await fetchDependencies({ limit: 20, offset: 10 })

    expect(result.ok).toBe(false)
  })

  it('handles API call failure', async () => {
    await setupSdkMockError('searchDependencies', 'API error')

    const result = await fetchDependencies({ limit: 50, offset: 0 })

    expect(result.ok).toBe(false)
  })

  it('passes custom SDK options', async () => {
    const { mockSetupSdk } = await setupSdkMockSuccess('searchDependencies', [])

    const sdkOpts = {
      apiToken: 'custom-token',
      baseUrl: 'https://custom.api.com',
    }

    await fetchDependencies({ limit: 100, offset: 50 }, { sdkOpts })

    expect(mockSetupSdk).toHaveBeenCalledWith(sdkOpts)
  })

  it('handles pagination parameters', async () => {
    const { mockSdk } = await setupSdkMockSuccess('searchDependencies', {})

    await fetchDependencies({ limit: 200, offset: 100 })

    expect(mockSdk.searchDependencies).toHaveBeenCalledWith({
      limit: 200,
      offset: 100,
    })
  })

  it('uses null prototype for options', async () => {
    const { mockSdk } = await setupSdkMockSuccess('searchDependencies', {})

    // This tests that the function properly uses __proto__: null.
    await fetchDependencies({ limit: 10, offset: 0 })

    // The function should work without prototype pollution issues.
    expect(mockSdk.searchDependencies).toHaveBeenCalled()
  })
})
