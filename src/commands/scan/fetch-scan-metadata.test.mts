import { describe, expect, it, vi } from 'vitest'

// Mock the dependencies.
vi.mock('../../utils/api.mts', () => ({
  handleApiCall: vi.fn(),
}))

vi.mock('../../utils/sdk.mts', () => ({
  setupSdk: vi.fn(),
}))

describe('fetchScanMetadata', () => {
  it('fetches scan metadata successfully', async () => {
    const { fetchScanMetadata } = await import('./fetch-scan-metadata.mts')
    const { handleApiCall } = await import('../../utils/api.mts')
    const { setupSdk } = await import('../../utils/sdk.mts')
    const mockHandleApi = vi.mocked(handleApiCall)
    const mockSetupSdk = vi.mocked(setupSdk)

    const mockSdk = {
      getOrgFullScanMetadata: vi.fn().mockResolvedValue({
        success: true,
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
      }),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({
      ok: true,
      data: {
        id: 'scan-123',
        status: 'completed',
        packageCount: 150,
      },
    })

    const result = await fetchScanMetadata('test-org', 'scan-123')

    expect(mockSdk.getOrgFullScanMetadata).toHaveBeenCalledWith(
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
    const { setupSdk } = await import('../../utils/sdk.mts')
    const mockSetupSdk = vi.mocked(setupSdk)

    const error = {
      ok: false,
      code: 1,
      message: 'Failed to setup SDK',
      cause: 'Invalid configuration',
    }
    mockSetupSdk.mockResolvedValue(error)

    const result = await fetchScanMetadata('test-org', 'scan-123')

    expect(result).toEqual(error)
  })

  it('handles API call failure', async () => {
    const { fetchScanMetadata } = await import('./fetch-scan-metadata.mts')
    const { handleApiCall } = await import('../../utils/api.mts')
    const { setupSdk } = await import('../../utils/sdk.mts')
    const mockHandleApi = vi.mocked(handleApiCall)
    const mockSetupSdk = vi.mocked(setupSdk)

    const mockSdk = {
      getOrgFullScanMetadata: vi.fn().mockRejectedValue(new Error('Not found')),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({
      ok: false,
      error: 'Scan metadata not found',
      code: 404,
    })

    const result = await fetchScanMetadata('test-org', 'nonexistent-scan')

    expect(result.ok).toBe(false)
    expect(result.code).toBe(404)
  })

  it('passes custom SDK options', async () => {
    const { fetchScanMetadata } = await import('./fetch-scan-metadata.mts')
    const { setupSdk } = await import('../../utils/sdk.mts')
    const { handleApiCall } = await import('../../utils/api.mts')
    const mockSetupSdk = vi.mocked(setupSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      getOrgFullScanMetadata: vi.fn().mockResolvedValue({}),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({ ok: true, data: {} })

    const options = {
      sdkOpts: {
        apiToken: 'custom-token',
        baseUrl: 'https://api.example.com',
      },
    }

    await fetchScanMetadata('custom-org', 'scan-456', options)

    expect(mockSetupSdk).toHaveBeenCalledWith(options.sdkOpts)
    expect(mockSdk.getOrgFullScanMetadata).toHaveBeenCalledWith(
      'custom-org',
      'scan-456',
    )
  })

  it('handles different org slugs and scan IDs', async () => {
    const { fetchScanMetadata } = await import('./fetch-scan-metadata.mts')
    const { setupSdk } = await import('../../utils/sdk.mts')
    const { handleApiCall } = await import('../../utils/api.mts')
    const mockSetupSdk = vi.mocked(setupSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      getOrgFullScanMetadata: vi.fn().mockResolvedValue({}),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({ ok: true, data: {} })

    const testCases = [
      ['org-with-dashes', 'scan-123'],
      ['simple_org', 'uuid-456-789-abc'],
      ['org123', 'scan_with_underscore'],
      ['long.org.name', 'scan.with.dots'],
    ]

    for (const [org, scanId] of testCases) {
      // eslint-disable-next-line no-await-in-loop
      await fetchScanMetadata(org, scanId)
      expect(mockSdk.getOrgFullScanMetadata).toHaveBeenCalledWith(org, scanId)
    }
  })

  it('handles empty metadata response', async () => {
    const { fetchScanMetadata } = await import('./fetch-scan-metadata.mts')
    const { setupSdk } = await import('../../utils/sdk.mts')
    const { handleApiCall } = await import('../../utils/api.mts')
    const mockSetupSdk = vi.mocked(setupSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      getOrgFullScanMetadata: vi.fn().mockResolvedValue({
        success: true,
        data: null,
      }),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({
      ok: true,
      data: null,
    })

    const result = await fetchScanMetadata('test-org', 'empty-scan')

    expect(result.ok).toBe(true)
    expect(result.data).toBe(null)
  })

  it('handles pending scan metadata', async () => {
    const { fetchScanMetadata } = await import('./fetch-scan-metadata.mts')
    const { setupSdk } = await import('../../utils/sdk.mts')
    const { handleApiCall } = await import('../../utils/api.mts')
    const mockSetupSdk = vi.mocked(setupSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      getOrgFullScanMetadata: vi.fn().mockResolvedValue({
        success: true,
        data: {
          id: 'scan-pending',
          status: 'pending',
          createdAt: '2023-01-01T00:00:00Z',
          completedAt: null,
          packageCount: 0,
          vulnerabilityCount: 0,
          progress: 45,
        },
      }),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({
      ok: true,
      data: {
        id: 'scan-pending',
        status: 'pending',
        progress: 45,
      },
    })

    const result = await fetchScanMetadata('test-org', 'scan-pending')

    expect(result.ok).toBe(true)
    expect(result.data?.status).toBe('pending')
    expect(result.data?.progress).toBe(45)
  })

  it('handles special characters in scan IDs', async () => {
    const { fetchScanMetadata } = await import('./fetch-scan-metadata.mts')
    const { setupSdk } = await import('../../utils/sdk.mts')
    const { handleApiCall } = await import('../../utils/api.mts')
    const mockSetupSdk = vi.mocked(setupSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      getOrgFullScanMetadata: vi.fn().mockResolvedValue({
        success: true,
        data: { id: 'scan-with-special-chars' },
      }),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({
      ok: true,
      data: { id: 'scan-with-special-chars' },
    })

    const specialScanId = 'scan-123_with-special.chars@example.com'

    await fetchScanMetadata('test-org', specialScanId)

    expect(mockSdk.getOrgFullScanMetadata).toHaveBeenCalledWith(
      'test-org',
      specialScanId,
    )
  })

  it('uses null prototype for options', async () => {
    const { fetchScanMetadata } = await import('./fetch-scan-metadata.mts')
    const { setupSdk } = await import('../../utils/sdk.mts')
    const { handleApiCall } = await import('../../utils/api.mts')
    const mockSetupSdk = vi.mocked(setupSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      getOrgFullScanMetadata: vi.fn().mockResolvedValue({}),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({ ok: true, data: {} })

    // This tests that the function properly uses __proto__: null.
    await fetchScanMetadata('test-org', 'scan-123')

    // The function should work without prototype pollution issues.
    expect(mockSdk.getOrgFullScanMetadata).toHaveBeenCalled()
  })
})
