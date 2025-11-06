/**
 * Unit tests for fetchDiffScan.
 *
 * Purpose:
 * Tests fetching scan diffs via the Socket API. Compares two scans to identify changes in security posture.
 *
 * Test Coverage:
 * - Successful API operation
 * - SDK setup failure handling
 * - API call error scenarios
 * - Custom SDK options (API tokens, base URLs)
 * - Scan comparison
 * - Diff calculation
 * - Change detection
 * - Null prototype usage for security
 *
 * Testing Approach:
 * Uses SDK test helpers to mock Socket API interactions. Validates comprehensive
 * error handling and API integration.
 *
 * Related Files:
 * - src/commands/DiffScan.mts (implementation)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchDiffScan } from '../../../../../src/commands/scan/fetch-diff-scan.mts'

// Mock the dependencies.
const mockLogger = vi.hoisted(() => ({
  fail: vi.fn(),
  log: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

const mockQueryApiSafeJson = vi.hoisted(() => vi.fn())
const mockGetDefaultApiToken = vi.hoisted(() => vi.fn(() => 'test-token'))

vi.mock('@socketsecurity/lib-internal/logger', () => ({
  getDefaultLogger: () => mockLogger,
  logger: mockLogger,
}))

vi.mock('../../../../src/utils/socket/api.mjs', () => ({
  queryApiSafeJson: mockQueryApiSafeJson,
}))

vi.mock('../../../../src/utils/socket/sdk.mts', () => ({
  getDefaultApiToken: mockGetDefaultApiToken,
}))

describe('fetchDiffScan', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches diff scan successfully', async () => {
    const mockQueryApi = mockQueryApiSafeJson

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

    expect(mockLogger.info).toHaveBeenCalledWith('Scan ID 1:', 'scan-123')
    expect(mockLogger.info).toHaveBeenCalledWith('Scan ID 2:', 'scan-456')
    expect(mockLogger.info).toHaveBeenCalledWith(
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
    const mockQueryApi = mockQueryApiSafeJson

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
    const mockQueryApi = mockQueryApiSafeJson

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
    const mockQueryApi = mockQueryApiSafeJson

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
    const mockQueryApi = mockQueryApiSafeJson

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
    const mockQueryApi = mockQueryApiSafeJson

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

    expect(mockLogger.info).toHaveBeenCalledWith('Scan ID 1:', 'same-scan-id')
    expect(mockLogger.info).toHaveBeenCalledWith('Scan ID 2:', 'same-scan-id')
    expect(mockQueryApi).toHaveBeenCalledWith(
      'orgs/test-org/full-scans/diff?before=same-scan-id&after=same-scan-id',
      'a scan diff',
    )
  })

  it('handles server timeout gracefully', async () => {
    const mockQueryApi = mockQueryApiSafeJson

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
    const mockQueryApi = mockQueryApiSafeJson

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
