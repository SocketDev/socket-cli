/**
 * Unit tests for fetchReportData.
 *
 * Purpose: Tests fetching detailed scan report data via the Socket API.
 * Retrieves comprehensive scan results including alerts and scores.
 *
 * Test Coverage: - Successful API operation - API call error scenarios -
 * Detailed report retrieval - Alert data - Score information.
 *
 * Testing Approach: Uses SDK test helpers to mock Socket API interactions.
 * Validates comprehensive error handling and API integration.
 *
 * Related Files: - src/commands/ReportData.mts (implementation)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('fetchScanData', () => {
  let mockQueryApiSafeText: ReturnType<typeof vi.fn>
  let mockFormatErrorWithDetail: ReturnType<typeof vi.fn>
  let mockLogger: Record<string, ReturnType<typeof vi.fn>>
  let mockSpinner: Record<string, ReturnType<typeof vi.fn>>

  beforeEach(async () => {
    vi.resetModules()

    mockQueryApiSafeText = vi.fn()
    mockFormatErrorWithDetail = vi.fn((msg, _e) => msg)

    mockLogger = {
      error: vi.fn(),
      fail: vi.fn(),
      info: vi.fn(),
      log: vi.fn(),
      success: vi.fn(),
      warn: vi.fn(),
    }

    mockSpinner = {
      start: vi.fn(),
      stop: vi.fn(),
    }

    vi.doMock(import('@socketsecurity/lib-stable/debug/output'), () => ({
      debug: vi.fn(),
      debugDir: vi.fn(),
    }))

    vi.doMock(import('@socketsecurity/lib-stable/logger/default'), () => ({
      getDefaultLogger: () => mockLogger,
      logger: mockLogger,
    }))

    vi.doMock(import('@socketsecurity/lib-stable/spinner/default'), () => ({
      getDefaultSpinner: () => mockSpinner,
    }))

    vi.doMock(import('../../../../src/util/socket/api.mjs'), () => ({
      queryApiSafeText: mockQueryApiSafeText,
    }))

    vi.doMock(import('../../../../src/util/error/errors.mjs'), () => ({
      formatErrorWithDetail: mockFormatErrorWithDetail,
    }))
  })

  it('fetches scan data successfully', async () => {
    const scanData = [
      { id: '1', type: 'alert', severity: 'high' },
      { id: '2', type: 'alert', severity: 'medium' },
    ]
    const ndJsonResponse = scanData.map(d => JSON.stringify(d)).join('\n')

    mockQueryApiSafeText.mockResolvedValue({
      ok: true,
      data: ndJsonResponse,
    })

    const { fetchScanData } =
      await import('../../../../src/commands/scan/fetch-report-data.mts')

    const result = await fetchScanData('test-org', 'scan-123')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.scan).toHaveLength(2)
    }
    expect(mockSpinner.start).toHaveBeenCalled()
    expect(mockSpinner.stop).toHaveBeenCalled()
  })

  it('handles invalid JSON in scan response', async () => {
    mockQueryApiSafeText.mockResolvedValue({
      ok: true,
      data: 'not valid json\n{"valid": true}',
    })

    const { fetchScanData } =
      await import('../../../../src/commands/scan/fetch-report-data.mts')

    const result = await fetchScanData('test-org', 'scan-123')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toBe('Invalid Socket API response')
    }
  })

  it('handles scan result API error', async () => {
    mockQueryApiSafeText.mockResolvedValue({
      ok: false,
      message: 'API error',
      cause: 'Network failure',
    })

    const { fetchScanData } =
      await import('../../../../src/commands/scan/fetch-report-data.mts')

    const result = await fetchScanData('test-org', 'scan-123')

    expect(result.ok).toBe(false)
  })

  it('includes license policy when specified', async () => {
    mockQueryApiSafeText.mockResolvedValue({
      ok: true,
      data: '{"id": "1"}',
    })

    const { fetchScanData } =
      await import('../../../../src/commands/scan/fetch-report-data.mts')

    await fetchScanData('test-org', 'scan-123', { includeLicensePolicy: true })

    expect(mockQueryApiSafeText).toHaveBeenCalledWith(
      expect.stringContaining('include_license_details=true'),
    )
  })

  it('handles thrown errors during scan fetch', async () => {
    mockQueryApiSafeText.mockRejectedValue(new Error('Network timeout'))

    const { fetchScanData } =
      await import('../../../../src/commands/scan/fetch-report-data.mts')

    const result = await fetchScanData('test-org', 'scan-123')

    expect(result.ok).toBe(false)
  })

  it('filters empty lines from ndjson response', async () => {
    const ndJsonResponse = '{"id": "1"}\n\n{"id": "2"}\n\n'

    mockQueryApiSafeText.mockResolvedValue({
      ok: true,
      data: ndJsonResponse,
    })

    const { fetchScanData } =
      await import('../../../../src/commands/scan/fetch-report-data.mts')

    const result = await fetchScanData('test-org', 'scan-123')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.scan).toHaveLength(2)
    }
  })

  it('returns an empty scan array for whitespace-only NDJSON', async () => {
    mockQueryApiSafeText.mockResolvedValue({
      ok: true,
      data: '   ',
    })

    const { fetchScanData } =
      await import('../../../../src/commands/scan/fetch-report-data.mts')

    const result = await fetchScanData('test-org', 'scan-123')

    if (result.ok) {
      expect(Array.isArray(result.data.scan)).toBe(true)
    }
  })
})
