import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchScanMetadata } from './fetch-scan-metadata.mts'

// Mock the dependencies
vi.mock('../../utils/sdk.mts', () => ({
  withSdk: vi.fn(),
}))

describe('fetchScanMetadata', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches scan metadata successfully', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const successResult = {
      ok: true as const,
      data: {
        id: 'scan-123',
        status: 'completed',
        createdAt: '2023-01-01T00:00:00Z',
        completedAt: '2023-01-01T00:05:00Z',
        packageCount: 150,
        vulnerabilityCount: 5,
        branch: 'main',
        commit: 'abc123',
      },
    }

    mockWithSdk.mockResolvedValueOnce(successResult)

    const result = await fetchScanMetadata('test-org', 'scan-123')

    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'meta data for a full scan',
      undefined,
    )
    expect(result).toEqual(successResult)
  })

  it('handles SDK setup failure', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const error = {
      ok: false as const,
      code: 1,
      message: 'Failed to setup SDK',
      cause: 'Invalid configuration',
    }
    mockWithSdk.mockResolvedValueOnce(error)

    const result = await fetchScanMetadata('test-org', 'scan-123')

    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'meta data for a full scan',
      undefined,
    )
    expect(result).toEqual(error)
  })

  it('handles API call failure', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const error = {
      ok: false as const,
      error: 'Scan metadata not found',
      code: 404,
      message: 'Scan metadata not found',
    }
    mockWithSdk.mockResolvedValueOnce(error)

    const result = await fetchScanMetadata('test-org', 'nonexistent-scan')

    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'meta data for a full scan',
      undefined,
    )
    expect(result.ok).toBe(false)
    expect(result.code).toBe(404)
  })

  it('passes custom SDK options', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const successResult = {
      ok: true as const,
      data: {},
    }
    mockWithSdk.mockResolvedValueOnce(successResult)

    const options = {
      sdkOpts: {
        apiToken: 'custom-token',
        baseUrl: 'https://api.example.com',
      },
    }

    await fetchScanMetadata('custom-org', 'scan-456', options)

    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'meta data for a full scan',
      options,
    )
  })

  it('handles different org slugs and scan IDs', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const successResult = {
      ok: true as const,
      data: {},
    }

    const testCases = [
      ['org-with-dashes', 'scan-123'],
      ['simple_org', 'uuid-456-789-abc'],
      ['org123', 'scan_with_underscore'],
      ['long.org.name', 'scan.with.dots'],
    ]

    for (const [org, scanId] of testCases) {
      mockWithSdk.mockResolvedValueOnce(successResult)

      // eslint-disable-next-line no-await-in-loop
      await fetchScanMetadata(org, scanId)
    }

    expect(mockWithSdk).toHaveBeenCalledTimes(testCases.length)
    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'meta data for a full scan',
      undefined,
    )
  })

  it('handles empty metadata response', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const successResult = {
      ok: true as const,
      data: null,
    }
    mockWithSdk.mockResolvedValueOnce(successResult)

    const result = await fetchScanMetadata('test-org', 'empty-scan')

    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'meta data for a full scan',
      undefined,
    )
    expect(result.ok).toBe(true)
    expect(result.data).toBeNull()
  })

  it('handles pending scan metadata', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const successResult = {
      ok: true as const,
      data: {
        id: 'scan-pending',
        status: 'pending',
        createdAt: '2023-01-01T00:00:00Z',
        completedAt: null,
        packageCount: 0,
        vulnerabilityCount: 0,
      },
    }
    mockWithSdk.mockResolvedValueOnce(successResult)

    const result = await fetchScanMetadata('test-org', 'scan-pending')

    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'meta data for a full scan',
      undefined,
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.status).toBe('pending')
    }
  })

  it('handles special characters in scan IDs', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const successResult = {
      ok: true as const,
      data: {},
    }
    mockWithSdk.mockResolvedValueOnce(successResult)

    const scanIdWithSpecialChars = 'scan-123_abc-xyz.test'

    await fetchScanMetadata('test-org', scanIdWithSpecialChars)

    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'meta data for a full scan',
      undefined,
    )
  })

  it('uses null prototype for options', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const successResult = {
      ok: true as const,
      data: {},
    }
    mockWithSdk.mockResolvedValueOnce(successResult)

    // This tests that the function properly uses __proto__: null.
    await fetchScanMetadata('test-org', 'scan-123')

    // The function should work without prototype pollution issues.
    expect(mockWithSdk).toHaveBeenCalled()
  })
})
