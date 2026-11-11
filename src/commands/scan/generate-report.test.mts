import { describe, expect, it } from 'vitest'

import { generateReport } from './generate-report.mts'

import type { ScanReport } from './generate-report.mts'
import type { SocketArtifact } from '../../utils/alert/artifact.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

type SecurityPolicyData = SocketSdkSuccessResult<'getOrgSecurityPolicy'>['data']

// Existing fixtures model the policy response; translate it into the resolved
// per-alert actions returned by the full-scan API before exercising the report.
function withAlertActions(
  scan: SocketArtifact[],
  policy: SecurityPolicyData,
): SocketArtifact[] {
  const rules = policy.securityPolicyRules as
    | Record<string, { action?: string }>
    | undefined
  return scan.map(artifact => ({
    ...artifact,
    alerts: artifact.alerts?.flatMap(alert => {
      const action = rules?.[alert.type]?.action
      return action ? [{ ...alert, action }] : []
    }),
  }))
}

describe('generate-report', () => {
  it('grades alerts using the resolved action on each alert', () => {
    const scan = getScanWithEnvVars().map(artifact => ({
      ...artifact,
      alerts: artifact.alerts?.map(alert => ({ ...alert, action: 'error' as const })),
    }))

    const result = generateReport(scan, {
      orgSlug: 'fakeOrg',
      scanId: 'scan-ai-dee',
      fold: 'none',
      reportLevel: 'warn',
    })

    expect(result.ok && result.data.healthy).toBe(false)
  })

  it('skips alerts that have no resolved action', () => {
    const result = generateReport(getScanWithEnvVars(), {
      orgSlug: 'fakeOrg',
      scanId: 'scan-ai-dee',
      fold: 'none',
      reportLevel: 'warn',
    })

    expect(result.ok && result.data.healthy).toBe(true)
    expect(result.ok && 'alerts' in result.data && result.data.alerts.size).toBe(0)
  })

  it('should accept empty args', () => {
    const result = generateReport(withAlertActions([], { securityPolicyRules: [] } as SecurityPolicyData), {
        orgSlug: 'fakeOrg',
        scanId: 'scan-ai-dee',
        fold: 'none',
        reportLevel: 'warn',
      })

    expect(result).toMatchInlineSnapshot(`
      {
        "data": {
          "alerts": Map {},
          "healthy": true,
          "options": {
            "fold": "none",
            "reportLevel": "warn",
          },
          "orgSlug": "fakeOrg",
          "scanId": "scan-ai-dee",
        },
        "ok": true,
      }
    `)
  })

  describe('report shape', () => {
    describe('report-level=warn', () => {
      it('should return a healthy report without alerts when there are no violations', () => {
        const result = generateReport(withAlertActions(getSimpleCleanScan(), {
            securityPolicyRules: {
              gptSecurity: {
                action: 'ignore',
              },
            },
            securityPolicyDefault: 'medium',
          }), {
            orgSlug: 'fakeOrg',
            scanId: 'scan-ai-dee',
            fold: 'none',
            reportLevel: 'warn',
          })

        expect(result).toMatchInlineSnapshot(`
          {
            "data": {
              "alerts": Map {},
              "healthy": true,
              "options": {
                "fold": "none",
                "reportLevel": "warn",
              },
              "orgSlug": "fakeOrg",
              "scanId": "scan-ai-dee",
            },
            "ok": true,
          }
        `)
        expect(result.ok).toBe(true)
        expect(result.ok && result.data.healthy).toBe(true)
        expect((result.data as ScanReport)['alerts']?.size).toBe(0)
      })

      it('should return a sick report with alert when an alert violates at error', () => {
        const result = generateReport(withAlertActions(getScanWithEnvVars(), {
            securityPolicyRules: {
              envVars: {
                action: 'error',
              },
            },
            securityPolicyDefault: 'medium',
          }), {
            orgSlug: 'fakeOrg',
            scanId: 'scan-ai-dee',
            fold: 'none',
            reportLevel: 'warn',
          })

        expect(result).toMatchInlineSnapshot(`
          {
            "data": {
              "alerts": Map {
                "npm" => Map {
                  "tslib" => Map {
                    "1.14.1" => Map {
                      "package/which.js" => Map {
                        "envVars at 54:72" => {
                          "manifest": [
                            "package-lock.json",
                          ],
                          "policy": "error",
                          "type": "envVars",
                          "url": "https://socket.dev/npm/package/tslib/overview/1.14.1",
                        },
                        "envVars at 200:250" => {
                          "manifest": [
                            "package-lock.json",
                          ],
                          "policy": "error",
                          "type": "envVars",
                          "url": "https://socket.dev/npm/package/tslib/overview/1.14.1",
                        },
                      },
                    },
                  },
                },
              },
              "healthy": false,
              "options": {
                "fold": "none",
                "reportLevel": "warn",
              },
              "orgSlug": "fakeOrg",
              "scanId": "scan-ai-dee",
            },
            "message": "The report contains at least one alert that violates the policies set by your organization",
            "ok": true,
          }
        `)
        // "ok" only reports on the state of the command, not the report health
        expect(result.ok).toBe(true)
        // the report health itself should be false.
        expect(result.ok && result.data.healthy).toBe(false)
        expect((result.data as ScanReport)['alerts']?.size).toBe(1)
      })

      it('should return a healthy report with alert when an alert violates at warn', () => {
        const result = generateReport(withAlertActions(getScanWithEnvVars(), {
            securityPolicyRules: {
              envVars: {
                action: 'warn',
              },
            },
            securityPolicyDefault: 'medium',
          }), {
            orgSlug: 'fakeOrg',
            scanId: 'scan-ai-dee',
            fold: 'none',
            reportLevel: 'warn',
          })

        expect(result).toMatchInlineSnapshot(`
          {
            "data": {
              "alerts": Map {
                "npm" => Map {
                  "tslib" => Map {
                    "1.14.1" => Map {
                      "package/which.js" => Map {
                        "envVars at 54:72" => {
                          "manifest": [
                            "package-lock.json",
                          ],
                          "policy": "warn",
                          "type": "envVars",
                          "url": "https://socket.dev/npm/package/tslib/overview/1.14.1",
                        },
                        "envVars at 200:250" => {
                          "manifest": [
                            "package-lock.json",
                          ],
                          "policy": "warn",
                          "type": "envVars",
                          "url": "https://socket.dev/npm/package/tslib/overview/1.14.1",
                        },
                      },
                    },
                  },
                },
              },
              "healthy": true,
              "options": {
                "fold": "none",
                "reportLevel": "warn",
              },
              "orgSlug": "fakeOrg",
              "scanId": "scan-ai-dee",
            },
            "ok": true,
          }
        `)
        expect(result.ok).toBe(true)
        expect(result.ok && result.data.healthy).toBe(true)
        expect((result.data as ScanReport)['alerts']?.size).toBe(1)
      })

      it('should return a healthy report without alerts when an alert violates at monitor', () => {
        const result = generateReport(withAlertActions(getScanWithEnvVars(), {
            securityPolicyRules: {
              envVars: {
                action: 'monitor',
              },
            },
            securityPolicyDefault: 'medium',
          }), {
            orgSlug: 'fakeOrg',
            scanId: 'scan-ai-dee',
            fold: 'none',
            reportLevel: 'warn',
          })

        expect(result).toMatchInlineSnapshot(`
          {
            "data": {
              "alerts": Map {},
              "healthy": true,
              "options": {
                "fold": "none",
                "reportLevel": "warn",
              },
              "orgSlug": "fakeOrg",
              "scanId": "scan-ai-dee",
            },
            "ok": true,
          }
        `)
        expect(result.ok).toBe(true)
        expect(result.ok && result.data.healthy).toBe(true)
        expect((result.data as ScanReport)['alerts']?.size).toBe(0)
      })

      it('should return a healthy report without alerts when an alert violates at ignore', () => {
        const result = generateReport(withAlertActions(getScanWithEnvVars(), {
            securityPolicyRules: {
              envVars: {
                action: 'ignore',
              },
            },
            securityPolicyDefault: 'medium',
          }), {
            orgSlug: 'fakeOrg',
            scanId: 'scan-ai-dee',
            fold: 'none',
            reportLevel: 'warn',
          })

        expect(result).toMatchInlineSnapshot(`
          {
            "data": {
              "alerts": Map {},
              "healthy": true,
              "options": {
                "fold": "none",
                "reportLevel": "warn",
              },
              "orgSlug": "fakeOrg",
              "scanId": "scan-ai-dee",
            },
            "ok": true,
          }
        `)
        expect(result.ok).toBe(true)
        expect(result.ok && result.data.healthy).toBe(true)
        expect((result.data as ScanReport)['alerts']?.size).toBe(0)
      })

      it('should return a healthy report without alerts when an alert violates at defer', () => {
        const result = generateReport(withAlertActions(getScanWithEnvVars(), {
            securityPolicyRules: {
              envVars: {
                action: 'defer',
              },
            },
            securityPolicyDefault: 'medium',
          }), {
            orgSlug: 'fakeOrg',
            scanId: 'scan-ai-dee',
            fold: 'none',
            reportLevel: 'warn',
          })

        expect(result).toMatchInlineSnapshot(`
          {
            "data": {
              "alerts": Map {},
              "healthy": true,
              "options": {
                "fold": "none",
                "reportLevel": "warn",
              },
              "orgSlug": "fakeOrg",
              "scanId": "scan-ai-dee",
            },
            "ok": true,
          }
        `)
        expect(result.ok).toBe(true)
        expect(result.ok && result.data.healthy).toBe(true)
        expect((result.data as ScanReport)['alerts']?.size).toBe(0)
      })

      it('should return a healthy report without alerts when an alert has no policy value', () => {
        const result = generateReport(withAlertActions(getScanWithEnvVars(), {
            securityPolicyRules: {
              envVars: {},
            },
            securityPolicyDefault: 'medium',
          } as SecurityPolicyData), {
            orgSlug: 'fakeOrg',
            scanId: 'scan-ai-dee',
            fold: 'none',
            reportLevel: 'warn',
          })

        expect(result).toMatchInlineSnapshot(`
          {
            "data": {
              "alerts": Map {},
              "healthy": true,
              "options": {
                "fold": "none",
                "reportLevel": "warn",
              },
              "orgSlug": "fakeOrg",
              "scanId": "scan-ai-dee",
            },
            "ok": true,
          }
        `)
        expect(result.ok).toBe(true)
        expect(result.ok && result.data.healthy).toBe(true)
        expect((result.data as ScanReport)['alerts']?.size).toBe(0)
      })

      it('should return a healthy report without alerts when an alert has no policy entry', () => {
        const result = generateReport(withAlertActions(getScanWithEnvVars(), {
            securityPolicyRules: {},
            securityPolicyDefault: 'medium',
          }), {
            orgSlug: 'fakeOrg',
            scanId: 'scan-ai-dee',
            fold: 'none',
            reportLevel: 'warn',
          })

        expect(result).toMatchInlineSnapshot(`
          {
            "data": {
              "alerts": Map {},
              "healthy": true,
              "options": {
                "fold": "none",
                "reportLevel": "warn",
              },
              "orgSlug": "fakeOrg",
              "scanId": "scan-ai-dee",
            },
            "ok": true,
          }
        `)
        expect(result.ok).toBe(true)
        expect(result.ok && result.data.healthy).toBe(true)
        expect((result.data as ScanReport)['alerts']?.size).toBe(0)
      })
    })

    describe('report-level=ignore', () => {
      it('should return a healthy report without alerts when there are no violations', () => {
        const result = generateReport(withAlertActions(getSimpleCleanScan(), {
            securityPolicyRules: {
              gptSecurity: {
                action: 'ignore',
              },
            },
            securityPolicyDefault: 'medium',
          }), {
            orgSlug: 'fakeOrg',
            scanId: 'scan-ai-dee',
            fold: 'none',
            reportLevel: 'ignore',
          })

        expect(result).toMatchInlineSnapshot(`
          {
            "data": {
              "alerts": Map {},
              "healthy": true,
              "options": {
                "fold": "none",
                "reportLevel": "ignore",
              },
              "orgSlug": "fakeOrg",
              "scanId": "scan-ai-dee",
            },
            "ok": true,
          }
        `)
        expect(result.ok).toBe(true)
        expect(result.ok && result.data.healthy).toBe(true)
        expect((result.data as ScanReport)['alerts']?.size).toBe(0)
      })

      it('should return a sick report with alert when an alert violates at error', () => {
        const result = generateReport(withAlertActions(getScanWithEnvVars(), {
            securityPolicyRules: {
              envVars: {
                action: 'error',
              },
            },
            securityPolicyDefault: 'medium',
          }), {
            orgSlug: 'fakeOrg',
            scanId: 'scan-ai-dee',
            fold: 'none',
            reportLevel: 'ignore',
          })

        expect(result).toMatchInlineSnapshot(`
          {
            "data": {
              "alerts": Map {
                "npm" => Map {
                  "tslib" => Map {
                    "1.14.1" => Map {
                      "package/which.js" => Map {
                        "envVars at 54:72" => {
                          "manifest": [
                            "package-lock.json",
                          ],
                          "policy": "error",
                          "type": "envVars",
                          "url": "https://socket.dev/npm/package/tslib/overview/1.14.1",
                        },
                        "envVars at 200:250" => {
                          "manifest": [
                            "package-lock.json",
                          ],
                          "policy": "error",
                          "type": "envVars",
                          "url": "https://socket.dev/npm/package/tslib/overview/1.14.1",
                        },
                      },
                    },
                  },
                },
              },
              "healthy": false,
              "options": {
                "fold": "none",
                "reportLevel": "ignore",
              },
              "orgSlug": "fakeOrg",
              "scanId": "scan-ai-dee",
            },
            "message": "The report contains at least one alert that violates the policies set by your organization",
            "ok": true,
          }
        `)
        expect(result.ok).toBe(true)
        expect(result.ok && result.data.healthy).toBe(false)
        expect((result.data as ScanReport)['alerts']?.size).toBe(1)
      })

      it('should return a healthy report with alert when an alert violates at warn', () => {
        const result = generateReport(withAlertActions(getScanWithEnvVars(), {
            securityPolicyRules: {
              envVars: {
                action: 'warn',
              },
            },
            securityPolicyDefault: 'medium',
          }), {
            orgSlug: 'fakeOrg',
            scanId: 'scan-ai-dee',
            fold: 'none',
            reportLevel: 'ignore',
          })

        expect(result).toMatchInlineSnapshot(`
          {
            "data": {
              "alerts": Map {
                "npm" => Map {
                  "tslib" => Map {
                    "1.14.1" => Map {
                      "package/which.js" => Map {
                        "envVars at 54:72" => {
                          "manifest": [
                            "package-lock.json",
                          ],
                          "policy": "warn",
                          "type": "envVars",
                          "url": "https://socket.dev/npm/package/tslib/overview/1.14.1",
                        },
                        "envVars at 200:250" => {
                          "manifest": [
                            "package-lock.json",
                          ],
                          "policy": "warn",
                          "type": "envVars",
                          "url": "https://socket.dev/npm/package/tslib/overview/1.14.1",
                        },
                      },
                    },
                  },
                },
              },
              "healthy": true,
              "options": {
                "fold": "none",
                "reportLevel": "ignore",
              },
              "orgSlug": "fakeOrg",
              "scanId": "scan-ai-dee",
            },
            "ok": true,
          }
        `)
        expect(result.ok).toBe(true)
        expect(result.ok && result.data.healthy).toBe(true)
        expect((result.data as ScanReport)['alerts']?.size).toBe(1)
      })

      it('should return a healthy report with alert when an alert violates at monitor', () => {
        const result = generateReport(withAlertActions(getScanWithEnvVars(), {
            securityPolicyRules: {
              envVars: {
                action: 'monitor',
              },
            },
            securityPolicyDefault: 'medium',
          }), {
            orgSlug: 'fakeOrg',
            scanId: 'scan-ai-dee',
            fold: 'none',
            reportLevel: 'ignore',
          })

        expect(result).toMatchInlineSnapshot(`
          {
            "data": {
              "alerts": Map {
                "npm" => Map {
                  "tslib" => Map {
                    "1.14.1" => Map {
                      "package/which.js" => Map {
                        "envVars at 54:72" => {
                          "manifest": [
                            "package-lock.json",
                          ],
                          "policy": "monitor",
                          "type": "envVars",
                          "url": "https://socket.dev/npm/package/tslib/overview/1.14.1",
                        },
                        "envVars at 200:250" => {
                          "manifest": [
                            "package-lock.json",
                          ],
                          "policy": "monitor",
                          "type": "envVars",
                          "url": "https://socket.dev/npm/package/tslib/overview/1.14.1",
                        },
                      },
                    },
                  },
                },
              },
              "healthy": true,
              "options": {
                "fold": "none",
                "reportLevel": "ignore",
              },
              "orgSlug": "fakeOrg",
              "scanId": "scan-ai-dee",
            },
            "ok": true,
          }
        `)
        expect(result.ok).toBe(true)
        expect(result.ok && result.data.healthy).toBe(true)
        expect((result.data as ScanReport)['alerts']?.size).toBe(1)
      })

      it('should return a healthy report with alert when an alert violates at ignore', () => {
        const result = generateReport(withAlertActions(getScanWithEnvVars(), {
            securityPolicyRules: {
              envVars: {
                action: 'ignore',
              },
            },
            securityPolicyDefault: 'medium',
          }), {
            orgSlug: 'fakeOrg',
            scanId: 'scan-ai-dee',
            fold: 'none',
            reportLevel: 'ignore',
          })

        expect(result).toMatchInlineSnapshot(`
          {
            "data": {
              "alerts": Map {
                "npm" => Map {
                  "tslib" => Map {
                    "1.14.1" => Map {
                      "package/which.js" => Map {
                        "envVars at 54:72" => {
                          "manifest": [
                            "package-lock.json",
                          ],
                          "policy": "ignore",
                          "type": "envVars",
                          "url": "https://socket.dev/npm/package/tslib/overview/1.14.1",
                        },
                        "envVars at 200:250" => {
                          "manifest": [
                            "package-lock.json",
                          ],
                          "policy": "ignore",
                          "type": "envVars",
                          "url": "https://socket.dev/npm/package/tslib/overview/1.14.1",
                        },
                      },
                    },
                  },
                },
              },
              "healthy": true,
              "options": {
                "fold": "none",
                "reportLevel": "ignore",
              },
              "orgSlug": "fakeOrg",
              "scanId": "scan-ai-dee",
            },
            "ok": true,
          }
        `)
        expect(result.ok).toBe(true)
        expect(result.ok && result.data.healthy).toBe(true)
        expect((result.data as ScanReport)['alerts']?.size).toBe(1)
      })

      it('should return a healthy report without alerts when an alert violates at defer', () => {
        const result = generateReport(withAlertActions(getScanWithEnvVars(), {
            securityPolicyRules: {
              envVars: {
                action: 'defer',
              },
            },
            securityPolicyDefault: 'medium',
          }), {
            orgSlug: 'fakeOrg',
            scanId: 'scan-ai-dee',
            fold: 'none',
            reportLevel: 'ignore',
          })

        expect(result).toMatchInlineSnapshot(`
          {
            "data": {
              "alerts": Map {},
              "healthy": true,
              "options": {
                "fold": "none",
                "reportLevel": "ignore",
              },
              "orgSlug": "fakeOrg",
              "scanId": "scan-ai-dee",
            },
            "ok": true,
          }
        `)
        expect(result.ok).toBe(true)
        expect(result.ok && result.data.healthy).toBe(true)
        expect((result.data as ScanReport)['alerts']?.size).toBe(0)
      })

      it('should return a healthy report without alerts when an alert has no policy value', () => {
        const result = generateReport(withAlertActions(getScanWithEnvVars(), {
            securityPolicyRules: {
              envVars: {},
            },
            securityPolicyDefault: 'medium',
          } as SecurityPolicyData), {
            orgSlug: 'fakeOrg',
            scanId: 'scan-ai-dee',
            fold: 'none',
            reportLevel: 'ignore',
          })

        expect(result).toMatchInlineSnapshot(`
          {
            "data": {
              "alerts": Map {},
              "healthy": true,
              "options": {
                "fold": "none",
                "reportLevel": "ignore",
              },
              "orgSlug": "fakeOrg",
              "scanId": "scan-ai-dee",
            },
            "ok": true,
          }
        `)
        expect(result.ok).toBe(true)
        expect(result.ok && result.data.healthy).toBe(true)
        expect((result.data as ScanReport)['alerts']?.size).toBe(0)
      })

      it('should return a healthy report without alerts when an alert has no policy entry', () => {
        const result = generateReport(withAlertActions(getScanWithEnvVars(), {
            securityPolicyRules: {},
            securityPolicyDefault: 'medium',
          }), {
            orgSlug: 'fakeOrg',
            scanId: 'scan-ai-dee',
            fold: 'none',
            reportLevel: 'ignore',
          })

        expect(result).toMatchInlineSnapshot(`
          {
            "data": {
              "alerts": Map {},
              "healthy": true,
              "options": {
                "fold": "none",
                "reportLevel": "ignore",
              },
              "orgSlug": "fakeOrg",
              "scanId": "scan-ai-dee",
            },
            "ok": true,
          }
        `)
        expect(result.ok).toBe(true)
        expect(result.ok && result.data.healthy).toBe(true)
        expect((result.data as ScanReport)['alerts']?.size).toBe(0)
      })
    })
  })

  describe('fold', () => {
    it('should not fold anything when fold=none', () => {
      const result = generateReport(withAlertActions(getScanWithEnvVars(), {
          securityPolicyRules: {
            envVars: {
              action: 'error',
            },
          },
          securityPolicyDefault: 'medium',
        }), {
          orgSlug: 'fakeOrg',
          scanId: 'scan-ai-dee',
          fold: 'none',
          reportLevel: 'warn',
        })

      expect(result).toMatchInlineSnapshot(`
        {
          "data": {
            "alerts": Map {
              "npm" => Map {
                "tslib" => Map {
                  "1.14.1" => Map {
                    "package/which.js" => Map {
                      "envVars at 54:72" => {
                        "manifest": [
                          "package-lock.json",
                        ],
                        "policy": "error",
                        "type": "envVars",
                        "url": "https://socket.dev/npm/package/tslib/overview/1.14.1",
                      },
                      "envVars at 200:250" => {
                        "manifest": [
                          "package-lock.json",
                        ],
                        "policy": "error",
                        "type": "envVars",
                        "url": "https://socket.dev/npm/package/tslib/overview/1.14.1",
                      },
                    },
                  },
                },
              },
            },
            "healthy": false,
            "options": {
              "fold": "none",
              "reportLevel": "warn",
            },
            "orgSlug": "fakeOrg",
            "scanId": "scan-ai-dee",
          },
          "message": "The report contains at least one alert that violates the policies set by your organization",
          "ok": true,
        }
      `)
    })

    it('should fold the file locations when fold=file', () => {
      const result = generateReport(withAlertActions(getScanWithEnvVars(), {
          securityPolicyRules: {
            envVars: {
              action: 'error',
            },
          },
          securityPolicyDefault: 'medium',
        }), {
          orgSlug: 'fakeOrg',
          scanId: 'scan-ai-dee',
          fold: 'file',
          reportLevel: 'warn',
        })

      expect(result).toMatchInlineSnapshot(`
        {
          "data": {
            "alerts": Map {
              "npm" => Map {
                "tslib" => Map {
                  "1.14.1" => Map {
                    "package/which.js" => {
                      "manifest": [
                        "package-lock.json",
                      ],
                      "policy": "error",
                      "type": "envVars",
                      "url": "https://socket.dev/npm/package/tslib/overview/1.14.1",
                    },
                  },
                },
              },
            },
            "healthy": false,
            "options": {
              "fold": "file",
              "reportLevel": "warn",
            },
            "orgSlug": "fakeOrg",
            "scanId": "scan-ai-dee",
          },
          "message": "The report contains at least one alert that violates the policies set by your organization",
          "ok": true,
        }
      `)
    })

    it('should fold the files up when fold=version', () => {
      const result = generateReport(withAlertActions(getScanWithEnvVars(), {
          securityPolicyRules: {
            envVars: {
              action: 'error',
            },
          },
          securityPolicyDefault: 'medium',
        }), {
          orgSlug: 'fakeOrg',
          scanId: 'scan-ai-dee',
          fold: 'version',
          reportLevel: 'warn',
        })

      expect(result).toMatchInlineSnapshot(`
        {
          "data": {
            "alerts": Map {
              "npm" => Map {
                "tslib" => Map {
                  "1.14.1" => {
                    "manifest": [
                      "package-lock.json",
                    ],
                    "policy": "error",
                    "type": "envVars",
                    "url": "https://socket.dev/npm/package/tslib/overview/1.14.1",
                  },
                },
              },
            },
            "healthy": false,
            "options": {
              "fold": "version",
              "reportLevel": "warn",
            },
            "orgSlug": "fakeOrg",
            "scanId": "scan-ai-dee",
          },
          "message": "The report contains at least one alert that violates the policies set by your organization",
          "ok": true,
        }
      `)
    })

    it('should fold the versions up when fold=pkg', () => {
      const result = generateReport(withAlertActions(getScanWithEnvVars(), {
          securityPolicyRules: {
            envVars: {
              action: 'error',
            },
          },
          securityPolicyDefault: 'medium',
        }), {
          orgSlug: 'fakeOrg',
          scanId: 'scan-ai-dee',
          fold: 'pkg',
          reportLevel: 'warn',
        })

      expect(result).toMatchInlineSnapshot(`
        {
          "data": {
            "alerts": Map {
              "npm" => Map {
                "tslib" => {
                  "manifest": [
                    "package-lock.json",
                  ],
                  "policy": "error",
                  "type": "envVars",
                  "url": "https://socket.dev/npm/package/tslib/overview/1.14.1",
                },
              },
            },
            "healthy": false,
            "options": {
              "fold": "pkg",
              "reportLevel": "warn",
            },
            "orgSlug": "fakeOrg",
            "scanId": "scan-ai-dee",
          },
          "message": "The report contains at least one alert that violates the policies set by your organization",
          "ok": true,
        }
      `)
    })
  })
})

function getSimpleCleanScan(): SocketArtifact[] {
  return [
    {
      id: '12521',
      author: ['typescript-bot'],
      size: 33965,
      type: 'npm',
      name: 'tslib',
      version: '1.14.1',
      license: '0BSD',
      licenseDetails: [],
      score: {
        license: 1,
        maintenance: 0.86,
        overall: 0.86,
        quality: 1,
        supplyChain: 1,
        vulnerability: 1,
      },
      alerts: [],
      manifestFiles: [
        {
          file: 'package-lock.json',
          start: 600172,
          end: 600440,
        },
      ],
      topLevelAncestors: ['15903631404'],
    },
  ]
}

function getScanWithEnvVars(): SocketArtifact[] {
  return [
    {
      id: '12521',
      author: ['typescript-bot'],
      size: 33965,
      type: 'npm',
      name: 'tslib',
      version: '1.14.1',
      license: '0BSD',
      licenseDetails: [],
      score: {
        license: 1,
        maintenance: 0.86,
        overall: 0.86,
        quality: 1,
        supplyChain: 1,
        vulnerability: 1,
      },
      alerts: [
        {
          key: 'QEW1uRmLsj4EBOTv3wb0NZ3W4ziYZVheU5uTpYPC6txs',
          type: 'envVars',
          severity: 'low',
          category: 'supplyChainRisk',
          file: 'package/which.js',
          start: 54,
          end: 72,
          props: {
            // @ts-ignore
            envVars: 'XYZ',
          },
        },
        {
          key: 'QEW1uRmLsj4EBOTv3wb0NZ3W4ziYZVheU5uTpYPC6txy',
          type: 'envVars',
          severity: 'low',
          category: 'supplyChainRisk',
          file: 'package/which.js',
          start: 200,
          end: 250,
          props: {
            // @ts-ignore
            envVars: 'ABC',
          },
        },
      ],
      manifestFiles: [
        {
          file: 'package-lock.json',
          start: 600172,
          end: 600440,
        },
      ],
      topLevelAncestors: ['15903631404'],
    },
  ]
}
