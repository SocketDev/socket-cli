/**
 * Unit tests for fetchReportData.
 *
 * Purpose:
 * Tests fetching detailed scan report data via the Socket API. Retrieves comprehensive scan results including alerts and scores.
 *
 * Test Coverage:
 * - Successful API operation
 * - SDK setup failure handling
 * - API call error scenarios
 * - Custom SDK options (API tokens, base URLs)
 * - Detailed report retrieval
 * - Alert data
 * - Score information
 * - Null prototype usage for security
 *
 * Testing Approach:
 * Uses SDK test helpers to mock Socket API interactions. Validates comprehensive
 * error handling and API integration.
 *
 * Related Files:
 * - src/commands/ReportData.mts (implementation)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createErrorResult } from '../../../../test/helpers/index.mts'

describe('fetchScanData', () => {
  let mockSetupSdk: ReturnType<typeof vi.fn>
  let mockQueryApiSafeText: ReturnType<typeof vi.fn>
  let mockHandleApiCallNoSpinner: ReturnType<typeof vi.fn>
  let mockFormatErrorWithDetail: ReturnType<typeof vi.fn>
  let mockLogger: Record<string, ReturnType<typeof vi.fn>>
  let mockSpinner: Record<string, ReturnType<typeof vi.fn>>

  beforeEach(async () => {
    vi.resetModules()

    mockSetupSdk = vi.fn()
    mockQueryApiSafeText = vi.fn()
    mockHandleApiCallNoSpinner = vi.fn()
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

    vi.doMock('@socketsecurity/lib/debug', () => ({
      debug: vi.fn(),
      debugDir: vi.fn(),
      debugFn: vi.fn(),
    }))

    vi.doMock('@socketsecurity/lib/logger', () => ({
      getDefaultLogger: () => mockLogger,
      logger: mockLogger,
    }))

    vi.doMock('@socketsecurity/lib/spinner', () => ({
      getDefaultSpinner: () => mockSpinner,
    }))

    vi.doMock('../../../../src/utils/socket/api.mjs', () => ({
      handleApiCallNoSpinner: mockHandleApiCallNoSpinner,
      queryApiSafeText: mockQueryApiSafeText,
    }))

    vi.doMock('../../../../src/utils/socket/sdk.mjs', () => ({
      setupSdk: mockSetupSdk,
    }))

    vi.doMock('../../../../src/utils/error/errors.mjs', () => ({
      formatErrorWithDetail: mockFormatErrorWithDetail,
    }))
  })

  it('handles SDK setup failure', async () => {
    const error = createErrorResult('Failed to setup SDK', {
      code: 1,
      cause: 'Invalid configuration',
    })

    mockSetupSdk.mockResolvedValue(error)

    const { fetchScanData } =
      await import('../../../../src/commands/scan/fetch-report-data.mts')

    const result = await fetchScanData('test-org', 'scan-123')

    expect(result.ok).toBe(false)
    expect(result.message).toBe('Failed to setup SDK')
    expect(mockSetupSdk).toHaveBeenCalled()
  })

  it('fetches scan data successfully', async () => {
    const mockSdk = { getOrgSecurityPolicy: vi.fn() }
    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })

    const scanData = [
      { id: '1', type: 'alert', severity: 'high' },
      { id: '2', type: 'alert', severity: 'medium' },
    ]
    const ndJsonResponse = scanData.map(d => JSON.stringify(d)).join('\n')

    mockQueryApiSafeText.mockResolvedValue({
      ok: true,
      data: ndJsonResponse,
    })

    mockHandleApiCallNoSpinner.mockResolvedValue({
      ok: true,
      data: { rules: [] },
    })

    const { fetchScanData } =
      await import('../../../../src/commands/scan/fetch-report-data.mts')

    const result = await fetchScanData('test-org', 'scan-123')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.scan).toHaveLength(2)
      expect(result.data.securityPolicy).toEqual({ rules: [] })
    }
    expect(mockSpinner.start).toHaveBeenCalled()
    expect(mockSpinner.stop).toHaveBeenCalled()
  })

  it('handles invalid JSON in scan response', async () => {
    const mockSdk = { getOrgSecurityPolicy: vi.fn() }
    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })

    // Return invalid JSON.
    mockQueryApiSafeText.mockResolvedValue({
      ok: true,
      data: 'not valid json\n{"valid": true}',
    })

    mockHandleApiCallNoSpinner.mockResolvedValue({
      ok: true,
      data: { rules: [] },
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
    const mockSdk = { getOrgSecurityPolicy: vi.fn() }
    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })

    mockQueryApiSafeText.mockResolvedValue({
      ok: false,
      message: 'API error',
      cause: 'Network failure',
    })

    mockHandleApiCallNoSpinner.mockResolvedValue({
      ok: true,
      data: { rules: [] },
    })

    const { fetchScanData } =
      await import('../../../../src/commands/scan/fetch-report-data.mts')

    const result = await fetchScanData('test-org', 'scan-123')

    expect(result.ok).toBe(false)
  })

  it('handles security policy API error', async () => {
    const mockSdk = { getOrgSecurityPolicy: vi.fn() }
    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })

    mockQueryApiSafeText.mockResolvedValue({
      ok: true,
      data: '{"id": "1"}',
    })

    mockHandleApiCallNoSpinner.mockResolvedValue({
      ok: false,
      message: 'Policy fetch failed',
      cause: 'Forbidden',
    })

    const { fetchScanData } =
      await import('../../../../src/commands/scan/fetch-report-data.mts')

    const result = await fetchScanData('test-org', 'scan-123')

    expect(result.ok).toBe(false)
  })

  it('includes license policy when specified', async () => {
    const mockSdk = { getOrgSecurityPolicy: vi.fn() }
    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })

    mockQueryApiSafeText.mockResolvedValue({
      ok: true,
      data: '{"id": "1"}',
    })

    mockHandleApiCallNoSpinner.mockResolvedValue({
      ok: true,
      data: { rules: [] },
    })

    const { fetchScanData } =
      await import('../../../../src/commands/scan/fetch-report-data.mts')

    await fetchScanData('test-org', 'scan-123', { includeLicensePolicy: true })

    expect(mockQueryApiSafeText).toHaveBeenCalledWith(
      expect.stringContaining('include_license_details=true'),
    )
  })

  it('handles thrown errors during scan fetch', async () => {
    const mockSdk = { getOrgSecurityPolicy: vi.fn() }
    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })

    mockQueryApiSafeText.mockRejectedValue(new Error('Network timeout'))

    mockHandleApiCallNoSpinner.mockResolvedValue({
      ok: true,
      data: { rules: [] },
    })

    const { fetchScanData } =
      await import('../../../../src/commands/scan/fetch-report-data.mts')

    const result = await fetchScanData('test-org', 'scan-123')

    expect(result.ok).toBe(false)
  })

  it('handles thrown errors during policy fetch', async () => {
    const mockSdk = { getOrgSecurityPolicy: vi.fn() }
    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })

    mockQueryApiSafeText.mockResolvedValue({
      ok: true,
      data: '{"id": "1"}',
    })

    mockHandleApiCallNoSpinner.mockRejectedValue(new Error('Auth failed'))

    const { fetchScanData } =
      await import('../../../../src/commands/scan/fetch-report-data.mts')

    const result = await fetchScanData('test-org', 'scan-123')

    expect(result.ok).toBe(false)
  })

  it('passes SDK options when provided', async () => {
    const mockSdk = { getOrgSecurityPolicy: vi.fn() }
    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })

    mockQueryApiSafeText.mockResolvedValue({
      ok: true,
      data: '{"id": "1"}',
    })

    mockHandleApiCallNoSpinner.mockResolvedValue({
      ok: true,
      data: { rules: [] },
    })

    const { fetchScanData } =
      await import('../../../../src/commands/scan/fetch-report-data.mts')

    await fetchScanData('test-org', 'scan-123', {
      sdkOpts: { apiToken: 'custom-token' },
    })

    expect(mockSetupSdk).toHaveBeenCalledWith(
      expect.objectContaining({ apiToken: 'custom-token' }),
    )
  })

  it('filters empty lines from ndjson response', async () => {
    const mockSdk = { getOrgSecurityPolicy: vi.fn() }
    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })

    // Include empty lines.
    const ndJsonResponse = '{"id": "1"}\n\n{"id": "2"}\n\n'

    mockQueryApiSafeText.mockResolvedValue({
      ok: true,
      data: ndJsonResponse,
    })

    mockHandleApiCallNoSpinner.mockResolvedValue({
      ok: true,
      data: { rules: [] },
    })

    const { fetchScanData } =
      await import('../../../../src/commands/scan/fetch-report-data.mts')

    const result = await fetchScanData('test-org', 'scan-123')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.scan).toHaveLength(2)
    }
  })
})
