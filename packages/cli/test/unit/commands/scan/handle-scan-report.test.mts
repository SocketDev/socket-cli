/**
 * Unit tests for handleScanReport.
 *
 * Purpose:
 * Tests the handler that generates scan reports. Validates comprehensive report generation and formatting.
 *
 * Test Coverage:
 * - Successful operation flow
 * - Fetch failure handling
 * - Input validation
 * - Output formatting delegation
 * - Error propagation
 *
 * Testing Approach:
 * Mocks fetch and output functions to isolate handler orchestration logic.
 * Validates proper data flow through the handler pipeline.
 *
 * Related Files:
 * - src/commands/handleScanReport.mts (implementation)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createErrorResult,
  createSuccessResult,
} from '../../../../test/helpers/index.mts'

// Mock the dependencies.
const mockFetchScanData = vi.hoisted(() => vi.fn())
const mockOutputScanReport = vi.hoisted(() => vi.fn())
const mockSetupSdk = vi.hoisted(() => vi.fn())

vi.mock('../../../../src/commands/scan/fetch-report-data.mts', () => ({
  fetchScanData: mockFetchScanData,
}))

vi.mock('../../../../src/commands/scan/output-scan-report.mts', () => ({
  outputScanReport: mockOutputScanReport,
}))

vi.mock('../../../../src/utils/socket/sdk.mts', () => ({
  setupSdk: mockSetupSdk,
}))

describe('handleScanReport', () => {
  let handleScanReport: any

  beforeEach(async () => {
    vi.clearAllMocks()
    if (!handleScanReport) {
      const module = await import('../../../../src/commands/scan/handle-scan-report.mts')
      handleScanReport = module.handleScanReport
    }
  })

  it('fetches scan data and outputs report successfully', async () => {
    const mockFetch = mockFetchScanData
    const mockOutput = mockOutputScanReport
    const mockSetup = mockSetupSdk

    // Mock setupSdk to return success (not used directly by handleScanReport, but needed by fetchScanData)
    mockSetup.mockResolvedValue(createSuccessResult({ api: {} }))

    const mockScanData = createSuccessResult({
      scan: {
        id: 'scan-123',
        status: 'completed',
        packages: [],
      },
      issues: [],
    })
    mockFetch.mockResolvedValue(mockScanData)

    await handleScanReport({
      orgSlug: 'test-org',
      scanId: 'scan-123',
      includeLicensePolicy: true,
      outputKind: 'json',
      filepath: '/path/to/package.json',
      fold: 'none',
      reportLevel: 'high',
      short: false,
    })

    expect(mockFetch).toHaveBeenCalledWith('test-org', 'scan-123', {
      includeLicensePolicy: true,
    })
    expect(mockOutput).toHaveBeenCalledWith(mockScanData, {
      filepath: '/path/to/package.json',
      fold: 'none',
      scanId: 'scan-123',
      includeLicensePolicy: true,
      orgSlug: 'test-org',
      outputKind: 'json',
      reportLevel: 'high',
      short: false,
    })
  })

  it('handles fetch failure', async () => {
    const mockFetch = mockFetchScanData
    const mockOutput = mockOutputScanReport
    const mockSetup = mockSetupSdk

    mockSetup.mockResolvedValue(createSuccessResult({ api: {} }))

    const mockError = createErrorResult('Scan not found')
    mockFetch.mockResolvedValue(mockError)

    await handleScanReport({
      orgSlug: 'test-org',
      scanId: 'invalid-scan',
      includeLicensePolicy: false,
      outputKind: 'text',
      filepath: 'package.json',
      fold: 'all',
      reportLevel: 'critical',
      short: true,
    })

    expect(mockFetch).toHaveBeenCalledWith('test-org', 'invalid-scan', {
      includeLicensePolicy: false,
    })
    expect(mockOutput).toHaveBeenCalledWith(mockError, expect.any(Object))
  })

  it('handles markdown output format', async () => {
    const mockFetch = mockFetchScanData
    const mockOutput = mockOutputScanReport
    const mockSetup = mockSetupSdk

    mockSetup.mockResolvedValue(createSuccessResult({ api: {} }))
    mockFetch.mockResolvedValue(createSuccessResult({}))

    await handleScanReport({
      orgSlug: 'test-org',
      scanId: 'scan-456',
      includeLicensePolicy: false,
      outputKind: 'markdown',
      filepath: 'yarn.lock',
      fold: 'duplicates',
      reportLevel: 'medium',
      short: false,
    })

    expect(mockOutput).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        outputKind: 'markdown',
      }),
    )
  })

  it('passes all configuration options correctly', async () => {
    const mockFetch = mockFetchScanData
    const mockOutput = mockOutputScanReport
    const mockSetup = mockSetupSdk

    mockSetup.mockResolvedValue(createSuccessResult({ api: {} }))
    mockFetch.mockResolvedValue(createSuccessResult({}))

    const config = {
      orgSlug: 'my-org',
      scanId: 'scan-789',
      includeLicensePolicy: true,
      outputKind: 'json' as const,
      filepath: 'pnpm-lock.yaml',
      fold: 'none' as const,
      reportLevel: 'low' as const,
      short: true,
    }

    await handleScanReport(config)

    expect(mockOutput).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining(config),
    )
  })

  it('handles text output with short format', async () => {
    const mockFetch = mockFetchScanData
    const mockOutput = mockOutputScanReport
    const mockSetup = mockSetupSdk

    mockSetup.mockResolvedValue(createSuccessResult({ api: {} }))
    mockFetch.mockResolvedValue(
      createSuccessResult({
        scan: { id: 'scan-abc' },
        issues: [{ severity: 'high', package: 'vulnerable-pkg' }],
      }),
    )

    await handleScanReport({
      orgSlug: 'test-org',
      scanId: 'scan-abc',
      includeLicensePolicy: false,
      outputKind: 'text',
      filepath: 'package-lock.json',
      fold: 'all',
      reportLevel: 'high',
      short: true,
    })

    expect(mockOutput).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        short: true,
        outputKind: 'text',
      }),
    )
  })
})
