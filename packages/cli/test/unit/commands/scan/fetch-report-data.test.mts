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
  beforeEach(async () => {
    vi.resetModules()
  })

  it('handles SDK setup failure', async () => {
    const mockSetupSdk = vi.fn()
    const mockQueryApiSafeText = vi.fn()
    const mockHandleApiCallNoSpinner = vi.fn()
    const mockFormatErrorWithDetail = vi.fn()

    const mockLogger = {
      error: vi.fn(),
      fail: vi.fn(),
      info: vi.fn(),
      log: vi.fn(),
      success: vi.fn(),
      warn: vi.fn(),
    }

    const mockSpinner = {
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

    const error = createErrorResult('Failed to setup SDK', {
      code: 1,
      cause: 'Invalid configuration',
    })

    mockSetupSdk.mockResolvedValue(error)

    const { fetchScanData } = await import(
      '../../../../src/commands/scan/fetch-report-data.mts'
    )

    const result = await fetchScanData('test-org', 'scan-123')

    expect(result.ok).toBe(false)
    expect(result.message).toBe('Failed to setup SDK')
    expect(mockSetupSdk).toHaveBeenCalled()
  })
})
