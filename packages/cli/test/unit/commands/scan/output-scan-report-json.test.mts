/**
 * Unit tests for toJsonReport.
 *
 * Purpose: Tests JSON report generation for comprehensive scan reports.
 * Validates alert serialization and license policy inclusion.
 *
 * Testing Approach: Uses result helpers and fixtures to create test data.
 * Validates formatted JSON output strings.
 *
 * Related Files: - src/commands/outputScanReport.mts (implementation)
 */

import { describe, expect, it } from 'vitest'

import { toJsonReport } from '../../../../src/commands/scan/output-scan-report.mts'
import { SOCKET_WEBSITE_URL } from '../../../../src/constants/socket.mts'

import type { ScanReport } from '../../../../src/commands/scan/generate-report.mts'

describe('output-scan-report', () => {
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
