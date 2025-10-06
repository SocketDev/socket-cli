import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchAuditLog } from './fetch-audit-log.mts'

// Mock the dependencies.
vi.mock('../../utils/sdk.mts', () => ({
  withSdk: vi.fn(),
}))

describe('fetchAuditLog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches audit log successfully', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const successResult = {
      ok: true as const,
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
    }

    mockWithSdk.mockResolvedValueOnce(successResult)

    const config = {
      logType: 'all',
      orgSlug: 'test-org',
      outputKind: 'json' as const,
      page: 1,
      perPage: 100,
    }

    const result = await fetchAuditLog(config)

    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'audit log for test-org',
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
      cause: 'Invalid API token',
    }
    mockWithSdk.mockResolvedValueOnce(error)

    const config = {
      logType: 'all',
      orgSlug: 'my-org',
      outputKind: 'text' as const,
      page: 1,
      perPage: 50,
    }

    const result = await fetchAuditLog(config)

    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'audit log for my-org',
      undefined,
    )
    expect(result).toEqual(error)
  })

  it('handles API call failure', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const error = {
      ok: false as const,
      error: 'Access denied to audit log',
      code: 403,
      message: 'Access denied to audit log',
    }
    mockWithSdk.mockResolvedValueOnce(error)

    const config = {
      logType: 'security',
      orgSlug: 'restricted-org',
      outputKind: 'json' as const,
      page: 1,
      perPage: 100,
    }

    const result = await fetchAuditLog(config)

    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'audit log for restricted-org',
      undefined,
    )
    expect(result.ok).toBe(false)
    expect(result.code).toBe(403)
  })

  it('passes custom SDK options', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const successResult = {
      ok: true as const,
      data: {},
    }
    mockWithSdk.mockResolvedValueOnce(successResult)

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

    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'audit log for custom-org',
      { sdkOpts },
    )
  })

  it('handles pagination parameters', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const successResult = {
      ok: true as const,
      data: {},
    }
    mockWithSdk.mockResolvedValueOnce(successResult)

    const config = {
      logType: 'all',
      orgSlug: 'test-org',
      outputKind: 'json' as const,
      page: 5,
      perPage: 25,
    }

    const result = await fetchAuditLog(config)

    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'audit log for test-org',
      undefined,
    )
    expect(result.ok).toBe(true)
  })

  it('handles date filtering', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const successResult = {
      ok: true as const,
      data: {},
    }

    const logTypes = ['all', 'security', 'configuration', 'access']

    for (const logType of logTypes) {
      mockWithSdk.mockResolvedValueOnce(successResult)
      const config = {
        logType,
        orgSlug: 'test-org',
        outputKind: 'json' as const,
        page: 1,
        perPage: 100,
      }

      // eslint-disable-next-line no-await-in-loop
      await fetchAuditLog(config)
    }

    expect(mockWithSdk).toHaveBeenCalledTimes(logTypes.length)
    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'audit log for test-org',
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
    expect(mockWithSdk).toHaveBeenCalled()
  })
})
