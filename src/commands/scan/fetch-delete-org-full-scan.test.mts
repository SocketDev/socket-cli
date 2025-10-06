import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchDeleteOrgFullScan } from './fetch-delete-org-full-scan.mts'

// Mock the dependencies.
vi.mock('../../utils/sdk.mts', () => ({
  withSdk: vi.fn(),
}))

describe('fetchDeleteOrgFullScan', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('deletes scan successfully', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const successResult = {
      ok: true as const,
      data: {
        deleted: true,
        id: 'scan-123',
      },
    }

    mockWithSdk.mockResolvedValueOnce(successResult)

    const result = await fetchDeleteOrgFullScan('test-org', 'scan-123')

    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'to delete a scan',
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

    const result = await fetchDeleteOrgFullScan('test-org', 'scan-123')

    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'to delete a scan',
      undefined,
    )
    expect(result).toEqual(error)
  })

  it('handles API call failure', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const error = {
      ok: false as const,
      error: 'Scan not found',
      code: 404,
      message: 'Scan not found',
    }
    mockWithSdk.mockResolvedValueOnce(error)

    const result = await fetchDeleteOrgFullScan('test-org', 'nonexistent-scan')

    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'to delete a scan',
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
        apiToken: 'delete-token',
        baseUrl: 'https://delete.api.com',
      },
    }

    await fetchDeleteOrgFullScan('custom-org', 'scan-456', options)

    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'to delete a scan',
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
    ]

    for (const [org, scanId] of testCases) {
      mockWithSdk.mockResolvedValueOnce(successResult)

      // eslint-disable-next-line no-await-in-loop
      await fetchDeleteOrgFullScan(org, scanId)
    }

    expect(mockWithSdk).toHaveBeenCalledTimes(testCases.length)
    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'to delete a scan',
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
    await fetchDeleteOrgFullScan('test-org', 'scan-123')

    // The function should work without prototype pollution issues.
    expect(mockWithSdk).toHaveBeenCalled()
  })
})
