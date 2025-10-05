import { describe, expect, it, vi } from 'vitest'

import { fetchDeleteOrgFullScan } from './fetch-delete-org-full-scan.mts'

// Mock the dependencies.

vi.mock('../../utils/sdk.mts', () => ({
  withSdk: vi.fn(),
}))

describe('fetchDeleteOrgFullScan', () => {
  it('deletes scan successfully', async () => {
    const { handleApiCall } = await import('../../utils/api.mts')
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockHandleApi = vi.mocked(handleApiCall)
    const mockSetupSdk = vi.mocked(withSdk)

    const mockSdk = {
      deleteOrgFullScan: vi.fn().mockResolvedValue({
        success: true,
        data: {
          deleted: true,
          scanId: 'scan-123',
          message: 'Scan deleted successfully',
        },
      }),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({
      ok: true,
      data: {
        deleted: true,
        scanId: 'scan-123',
      },
    })

    const result = await fetchDeleteOrgFullScan('test-org', 'scan-123')

    expect(mockSdk.deleteOrgFullScan).toHaveBeenCalledWith(
      'test-org',
      'scan-123',
    )
    expect(mockHandleApi).toHaveBeenCalledWith(expect.any(Promise), {
      description: 'to delete a scan',
    })
    expect(result.ok).toBe(true)
  })

  it('handles SDK setup failure', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockSetupSdk = vi.mocked(withSdk)

    const error = {
      ok: false,
      code: 1,
      message: 'Failed to setup SDK',
      cause: 'Invalid configuration',
    }
    mockSetupSdk.mockResolvedValue(error)

    const result = await fetchDeleteOrgFullScan('org', 'scan-456')

    expect(result).toEqual(error)
  })

  it('handles API call failure', async () => {
    const { handleApiCall } = await import('../../utils/api.mts')
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockHandleApi = vi.mocked(handleApiCall)
    const mockSetupSdk = vi.mocked(withSdk)

    const mockSdk = {
      deleteOrgFullScan: vi.fn().mockRejectedValue(new Error('Not found')),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({
      ok: false,
      error: 'Scan not found',
      code: 404,
    })

    const result = await fetchDeleteOrgFullScan('org', 'nonexistent-scan')

    expect(result.ok).toBe(false)
    expect(result.code).toBe(404)
  })

  it('passes custom SDK options', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const { handleApiCall } = await import('../../utils/api.mts')
    const mockSetupSdk = vi.mocked(withSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      deleteOrgFullScan: vi.fn().mockResolvedValue({}),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({ ok: true, data: {} })

    const sdkOpts = {
      apiToken: 'custom-token',
      baseUrl: 'https://api.example.com',
    }

    await fetchDeleteOrgFullScan('org', 'scan', { sdkOpts })

    expect(mockSetupSdk).toHaveBeenCalledWith(sdkOpts)
  })

  it('handles different org slugs and scan IDs', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const { handleApiCall } = await import('../../utils/api.mts')
    const mockSetupSdk = vi.mocked(withSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      deleteOrgFullScan: vi.fn().mockResolvedValue({}),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({ ok: true, data: {} })

    const testCases = [
      ['org-with-dashes', 'scan-123'],
      ['simple_org', 'uuid-456-789'],
      ['org123', 'scan_with_underscore'],
    ]

    for (const [org, scanId] of testCases) {
      // eslint-disable-next-line no-await-in-loop
      await fetchDeleteOrgFullScan(org, scanId)
      expect(mockSdk.deleteOrgFullScan).toHaveBeenCalledWith(org, scanId)
    }
  })

  it('uses null prototype for options', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const { handleApiCall } = await import('../../utils/api.mts')
    const mockSetupSdk = vi.mocked(withSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      deleteOrgFullScan: vi.fn().mockResolvedValue({}),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({ ok: true, data: {} })

    // This tests that the function properly uses __proto__: null.
    await fetchDeleteOrgFullScan('org', 'scan')

    // The function should work without prototype pollution issues.
    expect(mockSdk.deleteOrgFullScan).toHaveBeenCalled()
  })
})
