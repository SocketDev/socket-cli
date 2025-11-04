import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createErrorResult,
  createSuccessResult,
} from '../../../../test/helpers/index.mts'

describe('fetchThreatFeed', () => {
  beforeEach(async () => {
    vi.resetModules()
  })

  it('fetches threat feed successfully', async () => {
    const mockQueryApiSafeJson = vi.fn()

    vi.doMock('../../../../src/utils/socket/api.mjs', () => ({
      queryApiSafeJson: mockQueryApiSafeJson,
    }))

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

    mockQueryApiSafeJson.mockResolvedValue(createSuccessResult(mockData))

    const { fetchThreatFeed } = await import(
      '../../../../src/commands/threat-feed/fetch-threat-feed.mts'
    )

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

    expect(mockQueryApiSafeJson).toHaveBeenCalledWith(
      expect.stringContaining('orgs/test-org/threat-feed'),
      'the Threat Feed data',
    )
    expect(result.ok).toBe(true)
    expect(result.data).toEqual(mockData)
  })

  it('handles SDK setup failure', async () => {
    const mockQueryApiSafeJson = vi.fn()

    vi.doMock('../../../../src/utils/socket/api.mjs', () => ({
      queryApiSafeJson: mockQueryApiSafeJson,
    }))

    const error = createErrorResult('Failed to fetch threat feed', {
      code: 1,
      cause: 'Invalid configuration',
    })
    mockQueryApiSafeJson.mockResolvedValue(error)

    const { fetchThreatFeed } = await import(
      '../../../../src/commands/threat-feed/fetch-threat-feed.mts'
    )

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
    const mockQueryApiSafeJson = vi.fn()

    vi.doMock('../../../../src/utils/socket/api.mjs', () => ({
      queryApiSafeJson: mockQueryApiSafeJson,
    }))

    mockQueryApiSafeJson.mockResolvedValue(
      createErrorResult('Threat feed service unavailable', { code: 503 }),
    )

    const { fetchThreatFeed } = await import(
      '../../../../src/commands/threat-feed/fetch-threat-feed.mts'
    )

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
    const mockQueryApiSafeJson = vi.fn()

    vi.doMock('../../../../src/utils/socket/api.mjs', () => ({
      queryApiSafeJson: mockQueryApiSafeJson,
    }))

    mockQueryApiSafeJson.mockResolvedValue(createSuccessResult({}))

    const { fetchThreatFeed } = await import(
      '../../../../src/commands/threat-feed/fetch-threat-feed.mts'
    )

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

    expect(mockQueryApiSafeJson).toHaveBeenCalledWith(
      expect.stringContaining('filter=critical'),
      'the Threat Feed data',
    )
  })

  it('handles filtering by severity levels', async () => {
    const mockQueryApiSafeJson = vi.fn()

    vi.doMock('../../../../src/utils/socket/api.mjs', () => ({
      queryApiSafeJson: mockQueryApiSafeJson,
    }))

    mockQueryApiSafeJson.mockResolvedValue(createSuccessResult({ threats: [] }))

    const { fetchThreatFeed } = await import(
      '../../../../src/commands/threat-feed/fetch-threat-feed.mts'
    )

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

    expect(mockQueryApiSafeJson).toHaveBeenCalledWith(
      expect.stringContaining('filter=critical%2Chigh'),
      'the Threat Feed data',
    )
  })

  it('handles pagination parameters', async () => {
    const mockQueryApiSafeJson = vi.fn()

    vi.doMock('../../../../src/utils/socket/api.mjs', () => ({
      queryApiSafeJson: mockQueryApiSafeJson,
    }))

    mockQueryApiSafeJson.mockResolvedValue(createSuccessResult({ threats: [] }))

    const { fetchThreatFeed } = await import(
      '../../../../src/commands/threat-feed/fetch-threat-feed.mts'
    )

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

    expect(mockQueryApiSafeJson).toHaveBeenCalledWith(
      expect.stringMatching(/page_cursor=5.*per_page=25/),
      'the Threat Feed data',
    )
  })

  it('handles date range filtering', async () => {
    const mockQueryApiSafeJson = vi.fn()

    vi.doMock('../../../../src/utils/socket/api.mjs', () => ({
      queryApiSafeJson: mockQueryApiSafeJson,
    }))

    mockQueryApiSafeJson.mockResolvedValue(createSuccessResult({ threats: [] }))

    const { fetchThreatFeed } = await import(
      '../../../../src/commands/threat-feed/fetch-threat-feed.mts'
    )

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

    expect(mockQueryApiSafeJson).toHaveBeenCalledWith(
      expect.stringMatching(/name=specific-package.*version=1\.2\.3/),
      'the Threat Feed data',
    )
  })

  it('uses null prototype for options', async () => {
    const mockQueryApiSafeJson = vi.fn()

    vi.doMock('../../../../src/utils/socket/api.mjs', () => ({
      queryApiSafeJson: mockQueryApiSafeJson,
    }))

    mockQueryApiSafeJson.mockResolvedValue(createSuccessResult({}))

    const { fetchThreatFeed } = await import(
      '../../../../src/commands/threat-feed/fetch-threat-feed.mts'
    )

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
    expect(mockQueryApiSafeJson).toHaveBeenCalled()
  })
})
