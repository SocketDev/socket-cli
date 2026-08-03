/**
 * Unit tests for outputScanReport short mode.
 *
 * Purpose: Tests short-form output formatting for comprehensive scan
 * reports, across text, json, and markdown output kinds.
 *
 * Testing Approach: Uses result helpers and fixtures to create test data.
 * Validates formatted output strings across different output modes.
 *
 * Related Files: - src/commands/outputScanReport.mts (implementation)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { outputScanReport } from '../../../../src/commands/scan/output-scan-report.mts'

import type * as GenerateReportModule from '../../../../src/commands/scan/generate-report.mts'

// Mock logger.
const mockLogger = vi.hoisted(() => ({
  dir: vi.fn(),
  error: vi.fn(),
  fail: vi.fn(),
  info: vi.fn(),
  log: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
}))

vi.mock(import('@socketsecurity/lib-stable/logger/default'), () => ({
  getDefaultLogger: () => mockLogger,
}))

// Mock spinner.
const mockSpinner = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
}))

vi.mock(import('@socketsecurity/lib-stable/spinner/default'), () => ({
  getDefaultSpinner: () => mockSpinner,
}))

// Mock fs.
const mockWriteFile = vi.hoisted(() => vi.fn())

vi.mock(import('node:fs/promises'), () => ({
  default: {
    writeFile: mockWriteFile,
  },
}))

// Mock generateReport.
const mockGenerateReport = vi.hoisted(() => vi.fn())

vi.mock(
  import('../../../../src/commands/scan/generate-report.mts'),
  async orig => {
    const actual = await orig<typeof GenerateReportModule>()
    return {
      ...actual,
      generateReport: mockGenerateReport,
    }
  },
)

describe('output-scan-report', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
    mockWriteFile.mockResolvedValue(undefined)
  })

  describe('outputScanReport - short mode', () => {
    const baseConfig = {
      filepath: '',
      fold: 'none' as const,
      includeLicensePolicy: false,
      orgSlug: 'test-org',
      outputKind: 'text' as const,
      reportLevel: 'warn' as const,
      scanId: 'scan-123',
      short: false,
    }

    it('should output short format when short is true', async () => {
      const successResult = {
        ok: true as const,
        data: {
          scan: [],
          securityPolicy: { rules: [] },
        },
      }

      mockGenerateReport.mockReturnValue({
        ok: true,
        data: {
          alerts: new Map(),
          healthy: true,
          options: { fold: 'none', reportLevel: 'warn' },
          orgSlug: 'test-org',
          scanId: 'scan-123',
        },
      })

      await outputScanReport(successResult, { ...baseConfig, short: true })

      expect(mockLogger.log).toHaveBeenCalledWith('OK')
    })

    it('should output JSON in short mode using serializeResultJson', async () => {
      const successResult = {
        ok: true as const,
        data: {
          scan: [],
          securityPolicy: { rules: [] },
        },
      }
      mockGenerateReport.mockReturnValue({
        ok: true,
        data: {
          alerts: new Map(),
          healthy: true,
          options: { fold: 'none', reportLevel: 'warn' },
          orgSlug: 'test-org',
          scanId: 'scan-123',
        },
      })

      await outputScanReport(successResult, {
        ...baseConfig,
        outputKind: 'json',
        short: true,
      })

      // Short JSON mode uses serializeResultJson — should log JSON output.
      expect(mockLogger.log).toHaveBeenCalled()
    })

    it('should output ERR for unhealthy short format', async () => {
      const successResult = {
        ok: true as const,
        data: {
          scan: [],
          securityPolicy: { rules: [] },
        },
      }

      mockGenerateReport.mockReturnValue({
        ok: true,
        data: {
          alerts: new Map(),
          healthy: false,
          options: { fold: 'none', reportLevel: 'warn' },
          orgSlug: 'test-org',
          scanId: 'scan-123',
        },
      })

      await outputScanReport(successResult, { ...baseConfig, short: true })

      expect(mockLogger.log).toHaveBeenCalledWith('ERR')
    })

    it('should output short markdown format when short is true', async () => {
      const successResult = {
        ok: true as const,
        data: {
          scan: [],
          securityPolicy: { rules: [] },
        },
      }

      mockGenerateReport.mockReturnValue({
        ok: true,
        data: {
          alerts: new Map(),
          healthy: true,
          options: { fold: 'none', reportLevel: 'warn' },
          orgSlug: 'test-org',
          scanId: 'scan-123',
        },
      })

      await outputScanReport(successResult, {
        ...baseConfig,
        outputKind: 'markdown',
        short: true,
      })

      expect(mockLogger.log).toHaveBeenCalledWith('healthy = true')
    })
  })
})
