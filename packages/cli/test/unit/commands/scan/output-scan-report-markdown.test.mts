/**
 * Unit tests for toMarkdownReport.
 *
 * Purpose: Tests markdown report generation for comprehensive scan reports.
 * Validates alert table formatting, health status, and license policy
 * presentation.
 *
 * Testing Approach: Uses result helpers and fixtures to create test data.
 * Validates formatted markdown output strings.
 *
 * Related Files: - src/commands/outputScanReport.mts (implementation)
 */

import { describe, expect, it } from 'vitest'

import { toMarkdownReport } from '../../../../src/commands/scan/output-scan-report.mts'
import { SOCKET_WEBSITE_URL } from '../../../../src/constants/socket.mts'

import type { ScanReport } from '../../../../src/commands/scan/generate-report.mts'

describe('output-scan-report', () => {
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
