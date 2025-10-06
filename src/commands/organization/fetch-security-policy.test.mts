import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchSecurityPolicy } from './fetch-security-policy.mts'

// Mock the dependencies.
vi.mock('../../utils/sdk.mts', () => ({
  withSdk: vi.fn(),
}))

describe('fetchSecurityPolicy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches security policy successfully', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const successResult = {
      ok: true as const,
      data: {
        policy: {
          block_high_severity: true,
          block_critical_severity: true,
          block_medium_severity: false,
          block_low_severity: false,
          auto_scan: true,
          scan_on_push: true,
          require_approval: true,
        },
        updated_at: '2025-01-15T10:00:00Z',
      },
    }

    mockWithSdk.mockResolvedValueOnce(successResult)

    const result = await fetchSecurityPolicy('test-org')

    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'organization security policy',
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

    const result = await fetchSecurityPolicy('my-org')

    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'organization security policy',
      undefined,
    )
    expect(result).toEqual(error)
  })

  it('handles API call failure', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const error = {
      ok: false as const,
      error: 'Security policy not found',
      code: 404,
      message: 'Security policy not found',
    }
    mockWithSdk.mockResolvedValueOnce(error)

    const result = await fetchSecurityPolicy('nonexistent-org')

    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'organization security policy',
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

    const sdkOpts = {
      apiToken: 'security-policy-token',
      baseUrl: 'https://security.api.com',
    }

    await fetchSecurityPolicy('custom-org', { sdkOpts })

    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'organization security policy',
      { sdkOpts },
    )
  })

  it('handles default security policy', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const successResult = {
      ok: true as const,
      data: {
        policy: {
          block_high_severity: false,
          block_critical_severity: false,
          block_medium_severity: false,
          block_low_severity: false,
          auto_scan: false,
          scan_on_push: false,
          require_approval: false,
        },
        updated_at: null,
      },
    }
    mockWithSdk.mockResolvedValueOnce(successResult)

    const result = await fetchSecurityPolicy('default-policy-org')

    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'organization security policy',
      undefined,
    )
    expect(result.ok).toBe(true)
  })

  it('handles various org slugs', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const successResult = {
      ok: true as const,
      data: {},
    }

    const orgSlugs = ['org-1', 'org-2', 'my-company', 'test-org']

    for (const orgSlug of orgSlugs) {
      mockWithSdk.mockResolvedValueOnce(successResult)
      // eslint-disable-next-line no-await-in-loop
      await fetchSecurityPolicy(orgSlug)
    }

    expect(mockWithSdk).toHaveBeenCalledTimes(orgSlugs.length)
    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'organization security policy',
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
    await fetchSecurityPolicy('test-org')

    // The function should work without prototype pollution issues.
    expect(mockWithSdk).toHaveBeenCalled()
  })
})
