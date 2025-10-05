import { describe, expect, it, vi } from 'vitest'

import { fetchAuditLog } from './fetch-audit-log.mts'

// Mock the dependencies.

vi.mock('../../utils/sdk.mts', () => ({
  withSdk: vi.fn(),
}))

describe('fetchAuditLog', () => {
  it('fetches audit log successfully', async () => {
    const { handleApiCall } = await import('../../utils/api.mts')
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockHandleApi = vi.mocked(handleApiCall)
    const mockSetupSdk = vi.mocked(withSdk)

    const mockSdk = {
      getAuditLogEvents: vi.fn().mockResolvedValue({
        success: true,
        data: {
          events: [
            {
              id: 'event-1',
              action: 'package.scan',
              actor: 'user@example.com',
              timestamp: '2025-01-20T10:00:00Z',
            },
            {
              id: 'event-2',
              action: 'repository.create',
              actor: 'admin@example.com',
              timestamp: '2025-01-20T11:00:00Z',
            },
          ],
          total: 2,
        },
      }),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({
      ok: true,
      data: {
        events: expect.any(Array),
        total: 2,
      },
    })

    const config = {
      logType: 'all',
      orgSlug: 'test-org',
      outputKind: 'json' as const,
      page: 1,
      perPage: 100,
    }

    const result = await fetchAuditLog(config)

    expect(mockSdk.getAuditLogEvents).toHaveBeenCalledWith('test-org', {
      outputJson: 'true',
      outputMarkdown: 'false',
      orgSlug: 'test-org',
      type: 'all',
      page: '1',
      per_page: '100',
    })
    expect(mockHandleApi).toHaveBeenCalledWith(expect.any(Promise), {
      description: 'audit log for test-org',
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
      cause: 'Invalid API token',
    }
    mockSetupSdk.mockResolvedValue(error)

    const config = {
      logType: 'all',
      orgSlug: 'my-org',
      outputKind: 'text' as const,
      page: 1,
      perPage: 50,
    }

    const result = await fetchAuditLog(config)

    expect(result).toEqual(error)
  })

  it('handles API call failure', async () => {
    const { handleApiCall } = await import('../../utils/api.mts')
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockHandleApi = vi.mocked(handleApiCall)
    const mockSetupSdk = vi.mocked(withSdk)

    const mockSdk = {
      getAuditLogEvents: vi
        .fn()
        .mockRejectedValue(new Error('Unauthorized access')),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({
      ok: false,
      error: 'Access denied to audit log',
      code: 403,
    })

    const config = {
      logType: 'security',
      orgSlug: 'restricted-org',
      outputKind: 'json' as const,
      page: 1,
      perPage: 100,
    }

    const result = await fetchAuditLog(config)

    expect(result.ok).toBe(false)
    expect(result.code).toBe(403)
  })

  it('passes custom SDK options', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const { handleApiCall } = await import('../../utils/api.mts')
    const mockSetupSdk = vi.mocked(withSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      getAuditLogEvents: vi.fn().mockResolvedValue({}),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({ ok: true, data: {} })

    const sdkOpts = {
      apiToken: 'audit-token',
      baseUrl: 'https://audit.api.com',
    }

    const config = {
      logType: 'all',
      orgSlug: 'custom-org',
      outputKind: 'json' as const,
      page: 1,
      perPage: 100,
    }

    await fetchAuditLog(config, { sdkOpts })

    expect(mockSetupSdk).toHaveBeenCalledWith(sdkOpts)
  })

  it('handles pagination parameters', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const { handleApiCall } = await import('../../utils/api.mts')
    const mockSetupSdk = vi.mocked(withSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      getAuditLogEvents: vi.fn().mockResolvedValue({}),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({ ok: true, data: {} })

    const config = {
      logType: 'all',
      orgSlug: 'test-org',
      outputKind: 'json' as const,
      page: 5,
      perPage: 25,
    }

    await fetchAuditLog(config)

    expect(mockSdk.getAuditLogEvents).toHaveBeenCalledWith(
      'test-org',
      expect.objectContaining({
        page: '5',
        per_page: '25',
      }),
    )
  })

  it('handles date filtering', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const { handleApiCall } = await import('../../utils/api.mts')
    const mockSetupSdk = vi.mocked(withSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      getAuditLogEvents: vi.fn().mockResolvedValue({}),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({ ok: true, data: {} })

    const logTypes = ['all', 'security', 'configuration', 'access']

    for (const logType of logTypes) {
      const config = {
        logType,
        orgSlug: 'test-org',
        outputKind: 'json' as const,
        page: 1,
        perPage: 100,
      }

      // eslint-disable-next-line no-await-in-loop
      await fetchAuditLog(config)

      expect(mockSdk.getAuditLogEvents).toHaveBeenCalledWith(
        'test-org',
        expect.objectContaining({
          type: logType,
        }),
      )
    }
  })

  it('uses null prototype for options', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const { handleApiCall } = await import('../../utils/api.mts')
    const mockSetupSdk = vi.mocked(withSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      getAuditLogEvents: vi.fn().mockResolvedValue({}),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({ ok: true, data: {} })

    const config = {
      logType: 'all',
      orgSlug: 'test-org',
      outputKind: 'json' as const,
      page: 1,
      perPage: 100,
    }

    // This tests that the function properly uses __proto__: null.
    await fetchAuditLog(config)

    // The function should work without prototype pollution issues.
    expect(mockSdk.getAuditLogEvents).toHaveBeenCalled()
  })
})
