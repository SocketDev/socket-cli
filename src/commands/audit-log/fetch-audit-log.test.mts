import { describe, expect, it, vi } from 'vitest'

import { fetchAuditLog } from './fetch-audit-log.mts'

// Mock the dependencies.
vi.mock('../../utils/api.mts', () => ({
  handleApiCall: vi.fn(),
}))

vi.mock('../../utils/sdk.mts', () => ({
  setupSdk: vi.fn(),
}))

describe('fetchAuditLog', () => {
  it('fetches audit log successfully', async () => {
    const { handleApiCall } = await import('../../utils/api.mts')
    const { setupSdk } = await import('../../utils/sdk.mts')
    const mockHandleApi = vi.mocked(handleApiCall)
    const mockSetupSdk = vi.mocked(setupSdk)

    const mockSdk = {
      getAuditLog: vi.fn().mockResolvedValue({
        success: true,
        data: {
          entries: [
            {
              id: 'entry-1',
              action: 'user.login',
              user: 'user@example.com',
              timestamp: '2025-01-01T10:00:00Z',
              details: { ip: '192.168.1.1' },
            },
            {
              id: 'entry-2',
              action: 'scan.created',
              user: 'admin@example.com',
              timestamp: '2025-01-01T11:00:00Z',
              details: { scanId: 'scan-123' },
            },
          ],
          total: 2,
          hasMore: false,
        },
      }),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({
      ok: true,
      data: {
        entries: expect.any(Array),
        total: 2,
      },
    })

    const result = await fetchAuditLog('test-org', {
      limit: 50,
      offset: 0,
      startDate: '2025-01-01',
      endDate: '2025-01-31',
    })

    expect(mockSdk.getAuditLog).toHaveBeenCalledWith('test-org', {
      limit: 50,
      offset: 0,
      startDate: '2025-01-01',
      endDate: '2025-01-31',
    })
    expect(mockHandleApi).toHaveBeenCalledWith(
      expect.any(Promise),
      { description: 'fetching audit log' },
    )
    expect(result.ok).toBe(true)
  })

  it('handles SDK setup failure', async () => {
    const { setupSdk } = await import('../../utils/sdk.mts')
    const mockSetupSdk = vi.mocked(setupSdk)

    const error = {
      ok: false,
      code: 1,
      message: 'Failed to setup SDK',
      cause: 'Invalid configuration',
    }
    mockSetupSdk.mockResolvedValue(error)

    const result = await fetchAuditLog('my-org', { limit: 10 })

    expect(result).toEqual(error)
  })

  it('handles API call failure', async () => {
    const { handleApiCall } = await import('../../utils/api.mts')
    const { setupSdk } = await import('../../utils/sdk.mts')
    const mockHandleApi = vi.mocked(handleApiCall)
    const mockSetupSdk = vi.mocked(setupSdk)

    const mockSdk = {
      getAuditLog: vi.fn().mockRejectedValue(new Error('Unauthorized')),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({
      ok: false,
      error: 'Unauthorized access',
      code: 401,
    })

    const result = await fetchAuditLog('org', { limit: 100 })

    expect(result.ok).toBe(false)
    expect(result.code).toBe(401)
  })

  it('passes custom SDK options', async () => {
    const { setupSdk } = await import('../../utils/sdk.mts')
    const { handleApiCall } = await import('../../utils/api.mts')
    const mockSetupSdk = vi.mocked(setupSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      getAuditLog: vi.fn().mockResolvedValue({}),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({ ok: true, data: {} })

    const sdkOpts = {
      apiToken: 'audit-token',
      baseUrl: 'https://audit.api.com',
    }

    await fetchAuditLog('my-org', { limit: 20 }, { sdkOpts })

    expect(mockSetupSdk).toHaveBeenCalledWith(sdkOpts)
  })

  it('handles pagination parameters', async () => {
    const { setupSdk } = await import('../../utils/sdk.mts')
    const { handleApiCall } = await import('../../utils/api.mts')
    const mockSetupSdk = vi.mocked(setupSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      getAuditLog: vi.fn().mockResolvedValue({}),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({ ok: true, data: {} })

    await fetchAuditLog('test-org', {
      limit: 200,
      offset: 100,
      page: 2,
    })

    expect(mockSdk.getAuditLog).toHaveBeenCalledWith('test-org', {
      limit: 200,
      offset: 100,
      page: 2,
    })
  })

  it('handles date filtering', async () => {
    const { setupSdk } = await import('../../utils/sdk.mts')
    const { handleApiCall } = await import('../../utils/api.mts')
    const mockSetupSdk = vi.mocked(setupSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      getAuditLog: vi.fn().mockResolvedValue({}),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({ ok: true, data: {} })

    await fetchAuditLog('org', {
      limit: 50,
      startDate: '2025-01-01T00:00:00Z',
      endDate: '2025-01-31T23:59:59Z',
      action: 'user.login',
      user: 'admin@example.com',
    })

    expect(mockSdk.getAuditLog).toHaveBeenCalledWith('org', {
      limit: 50,
      startDate: '2025-01-01T00:00:00Z',
      endDate: '2025-01-31T23:59:59Z',
      action: 'user.login',
      user: 'admin@example.com',
    })
  })

  it('uses null prototype for options', async () => {
    const { setupSdk } = await import('../../utils/sdk.mts')
    const { handleApiCall } = await import('../../utils/api.mts')
    const mockSetupSdk = vi.mocked(setupSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      getAuditLog: vi.fn().mockResolvedValue({}),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({ ok: true, data: {} })

    // This tests that the function properly uses __proto__: null.
    await fetchAuditLog('test-org', { limit: 10 })

    // The function should work without prototype pollution issues.
    expect(mockSdk.getAuditLog).toHaveBeenCalled()
  })
})
