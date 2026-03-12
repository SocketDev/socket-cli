/**
 * Unit tests for outputScanReport.
 *
 * Purpose:
 * Tests output formatting for comprehensive scan reports. Validates alert display, score formatting, and recommendation presentation.
 *
 * Test Coverage:
 * - Successful operation output formatting
 * - Error message formatting
 * - Multiple output formats (text, json, markdown)
 * - Data presentation and formatting
 * - Edge case handling
 *
 * Testing Approach:
 * Uses result helpers and fixtures to create test data. Validates formatted
 * output strings across different output modes.
 *
 * Related Files:
 * - src/commands/outputScanReport.mts (implementation)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  outputScanReport,
  toJsonReport,
  toMarkdownReport,
} from '../../../../src/commands/scan/output-scan-report.mts'
import { SOCKET_WEBSITE_URL } from '../../../../src/constants/socket.mts'

import type { ScanReport } from '../../../../src/commands/scan/generate-report.mts'

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

vi.mock('@socketsecurity/lib/logger', () => ({
  getDefaultLogger: () => mockLogger,
}))

// Mock spinner.
const mockSpinner = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
}))

vi.mock('@socketsecurity/lib/spinner', () => ({
  getDefaultSpinner: () => mockSpinner,
}))

// Mock fs.
const mockWriteFile = vi.hoisted(() => vi.fn())

vi.mock('node:fs/promises', () => ({
  default: {
    writeFile: mockWriteFile,
  },
}))

// Mock generateReport.
const mockGenerateReport = vi.hoisted(() => vi.fn())

vi.mock('../../../../src/commands/scan/generate-report.mts', async orig => {
  const actual =
    await orig<typeof import('../../../../src/commands/scan/generate-report.mts')>()
  return {
    ...actual,
    generateReport: mockGenerateReport,
  }
})

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

      await outputScanReport(successResult, { ...baseConfig, outputKind: 'json' })

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

      await outputScanReport(successResult, { ...baseConfig, outputKind: 'json' })

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


  describe('toJsonReport', () => {
    it('should be able to generate a healthy json report', () => {
      expect(toJsonReport(getHealthyReport())).toMatchInlineSnapshot(`
        "{
          "ok": true,
          "data": {
            "alerts": {},
            "healthy": true,
            "options": {
              "fold": "none",
              "reportLevel": "warn"
            },
            "orgSlug": "fakeOrg",
            "scanId": "scan-ai-dee"
          }
        }
        "
      `)
    })

    it('should be able to generate an unhealthy json report', () => {
      expect(toJsonReport(getUnhealthyReport())).toMatchInlineSnapshot(`
        "{
          "ok": true,
          "data": {
            "alerts": {
              "npm": {
                "tslib": {
                  "1.14.1": {
                    "package/which.js": {
                      "envVars at 54:72": {
                        "manifest": [
                          "package-lock.json"
                        ],
                        "policy": "error",
                        "type": "envVars",
                        "url": "https://socket.dev/npm/package/tslib/1.14.1"
                      },
                      "envVars at 200:250": {
                        "manifest": [
                          "package-lock.json"
                        ],
                        "policy": "error",
                        "type": "envVars",
                        "url": "https://socket.dev/npm/package/tslib/1.14.1"
                      }
                    }
                  }
                }
              }
            },
            "healthy": false,
            "options": {
              "fold": "none",
              "reportLevel": "warn"
            },
            "orgSlug": "fakeOrg",
            "scanId": "scan-ai-dee"
          }
        }
        "
      `)
    })
  })

  describe('toJsonReport - includeLicensePolicy', () => {
    it('should include includeLicensePolicy in JSON report', () => {
      const result = toJsonReport(getHealthyReport(), true)
      expect(result).toContain('"includeLicensePolicy": true')
    })

    it('should not include includeLicensePolicy when undefined', () => {
      const result = toJsonReport(getHealthyReport())
      expect(result).not.toContain('"includeLicensePolicy": true')
    })
  })

  describe('toMarkdownReport', () => {
    it('should include license policy info in markdown when enabled', () => {
      const report = getHealthyReport()
      const result = toMarkdownReport(report, true)
      expect(result).toContain('security or license policy')
      expect(result).toContain('security and license policy')
      expect(result).toContain('Include license alerts: yes')
    })

    it('should not include license policy info when disabled', () => {
      const report = getHealthyReport()
      const result = toMarkdownReport(report, false)
      expect(result).not.toContain('or license')
      expect(result).toContain('Include license alerts: no')
    })

    it('should show fold setting in markdown', () => {
      const report = {
        ...getHealthyReport(),
        options: {
          fold: 'version' as const,
          reportLevel: 'warn' as const,
        },
      }
      const result = toMarkdownReport(report)
      expect(result).toContain('Alert folding: up to version')
    })

    it('should be able to generate a healthy md report', () => {
      expect(toMarkdownReport(getHealthyReport())).toMatchInlineSnapshot(`
        "# Scan Policy Report

        This report tells you whether the results of a Socket scan results violate the
        security policy set by your organization.

        ## Health status

        The scan *PASSES* all requirements set by your security policy.

        ## Settings

        Configuration used to generate this report:

        - Organization: fakeOrg
        - Scan ID: scan-ai-dee
        - Alert folding: none
        - Minimal policy level for alert to be included in report: warn
        - Include license alerts: no

        ## Alerts

        The scan contained no alerts with a policy set to at least "warn".
        "
      `)
    })

    it('should be able to generate an unhealthy md report', () => {
      expect(toMarkdownReport(getUnhealthyReport())).toMatchInlineSnapshot(`
        "# Scan Policy Report

        This report tells you whether the results of a Socket scan results violate the
        security policy set by your organization.

        ## Health status

        The scan *VIOLATES* one or more policies set to the "error" level.

        ## Settings

        Configuration used to generate this report:

        - Organization: fakeOrg
        - Scan ID: scan-ai-dee
        - Alert folding: none
        - Minimal policy level for alert to be included in report: warn
        - Include license alerts: no

        ## Alerts

        All the alerts from the scan with a policy set to at least "warn".

        | ------ | ---------- | ------- | ------------- | ------------------------------------------- | ----------------- |
        | Policy | Alert Type | Package | Introduced by | url                                         | Manifest file     |
        | ------ | ---------- | ------- | ------------- | ------------------------------------------- | ----------------- |
        | error  | envVars    | tslib   | 1.14.1        | https://socket.dev/npm/package/tslib/1.14.1 | package-lock.json |
        | error  | envVars    | tslib   | 1.14.1        | https://socket.dev/npm/package/tslib/1.14.1 | package-lock.json |
        | ------ | ---------- | ------- | ------------- | ------------------------------------------- | ----------------- |
        "
      `)
    })
  })
})

function getHealthyReport(): ScanReport {
  return {
    alerts: new Map(),
    healthy: true,
    options: {
      fold: 'none',
      reportLevel: 'warn',
    },
    orgSlug: 'fakeOrg',
    scanId: 'scan-ai-dee',
  }
}

function getUnhealthyReport(): ScanReport {
  return {
    alerts: new Map([
      [
        'npm',
        new Map([
          [
            'tslib',
            new Map([
              [
                '1.14.1',
                new Map([
                  [
                    'package/which.js',
                    new Map([
                      [
                        'envVars at 54:72',
                        {
                          manifest: ['package-lock.json'],
                          policy: 'error' as const,
                          type: 'envVars',
                          url: `${SOCKET_WEBSITE_URL}/npm/package/tslib/1.14.1`,
                        },
                      ],
                      [
                        'envVars at 200:250',
                        {
                          manifest: ['package-lock.json'],
                          policy: 'error' as const,
                          type: 'envVars',
                          url: `${SOCKET_WEBSITE_URL}/npm/package/tslib/1.14.1`,
                        },
                      ],
                    ]),
                  ],
                ]),
              ],
            ]),
          ],
        ]),
      ],
    ]),
    healthy: false,
    options: {
      fold: 'none',
      reportLevel: 'warn',
    },
    orgSlug: 'fakeOrg',
    scanId: 'scan-ai-dee',
  }
}
