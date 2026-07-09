/**
 * Unit tests for outputScanReport.
 *
 * Purpose: Tests output formatting for comprehensive scan reports. Validates
 * alert display, score formatting, and recommendation presentation.
 *
 * Test Coverage: - Successful operation output formatting - Error message
 * formatting - Multiple output formats (text, json, markdown) - Edge case
 * handling.
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

  describe('outputScanReport', () => {
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

    it('should handle error result', async () => {
      const errorResult = {
        ok: false as const,
        message: 'API error',
        cause: 'Network failure',
        code: 1,
      }

      await outputScanReport(errorResult, baseConfig)

      expect(process.exitCode).toBe(1)
      expect(mockLogger.fail).toHaveBeenCalled()
    })

    it('should output JSON for error result when outputKind is json', async () => {
      const errorResult = {
        ok: false as const,
        message: 'API error',
        cause: 'Network failure',
      }

      await outputScanReport(errorResult, { ...baseConfig, outputKind: 'json' })

      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('"ok": false'),
      )
    })

    it('should handle successful result with healthy report', async () => {
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

      await outputScanReport(successResult, baseConfig)

      expect(process.exitCode).toBeUndefined()
      expect(mockLogger.dir).toHaveBeenCalled()
    })

    it('should set exit code 1 for unhealthy report', async () => {
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

      await outputScanReport(successResult, baseConfig)

      expect(process.exitCode).toBe(1)
    })

    it('should handle report generation failure', async () => {
      const successResult = {
        ok: true as const,
        data: {
          scan: [],
          securityPolicy: { rules: [] },
        },
      }

      mockGenerateReport.mockReturnValue({
        ok: false,
        message: 'Generation failed',
        cause: 'Invalid data',
        code: 2,
      })

      await outputScanReport(successResult, baseConfig)

      expect(process.exitCode).toBe(2)
      expect(mockLogger.fail).toHaveBeenCalled()
    })

    it('should output JSON for report generation failure when outputKind is json', async () => {
      const successResult = {
        ok: true as const,
        data: {
          scan: [],
          securityPolicy: { rules: [] },
        },
      }

      mockGenerateReport.mockReturnValue({
        ok: false,
        message: 'Generation failed',
        cause: 'Invalid data',
      })

      await outputScanReport(successResult, {
        ...baseConfig,
        outputKind: 'json',
      })

      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('"ok": false'),
      )
    })

    it('should output JSON format when outputKind is json', async () => {
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
      })

      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('"ok": true'),
      )
    })

    it('should write JSON to file when filepath is specified', async () => {
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
        filepath: '/tmp/report.json',
      })

      expect(mockWriteFile).toHaveBeenCalledWith(
        '/tmp/report.json',
        expect.any(String),
      )
    })

    it('should output markdown format', async () => {
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
      })

      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('# Scan Policy Report'),
      )
    })

    it('should write markdown to file when filepath ends with .md', async () => {
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
        filepath: '/tmp/report.md',
      })

      expect(mockWriteFile).toHaveBeenCalledWith(
        '/tmp/report.md',
        expect.stringContaining('# Scan Policy Report'),
      )
    })

    it('should detect json file from filepath extension', async () => {
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
        outputKind: 'text',
        filepath: '/tmp/report.json',
      })

      expect(mockWriteFile).toHaveBeenCalledWith(
        '/tmp/report.json',
        expect.stringContaining('"ok": true'),
      )
    })

    it('should output to stdout when filepath is -', async () => {
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
        filepath: '-',
      })

      expect(mockWriteFile).not.toHaveBeenCalled()
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('"ok": true'),
      )
    })
  })
})
