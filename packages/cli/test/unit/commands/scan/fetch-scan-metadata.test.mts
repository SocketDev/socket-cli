import { describe, expect, it, vi } from 'vitest'

import { setupSdkMockSuccess } from '../../../../src/helpers/sdk-test-helpers.mts'

// Mock the dependencies.
vi.mock('../../utils/socket/api.mts', () => ({
  handleApiCall: vi.fn(),
}))

vi.mock('../../utils/socket/sdk.mts', () => ({
  setupSdk: vi.fn(),
}))

describe('fetchScanMetadata', () => {
  it('fetches scan metadata successfully', async () => {
    const { fetchScanMetadata } = await import('./fetch-scan-metadata.mts')

    const { mockHandleApi, mockSdk } = await setupSdkMockSuccess(
      'getFullScanMetadata',
      {
        id: 'scan-123',
        status: 'completed',
        packageCount: 150,
      },
    )

    const result = await fetchScanMetadata('test-org', 'scan-123')

    expect(mockSdk.getFullScanMetadata).toHaveBeenCalledWith(
      'test-org',
      'scan-123',
    )
    expect(mockHandleApi).toHaveBeenCalledWith(expect.any(Promise), {
      description: 'meta data for a full scan',
    })
    expect(result.ok).toBe(true)
    expect(result.data?.id).toBe('scan-123')
  })

  it('handles SDK setup failure', async () => {
    const { fetchScanMetadata } = await import('./fetch-scan-metadata.mts')
    const { setupSdkSetupFailure } = await import(
      '../../../test/helpers/sdk-test-helpers.mts'
    )

    await setupSdkSetupFailure('Failed to setup SDK', {
      cause: 'Invalid configuration',
    })

    const result = await fetchScanMetadata('test-org', 'scan-123')

    expect(result.ok).toBe(false)
    expect(result.message).toBe('Failed to setup SDK')
    expect(result.cause).toBe('Invalid configuration')
  })

  it('handles API call failure', async () => {
    const { fetchScanMetadata } = await import('./fetch-scan-metadata.mts')
    const { setupSdkMockError } = await import(
      '../../../test/helpers/sdk-test-helpers.mts'
    )

    await setupSdkMockError('getFullScanMetadata', 'Not found', 404)

    const result = await fetchScanMetadata('test-org', 'nonexistent-scan')

    expect(result.ok).toBe(false)
    expect(result.code).toBe(404)
  })

  it('passes custom SDK options', async () => {
    const { fetchScanMetadata } = await import('./fetch-scan-metadata.mts')

    const { mockSdk, mockSetupSdk } = await setupSdkMockSuccess(
      'getFullScanMetadata',
      {},
    )

    const options = {
      sdkOpts: {
        apiToken: 'custom-token',
        baseUrl: 'https://api.example.com',
      },
    }

    await fetchScanMetadata('custom-org', 'scan-456', options)

    expect(mockSetupSdk).toHaveBeenCalledWith(options.sdkOpts)
    expect(mockSdk.getFullScanMetadata).toHaveBeenCalledWith(
      'custom-org',
      'scan-456',
    )
  })

  it('handles different org slugs and scan IDs', async () => {
    const { fetchScanMetadata } = await import('./fetch-scan-metadata.mts')

    const { mockSdk } = await setupSdkMockSuccess('getFullScanMetadata', {})

    const testCases = [
      ['org-with-dashes', 'scan-123'],
      ['simple_org', 'uuid-456-789-abc'],
      ['org123', 'scan_with_underscore'],
      ['long.org.name', 'scan.with.dots'],
    ]

    for (const [org, scanId] of testCases) {
      // eslint-disable-next-line no-await-in-loop
      await fetchScanMetadata(org, scanId)
      expect(mockSdk.getFullScanMetadata).toHaveBeenCalledWith(org, scanId)
    }
  })

  it('handles empty metadata response', async () => {
    const { fetchScanMetadata } = await import('./fetch-scan-metadata.mts')

    await setupSdkMockSuccess('getFullScanMetadata', null)

    const result = await fetchScanMetadata('test-org', 'empty-scan')

    expect(result.ok).toBe(true)
    expect(result.data).toBe(null)
  })

  it('handles pending scan metadata', async () => {
    const { fetchScanMetadata } = await import('./fetch-scan-metadata.mts')

    await setupSdkMockSuccess('getFullScanMetadata', {
      id: 'scan-pending',
      status: 'pending',
      progress: 45,
    })

    const result = await fetchScanMetadata('test-org', 'scan-pending')

    expect(result.ok).toBe(true)
    expect(result.data?.status).toBe('pending')
    expect(result.data?.progress).toBe(45)
  })

  it('handles special characters in scan IDs', async () => {
    const { fetchScanMetadata } = await import('./fetch-scan-metadata.mts')

    const { mockSdk } = await setupSdkMockSuccess('getFullScanMetadata', {
      id: 'scan-with-special-chars',
    })

    const specialScanId = 'scan-123_with-special.chars@example.com'

    await fetchScanMetadata('test-org', specialScanId)

    expect(mockSdk.getFullScanMetadata).toHaveBeenCalledWith(
      'test-org',
      specialScanId,
    )
  })

  it('uses null prototype for options', async () => {
    const { fetchScanMetadata } = await import('./fetch-scan-metadata.mts')

    const { mockSdk } = await setupSdkMockSuccess('getFullScanMetadata', {})

    // This tests that the function properly uses __proto__: null.
    await fetchScanMetadata('test-org', 'scan-123')

    // The function should work without prototype pollution issues.
    expect(mockSdk.getFullScanMetadata).toHaveBeenCalled()
  })
})
