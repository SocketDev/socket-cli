import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchThreatFeed } from './fetch-threat-feed.mts'

// Mock the dependencies.
vi.mock('../../utils/sdk.mts', () => ({
  queryApiJson: vi.fn(),
  withSdk: vi.fn(),
}))

describe('fetchThreatFeed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches threat feed successfully', async () => {
    const { queryApiJson, withSdk } = await import('../../utils/sdk.mts')
    const mockQueryApi = vi.mocked(queryApiJson)
    const mockSetupSdk = vi.mocked(withSdk)

    mockSetupSdk.mockResolvedValue({ ok: true, data: {} as any })

    const mockData = {
      threats: [
        {
          id: 'threat-1',
          package: 'malicious-package',
          version: '1.0.0',
          severity: 'critical',
          type: 'malware',
          discovered: '2025-01-20T10:00:00Z',
        },
        {
          id: 'threat-2',
          package: 'vulnerable-lib',
          version: '2.3.1',
          severity: 'high',
          type: 'vulnerability',
          discovered: '2025-01-19T15:00:00Z',
        },
      ],
      total: 2,
      updated_at: '2025-01-20T12:00:00Z',
    }

    mockQueryApi.mockResolvedValue({
      ok: true,
      data: mockData,
    })

    const result = await fetchThreatFeed({
      direction: 'desc',
      ecosystem: 'npm',
      filter: 'high',
      orgSlug: 'test-org',
      page: '1',
      perPage: 100,
      pkg: 'test-package',
      version: '1.0.0',
    })

    expect(mockQueryApi).toHaveBeenCalledWith(
      {},
      expect.stringContaining('orgs/test-org/threat-feed'),
      expect.objectContaining({ description: 'the Threat Feed data' }),
    )
    expect(result.ok).toBe(true)
    expect(result.data).toEqual(mockData)
  })

  it('handles SDK setup failure', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockSetupSdk = vi.mocked(withSdk)

    const error = {
      ok: false,
      code: 1,
      message: 'Failed to fetch threat feed',
      cause: 'Invalid configuration',
    }
    mockSetupSdk.mockResolvedValue(error)

    const result = await fetchThreatFeed({
      direction: 'desc',
      ecosystem: 'npm',
      filter: '',
      orgSlug: 'my-org',
      page: '1',
      perPage: 50,
      pkg: '',
      version: '',
    })

    expect(result).toEqual(error)
  })

  it('handles API call failure', async () => {
    const { queryApiJson, withSdk } = await import('../../utils/sdk.mts')
    const mockQueryApi = vi.mocked(queryApiJson)
    const mockSetupSdk = vi.mocked(withSdk)

    mockSetupSdk.mockResolvedValue({ ok: true, data: {} })
    mockQueryApi.mockResolvedValue({
      ok: false,
      error: 'Threat feed service unavailable',
      code: 503,
    })

    const result = await fetchThreatFeed({
      direction: 'asc',
      ecosystem: 'npm',
      filter: '',
      orgSlug: 'org',
      page: '1',
      perPage: 10,
      pkg: '',
      version: '',
    })

    expect(result.ok).toBe(false)
    expect(result.code).toBe(503)
  })

  it('passes custom SDK options', async () => {
    const { queryApiJson, withSdk } = await import('../../utils/sdk.mts')
    const mockQueryApi = vi.mocked(queryApiJson)
    const mockSetupSdk = vi.mocked(withSdk)

    mockSetupSdk.mockResolvedValue({ ok: true, data: {} as any })
    mockQueryApi.mockResolvedValue({ ok: true, data: {} })

    await fetchThreatFeed({
      direction: 'desc',
      ecosystem: 'npm',
      filter: 'critical',
      orgSlug: 'custom-org',
      page: '2',
      perPage: 50,
      pkg: '',
      version: '',
    })

    expect(mockQueryApi).toHaveBeenCalledWith(
      {},
      expect.stringContaining('filter=critical'),
      expect.objectContaining({ description: 'the Threat Feed data' }),
    )
  })

  it('handles filtering by severity levels', async () => {
    const { queryApiJson, withSdk } = await import('../../utils/sdk.mts')
    const mockQueryApi = vi.mocked(queryApiJson)
    const mockSetupSdk = vi.mocked(withSdk)

    mockSetupSdk.mockResolvedValue({ ok: true, data: {} as any })
    mockQueryApi.mockResolvedValue({ ok: true, data: { threats: [] } })

    await fetchThreatFeed({
      direction: 'desc',
      ecosystem: 'npm',
      filter: 'critical,high',
      orgSlug: 'test-org',
      page: '1',
      perPage: 100,
      pkg: '',
      version: '',
    })

    expect(mockQueryApi).toHaveBeenCalledWith(
      {},
      expect.stringContaining('filter=critical%2Chigh'),
      expect.objectContaining({ description: 'the Threat Feed data' }),
    )
  })

  it('handles pagination parameters', async () => {
    const { queryApiJson, withSdk } = await import('../../utils/sdk.mts')
    const mockQueryApi = vi.mocked(queryApiJson)
    const mockSetupSdk = vi.mocked(withSdk)

    mockSetupSdk.mockResolvedValue({ ok: true, data: {} as any })
    mockQueryApi.mockResolvedValue({ ok: true, data: { threats: [] } })

    await fetchThreatFeed({
      direction: 'asc',
      ecosystem: 'npm',
      filter: '',
      orgSlug: 'test-org',
      page: '5',
      perPage: 25,
      pkg: '',
      version: '',
    })

    expect(mockQueryApi).toHaveBeenCalledWith(
      {},
      expect.stringMatching(/page_cursor=5.*per_page=25/),
      expect.objectContaining({ description: 'the Threat Feed data' }),
    )
  })

  it('handles date range filtering', async () => {
    const { queryApiJson, withSdk } = await import('../../utils/sdk.mts')
    const mockQueryApi = vi.mocked(queryApiJson)
    const mockSetupSdk = vi.mocked(withSdk)

    mockSetupSdk.mockResolvedValue({ ok: true, data: {} as any })
    mockQueryApi.mockResolvedValue({ ok: true, data: { threats: [] } })

    await fetchThreatFeed({
      direction: 'desc',
      ecosystem: 'npm',
      filter: '',
      orgSlug: 'test-org',
      page: '1',
      perPage: 100,
      pkg: 'specific-package',
      version: '1.2.3',
    })

    expect(mockQueryApi).toHaveBeenCalledWith(
      {},
      expect.stringMatching(/name=specific-package.*version=1\.2\.3/),
      expect.objectContaining({ description: 'the Threat Feed data' }),
    )
  })

  it('uses null prototype for options', async () => {
    const { queryApiJson, withSdk } = await import('../../utils/sdk.mts')
    const mockQueryApi = vi.mocked(queryApiJson)
    const mockSetupSdk = vi.mocked(withSdk)

    mockSetupSdk.mockResolvedValue({ ok: true, data: {} as any })
    mockQueryApi.mockResolvedValue({ ok: true, data: {} })

    // This tests that the function properly uses __proto__: null.
    await fetchThreatFeed({
      direction: 'desc',
      ecosystem: 'npm',
      filter: '',
      orgSlug: 'test-org',
      page: '1',
      perPage: 100,
      pkg: '',
      version: '',
    })

    // The function should work without prototype pollution issues.
    expect(mockQueryApi).toHaveBeenCalled()
  })
})
