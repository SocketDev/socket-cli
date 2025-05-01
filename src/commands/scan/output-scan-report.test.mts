import { describe, expect, it } from 'vitest'

import { toJsonReport, toMarkdownReport } from './output-scan-report.mts'

import type { ScanReport } from './generate-report.mts'

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
            "orgSlug": "fakeorg",
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
            "orgSlug": "fakeorg",
            "scanId": "scan-ai-dee"
          }
        }
        "
      `)
    })
  })

  describe('toJsonReport', () => {
    it('should be able to generate a healthy md report', () => {
      expect(toMarkdownReport(getHealthyReport())).toMatchInlineSnapshot(`
        "# Scan Policy Report

        This report tells you whether the results of a Socket scan results violate the
        security policy set by your organization.

        ## Health status

        The scan *PASSES* all requirements set by your security policy.

        ## Settings

        Configuration used to generate this report:

        - Organization: fakeorg
        - Scan ID: scan-ai-dee
        - Alert folding: none
        - Minimal policy level for alert to be included in report: warn
        - Include license alerts: no

        ## Alerts

        The scan contained no alerts for with a policy set to at least "warn".
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

        - Organization: fakeorg
        - Scan ID: scan-ai-dee
        - Alert folding: none
        - Minimal policy level for alert to be included in report: warn
        - Include license alerts: no

        ## Alerts

        All the alerts from the scan with a policy set to at least "warn"}.

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
      reportLevel: 'warn'
    },
    orgSlug: 'fakeorg',
    scanId: 'scan-ai-dee'
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
                          url: 'https://socket.dev/npm/package/tslib/1.14.1'
                        }
                      ],
                      [
                        'envVars at 200:250',
                        {
                          manifest: ['package-lock.json'],
                          policy: 'error' as const,
                          type: 'envVars',
                          url: 'https://socket.dev/npm/package/tslib/1.14.1'
                        }
                      ]
                    ])
                  ]
                ])
              ]
            ])
          ]
        ])
      ]
    ]),
    healthy: false,
    options: {
      fold: 'none',
      reportLevel: 'warn'
    },
    orgSlug: 'fakeorg',
    scanId: 'scan-ai-dee'
  }
}
