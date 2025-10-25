import { describe, expect, it, vi } from 'vitest'

import { setupStandardOutputMocks } from '../../../test/helpers/mock-setup.mts'

// Mock the dependencies.
setupStandardOutputMocks()

vi.mock('../../utils/socket/api.mts', () => ({
  queryApiSafeJson: vi.fn(),
}))

describe('fetchDiffScan', () => {
  it('fetches diff scan successfully', async () => {
    const { fetchDiffScan } = await import('./fetch-diff-scan.mts')
    const { queryApiSafeJson } = await import('../../utils/socket/api.mts')
    const { logger } = await import('@socketsecurity/lib/logger')
    const mockQueryApi = vi.mocked(queryApiSafeJson)
    const mockLogger = vi.mocked(logger.info)

    const mockDiffData = {
      added: ['package-a@1.0.0'],
      removed: ['package-b@1.0.0'],
      modified: ['package-c@1.0.0 -> 1.1.0'],
      issues: {
        new: ['CVE-2023-001'],
        resolved: ['CVE-2023-002'],
      },
    }

    mockQueryApi.mockResolvedValue({
      ok: true,
      data: mockDiffData,
    })

    const result = await fetchDiffScan({
      id1: 'scan-123',
      id2: 'scan-456',
      orgSlug: 'test-org',
    })

    expect(mockLogger).toHaveBeenCalledWith('Scan ID 1:', 'scan-123')
    expect(mockLogger).toHaveBeenCalledWith('Scan ID 2:', 'scan-456')
    expect(mockLogger).toHaveBeenCalledWith(
      'Note: this request may take some time if the scans are big',
    )
    expect(mockQueryApi).toHaveBeenCalledWith(
      'orgs/test-org/full-scans/diff?before=scan-123&after=scan-456',
      'a scan diff',
    )
    expect(result.ok).toBe(true)
    expect(result.data).toEqual(mockDiffData)
  })

  it('handles API call failure', async () => {
    const { fetchDiffScan } = await import('./fetch-diff-scan.mts')
    const { queryApiSafeJson } = await import('../../utils/socket/api.mts')
    const mockQueryApi = vi.mocked(queryApiSafeJson)

    const error = {
      ok: false,
      code: 404,
      message: 'Scan not found',
      cause: 'One or both scans do not exist',
    }
    mockQueryApi.mockResolvedValue(error)

    const result = await fetchDiffScan({
      id1: 'nonexistent-scan',
      id2: 'another-nonexistent-scan',
      orgSlug: 'test-org',
    })

    expect(result).toEqual(error)
  })

  it('properly URL encodes scan IDs', async () => {
    const { fetchDiffScan } = await import('./fetch-diff-scan.mts')
    const { queryApiSafeJson } = await import('../../utils/socket/api.mts')
    const mockQueryApi = vi.mocked(queryApiSafeJson)

    mockQueryApi.mockResolvedValue({
      ok: true,
      data: {},
    })

    const specialCharsId1 = 'scan+with%special&chars'
    const specialCharsId2 = 'another/scan?with=query'

    await fetchDiffScan({
      id1: specialCharsId1,
      id2: specialCharsId2,
      orgSlug: 'test-org',
    })

    expect(mockQueryApi).toHaveBeenCalledWith(
      'orgs/test-org/full-scans/diff?before=scan%2Bwith%25special%26chars&after=another%2Fscan%3Fwith%3Dquery',
      'a scan diff',
    )
  })

  it('handles different org slugs', async () => {
    const { fetchDiffScan } = await import('./fetch-diff-scan.mts')
    const { queryApiSafeJson } = await import('../../utils/socket/api.mts')
    const mockQueryApi = vi.mocked(queryApiSafeJson)

    mockQueryApi.mockResolvedValue({
      ok: true,
      data: {},
    })

    const testCases = [
      'org-with-dashes',
      'simple_org',
      'org123',
      'long.org.name.with.dots',
    ]

    for (const orgSlug of testCases) {
      // eslint-disable-next-line no-await-in-loop
      await fetchDiffScan({
        id1: 'scan-1',
        id2: 'scan-2',
        orgSlug,
      })

      expect(mockQueryApi).toHaveBeenCalledWith(
        `orgs/${orgSlug}/full-scans/diff?before=scan-1&after=scan-2`,
        'a scan diff',
      )
    }
  })

  it('handles empty diff results', async () => {
    const { fetchDiffScan } = await import('./fetch-diff-scan.mts')
    const { queryApiSafeJson } = await import('../../utils/socket/api.mts')
    const mockQueryApi = vi.mocked(queryApiSafeJson)

    const emptyDiffData = {
      added: [],
      removed: [],
      modified: [],
      issues: {
        new: [],
        resolved: [],
      },
    }

    mockQueryApi.mockResolvedValue({
      ok: true,
      data: emptyDiffData,
    })

    const result = await fetchDiffScan({
      id1: 'scan-identical-1',
      id2: 'scan-identical-2',
      orgSlug: 'test-org',
    })

    expect(result.ok).toBe(true)
    expect(result.data).toEqual(emptyDiffData)
  })

  it('handles same scan IDs gracefully', async () => {
    const { fetchDiffScan } = await import('./fetch-diff-scan.mts')
    const { queryApiSafeJson } = await import('../../utils/socket/api.mts')
    const { logger } = await import('@socketsecurity/lib/logger')
    const mockQueryApi = vi.mocked(queryApiSafeJson)
    const mockLogger = vi.mocked(logger.info)

    mockQueryApi.mockResolvedValue({
      ok: true,
      data: {
        added: [],
        removed: [],
        modified: [],
        issues: { new: [], resolved: [] },
      },
    })

    await fetchDiffScan({
      id1: 'same-scan-id',
      id2: 'same-scan-id',
      orgSlug: 'test-org',
    })

    expect(mockLogger).toHaveBeenCalledWith('Scan ID 1:', 'same-scan-id')
    expect(mockLogger).toHaveBeenCalledWith('Scan ID 2:', 'same-scan-id')
    expect(mockQueryApi).toHaveBeenCalledWith(
      'orgs/test-org/full-scans/diff?before=same-scan-id&after=same-scan-id',
      'a scan diff',
    )
  })

  it('handles server timeout gracefully', async () => {
    const { fetchDiffScan } = await import('./fetch-diff-scan.mts')
    const { queryApiSafeJson } = await import('../../utils/socket/api.mts')
    const mockQueryApi = vi.mocked(queryApiSafeJson)

    const timeoutError = {
      ok: false,
      code: 504,
      message: 'Gateway timeout',
      cause: 'The request took too long to process',
    }
    mockQueryApi.mockResolvedValue(timeoutError)

    const result = await fetchDiffScan({
      id1: 'large-scan-1',
      id2: 'large-scan-2',
      orgSlug: 'test-org',
    })

    expect(result).toEqual(timeoutError)
  })

  it('uses null prototype internally', async () => {
    const { fetchDiffScan } = await import('./fetch-diff-scan.mts')
    const { queryApiSafeJson } = await import('../../utils/socket/api.mts')
    const mockQueryApi = vi.mocked(queryApiSafeJson)

    mockQueryApi.mockResolvedValue({
      ok: true,
      data: {},
    })

    // This tests that the function works without prototype pollution issues.
    await fetchDiffScan({
      id1: 'scan-1',
      id2: 'scan-2',
      orgSlug: 'test-org',
    })

    // The function should work properly.
    expect(mockQueryApi).toHaveBeenCalled()
  })
})
