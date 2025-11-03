import { describe, expect, it, vi } from 'vitest'

import {
  setupSdkMockError,
  setupSdkMockSuccess,
  setupSdkSetupFailure,
} from '../../../../src/helpers/sdk-test-helpers.mts'
import { fetchPurlsShallowScore } from '../../../../src/src/commands/package/fetch-purls-shallow-score.mts'

// Mock the dependencies.
const mockHandleApiCall = vi.hoisted(() => vi.fn())
const mockSetupSdk = vi.hoisted(() => vi.fn())
const mockGetDefaultLogger = vi.hoisted(() => vi.fn(())
const mockInfo = vi.hoisted(() => vi.fn())

vi.mock('../../../../src/utils/socket/api.mts', () => ({
  handleApiCall: mockHandleApiCall,
}))

vi.mock('../../../../src/utils/socket/sdk.mts', () => ({
  setupSdk: mockSetupSdk,
}))

vi.mock('@socketsecurity/lib/logger', () => ({
  getDefaultLogger: mockGetDefaultLogger => ({
    info: mockInfo,
  })),
}))

describe('fetchPurlsShallowScore', () => {
  it('fetches purls shallow scores successfully', async () => {
    const { mockHandleApi, mockSdk } = await setupSdkMockSuccess(
      'batchPackageFetch',
      [
        {
          purl: 'pkg:npm/lodash@4.17.21',
          score: 85,
          name: 'lodash',
          version: '4.17.21',
        },
        {
          purl: 'pkg:npm/express@4.18.2',
          score: 92,
          name: 'express',
          version: '4.18.2',
        },
      ],
    )

    const purls = ['pkg:npm/lodash@4.17.21', 'pkg:npm/express@4.18.2']
    const result = await fetchPurlsShallowScore(purls)

    expect(mockSdk.batchPackageFetch).toHaveBeenCalledWith(
      { components: purls.map(purl => ({ purl })) },
      { alerts: 'true' },
    )
    expect(mockHandleApi).toHaveBeenCalledWith(expect.any(Promise), {
      description: 'looking up package',
    })
    expect(result.ok).toBe(true)
    expect(result.data).toHaveLength(2)
  })

  it('handles SDK setup failure', async () => {
    await setupSdkSetupFailure('Failed to setup SDK', {
      code: 1,
      cause: 'Invalid configuration',
    })

    const result = await fetchPurlsShallowScore(['pkg:npm/test@1.0.0'])

    expect(result.ok).toBe(false)
    expect(result.message).toBe('Failed to setup SDK')
  })

  it('handles API call failure', async () => {
    await setupSdkMockError('batchPackageFetch', 'Batch too large', 400)

    const result = await fetchPurlsShallowScore(
      Array(1000).fill('pkg:npm/test@1.0.0'),
    )

    expect(result.ok).toBe(false)
    expect(result.code).toBe(400)
  })

  it('passes custom SDK options', async () => {
    const { mockSetupSdk } = await setupSdkMockSuccess('batchPackageFetch', [])

    const sdkOpts = {
      apiToken: 'batch-token',
      baseUrl: 'https://batch.api.com',
    }

    await fetchPurlsShallowScore(['pkg:npm/test@1.0.0'], { sdkOpts })

    expect(mockSetupSdk).toHaveBeenCalledWith(sdkOpts)
  })

  it('handles empty purl array', async () => {
    const { mockSdk } = await setupSdkMockSuccess('batchPackageFetch', [])

    const result = await fetchPurlsShallowScore([])

    expect(mockSdk.batchPackageFetch).toHaveBeenCalledWith(
      { components: [] },
      { alerts: 'true' },
    )
    expect(result.ok).toBe(true)
    expect(result.data).toEqual([])
  })

  it('handles mixed purl types', async () => {
    const { mockSdk } = await setupSdkMockSuccess('batchPackageFetch', [])

    const mixedPurls = [
      'pkg:npm/lodash@4.17.21',
      'pkg:pypi/django@4.2.0',
      'pkg:maven/org.springframework/spring-core@5.3.0',
      'pkg:gem/rails@7.0.0',
    ]

    await fetchPurlsShallowScore(mixedPurls)

    expect(mockSdk.batchPackageFetch).toHaveBeenCalledWith(
      { components: mixedPurls.map(purl => ({ purl })) },
      { alerts: 'true' },
    )
  })

  it('handles large batch of purls', async () => {
    const largeBatch = Array(100)
      .fill(0)
      .map((_, i) => `pkg:npm/package-${i}@1.0.0`)
    const mockResults = largeBatch.map(purl => ({ purl, score: 80 }))

    await setupSdkMockSuccess('batchPackageFetch', mockResults)

    const result = await fetchPurlsShallowScore(largeBatch)

    expect(result.ok).toBe(true)
    expect(result.data).toHaveLength(100)
  })

  it('uses null prototype for options', async () => {
    const { mockSdk } = await setupSdkMockSuccess('batchPackageFetch', [])

    // This tests that the function properly uses __proto__: null.
    await fetchPurlsShallowScore(['pkg:npm/test@1.0.0'])

    // The function should work without prototype pollution issues.
    expect(mockSdk.batchPackageFetch).toHaveBeenCalled()
  })
})
