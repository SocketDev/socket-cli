import { describe, expect, it } from 'vitest'

import { generateReport } from './generate-report.mts'

import type { ScanReport } from './generate-report.mts'
import type { components } from '@socketsecurity/sdk/types/api'

describe('generate-report', () => {
  it('should accept empty args', () => {
    const result = generateReport(
      [],
      { securityPolicyRules: [] },
      {
        orgSlug: 'fakeorg',
        scanId: 'scan-ai-dee',
        fold: 'none',
        reportLevel: 'warn'
      }
    )

    expect(result).toMatchInlineSnapshot(`
      {
        "alerts": Map {},
        "healthy": true,
        "options": {
          "fold": "none",
          "reportLevel": "warn",
        },
        "orgSlug": "fakeorg",
        "scanId": "scan-ai-dee",
      }
    `)
  })

  describe('report shape', () => {
    describe('report-level=warn', () => {
      it('should return a healthy report without alerts when there are no violations', () => {
        const result = generateReport(
          getSimpleCleanScan(),
          {
            securityPolicyRules: {
              gptSecurity: {
                action: 'ignore'
              }
            },
            securityPolicyDefault: 'medium'
          },
          {
            orgSlug: 'fakeorg',
            scanId: 'scan-ai-dee',
            fold: 'none',
            reportLevel: 'warn'
          }
        )

        expect(result).toMatchInlineSnapshot(`
          {
            "alerts": Map {},
            "healthy": true,
            "options": {
              "fold": "none",
              "reportLevel": "warn",
            },
            "orgSlug": "fakeorg",
            "scanId": "scan-ai-dee",
          }
        `)
        expect(result.healthy).toBe(true)
        expect((result as ScanReport)['alerts']?.size).toBe(0)
      })

      it('should return a sick report with alert when an alert violates at error', () => {
        const result = generateReport(
          getScanWithEnvVars(),
          {
            securityPolicyRules: {
              envVars: {
                action: 'error'
              }
            },
            securityPolicyDefault: 'medium'
          },
          {
            orgSlug: 'fakeorg',
            scanId: 'scan-ai-dee',
            fold: 'none',
            reportLevel: 'warn'
          }
        )

        expect(result).toMatchInlineSnapshot(`
          {
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
                        "url": "https://socket.dev/npm/package/tslib/1.14.1",
                      },
                      "envVars at 200:250" => {
                        "manifest": [
                          "package-lock.json",
                        ],
                        "policy": "error",
                        "type": "envVars",
                        "url": "https://socket.dev/npm/package/tslib/1.14.1",
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
            "orgSlug": "fakeorg",
            "scanId": "scan-ai-dee",
          }
        `)
        expect(result.healthy).toBe(false)
        expect((result as ScanReport)['alerts']?.size).toBe(1)
      })

      it('should return a healthy report with alert when an alert violates at warn', () => {
        const result = generateReport(
          getScanWithEnvVars(),
          {
            securityPolicyRules: {
              envVars: {
                action: 'warn'
              }
            },
            securityPolicyDefault: 'medium'
          },
          {
            orgSlug: 'fakeorg',
            scanId: 'scan-ai-dee',
            fold: 'none',
            reportLevel: 'warn'
          }
        )

        expect(result).toMatchInlineSnapshot(`
          {
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
                        "url": "https://socket.dev/npm/package/tslib/1.14.1",
                      },
                      "envVars at 200:250" => {
                        "manifest": [
                          "package-lock.json",
                        ],
                        "policy": "warn",
                        "type": "envVars",
                        "url": "https://socket.dev/npm/package/tslib/1.14.1",
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
            "orgSlug": "fakeorg",
            "scanId": "scan-ai-dee",
          }
        `)
        expect(result.healthy).toBe(true)
        expect((result as ScanReport)['alerts']?.size).toBe(1)
      })

      it('should return a healthy report without alerts when an alert violates at monitor', () => {
        const result = generateReport(
          getScanWithEnvVars(),
          {
            securityPolicyRules: {
              envVars: {
                action: 'monitor'
              }
            },
            securityPolicyDefault: 'medium'
          },
          {
            orgSlug: 'fakeorg',
            scanId: 'scan-ai-dee',
            fold: 'none',
            reportLevel: 'warn'
          }
        )

        expect(result).toMatchInlineSnapshot(`
          {
            "alerts": Map {},
            "healthy": true,
            "options": {
              "fold": "none",
              "reportLevel": "warn",
            },
            "orgSlug": "fakeorg",
            "scanId": "scan-ai-dee",
          }
        `)
        expect(result.healthy).toBe(true)
        expect((result as ScanReport)['alerts']?.size).toBe(0)
      })

      it('should return a healthy report without alerts when an alert violates at ignore', () => {
        const result = generateReport(
          getScanWithEnvVars(),
          {
            securityPolicyRules: {
              envVars: {
                action: 'ignore'
              }
            },
            securityPolicyDefault: 'medium'
          },
          {
            orgSlug: 'fakeorg',
            scanId: 'scan-ai-dee',
            fold: 'none',
            reportLevel: 'warn'
          }
        )

        expect(result).toMatchInlineSnapshot(`
          {
            "alerts": Map {},
            "healthy": true,
            "options": {
              "fold": "none",
              "reportLevel": "warn",
            },
            "orgSlug": "fakeorg",
            "scanId": "scan-ai-dee",
          }
        `)
        expect(result.healthy).toBe(true)
        expect((result as ScanReport)['alerts']?.size).toBe(0)
      })

      it('should return a healthy report without alerts when an alert violates at defer', () => {
        const result = generateReport(
          getScanWithEnvVars(),
          {
            securityPolicyRules: {
              envVars: {
                action: 'defer'
              }
            },
            securityPolicyDefault: 'medium'
          },
          {
            orgSlug: 'fakeorg',
            scanId: 'scan-ai-dee',
            fold: 'none',
            reportLevel: 'warn'
          }
        )

        expect(result).toMatchInlineSnapshot(`
          {
            "alerts": Map {},
            "healthy": true,
            "options": {
              "fold": "none",
              "reportLevel": "warn",
            },
            "orgSlug": "fakeorg",
            "scanId": "scan-ai-dee",
          }
        `)
        expect(result.healthy).toBe(true)
        expect((result as ScanReport)['alerts']?.size).toBe(0)
      })

      it('should return a healthy report without alerts when an alert has no policy value', () => {
        const result = generateReport(
          getScanWithEnvVars(),
          {
            securityPolicyRules: {
              envVars: {}
            },
            securityPolicyDefault: 'medium'
          },
          {
            orgSlug: 'fakeorg',
            scanId: 'scan-ai-dee',
            fold: 'none',
            reportLevel: 'warn'
          }
        )

        expect(result).toMatchInlineSnapshot(`
          {
            "alerts": Map {},
            "healthy": true,
            "options": {
              "fold": "none",
              "reportLevel": "warn",
            },
            "orgSlug": "fakeorg",
            "scanId": "scan-ai-dee",
          }
        `)
        expect(result.healthy).toBe(true)
        expect((result as ScanReport)['alerts']?.size).toBe(0)
      })

      it('should return a healthy report without alerts when an alert has no policy entry', () => {
        const result = generateReport(
          getScanWithEnvVars(),
          {
            securityPolicyRules: {},
            securityPolicyDefault: 'medium'
          },
          {
            orgSlug: 'fakeorg',
            scanId: 'scan-ai-dee',
            fold: 'none',
            reportLevel: 'warn'
          }
        )

        expect(result).toMatchInlineSnapshot(`
          {
            "alerts": Map {},
            "healthy": true,
            "options": {
              "fold": "none",
              "reportLevel": "warn",
            },
            "orgSlug": "fakeorg",
            "scanId": "scan-ai-dee",
          }
        `)
        expect(result.healthy).toBe(true)
        expect((result as ScanReport)['alerts']?.size).toBe(0)
      })
    })

    describe('report-level=ignore', () => {
      it('should return a healthy report without alerts when there are no violations', () => {
        const result = generateReport(
          getSimpleCleanScan(),
          {
            securityPolicyRules: {
              gptSecurity: {
                action: 'ignore'
              }
            },
            securityPolicyDefault: 'medium'
          },
          {
            orgSlug: 'fakeorg',
            scanId: 'scan-ai-dee',
            fold: 'none',
            reportLevel: 'ignore'
          }
        )

        expect(result).toMatchInlineSnapshot(`
          {
            "alerts": Map {},
            "healthy": true,
            "options": {
              "fold": "none",
              "reportLevel": "ignore",
            },
            "orgSlug": "fakeorg",
            "scanId": "scan-ai-dee",
          }
        `)
        expect(result.healthy).toBe(true)
        expect((result as ScanReport)['alerts']?.size).toBe(0)
      })

      it('should return a sick report with alert when an alert violates at error', () => {
        const result = generateReport(
          getScanWithEnvVars(),
          {
            securityPolicyRules: {
              envVars: {
                action: 'error'
              }
            },
            securityPolicyDefault: 'medium'
          },
          {
            orgSlug: 'fakeorg',
            scanId: 'scan-ai-dee',
            fold: 'none',
            reportLevel: 'ignore'
          }
        )

        expect(result).toMatchInlineSnapshot(`
          {
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
                        "url": "https://socket.dev/npm/package/tslib/1.14.1",
                      },
                      "envVars at 200:250" => {
                        "manifest": [
                          "package-lock.json",
                        ],
                        "policy": "error",
                        "type": "envVars",
                        "url": "https://socket.dev/npm/package/tslib/1.14.1",
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
            "orgSlug": "fakeorg",
            "scanId": "scan-ai-dee",
          }
        `)
        expect(result.healthy).toBe(false)
        expect((result as ScanReport)['alerts']?.size).toBe(1)
      })

      it('should return a healthy report with alert when an alert violates at warn', () => {
        const result = generateReport(
          getScanWithEnvVars(),
          {
            securityPolicyRules: {
              envVars: {
                action: 'warn'
              }
            },
            securityPolicyDefault: 'medium'
          },
          {
            orgSlug: 'fakeorg',
            scanId: 'scan-ai-dee',
            fold: 'none',
            reportLevel: 'ignore'
          }
        )

        expect(result).toMatchInlineSnapshot(`
          {
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
                        "url": "https://socket.dev/npm/package/tslib/1.14.1",
                      },
                      "envVars at 200:250" => {
                        "manifest": [
                          "package-lock.json",
                        ],
                        "policy": "warn",
                        "type": "envVars",
                        "url": "https://socket.dev/npm/package/tslib/1.14.1",
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
            "orgSlug": "fakeorg",
            "scanId": "scan-ai-dee",
          }
        `)
        expect(result.healthy).toBe(true)
        expect((result as ScanReport)['alerts']?.size).toBe(1)
      })

      it('should return a healthy report with alert when an alert violates at monitor', () => {
        const result = generateReport(
          getScanWithEnvVars(),
          {
            securityPolicyRules: {
              envVars: {
                action: 'monitor'
              }
            },
            securityPolicyDefault: 'medium'
          },
          {
            orgSlug: 'fakeorg',
            scanId: 'scan-ai-dee',
            fold: 'none',
            reportLevel: 'ignore'
          }
        )

        expect(result).toMatchInlineSnapshot(`
          {
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
                        "url": "https://socket.dev/npm/package/tslib/1.14.1",
                      },
                      "envVars at 200:250" => {
                        "manifest": [
                          "package-lock.json",
                        ],
                        "policy": "monitor",
                        "type": "envVars",
                        "url": "https://socket.dev/npm/package/tslib/1.14.1",
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
            "orgSlug": "fakeorg",
            "scanId": "scan-ai-dee",
          }
        `)
        expect(result.healthy).toBe(true)
        expect((result as ScanReport)['alerts']?.size).toBe(1)
      })

      it('should return a healthy report with alert when an alert violates at ignore', () => {
        const result = generateReport(
          getScanWithEnvVars(),
          {
            securityPolicyRules: {
              envVars: {
                action: 'ignore'
              }
            },
            securityPolicyDefault: 'medium'
          },
          {
            orgSlug: 'fakeorg',
            scanId: 'scan-ai-dee',
            fold: 'none',
            reportLevel: 'ignore'
          }
        )

        expect(result).toMatchInlineSnapshot(`
          {
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
                        "url": "https://socket.dev/npm/package/tslib/1.14.1",
                      },
                      "envVars at 200:250" => {
                        "manifest": [
                          "package-lock.json",
                        ],
                        "policy": "ignore",
                        "type": "envVars",
                        "url": "https://socket.dev/npm/package/tslib/1.14.1",
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
            "orgSlug": "fakeorg",
            "scanId": "scan-ai-dee",
          }
        `)
        expect(result.healthy).toBe(true)
        expect((result as ScanReport)['alerts']?.size).toBe(1)
      })

      it('should return a healthy report without alerts when an alert violates at defer', () => {
        const result = generateReport(
          getScanWithEnvVars(),
          {
            securityPolicyRules: {
              envVars: {
                action: 'defer'
              }
            },
            securityPolicyDefault: 'medium'
          },
          {
            orgSlug: 'fakeorg',
            scanId: 'scan-ai-dee',
            fold: 'none',
            reportLevel: 'ignore'
          }
        )

        expect(result).toMatchInlineSnapshot(`
          {
            "alerts": Map {},
            "healthy": true,
            "options": {
              "fold": "none",
              "reportLevel": "ignore",
            },
            "orgSlug": "fakeorg",
            "scanId": "scan-ai-dee",
          }
        `)
        expect(result.healthy).toBe(true)
        expect((result as ScanReport)['alerts']?.size).toBe(0)
      })

      it('should return a healthy report without alerts when an alert has no policy value', () => {
        const result = generateReport(
          getScanWithEnvVars(),
          {
            securityPolicyRules: {
              envVars: {}
            },
            securityPolicyDefault: 'medium'
          },
          {
            orgSlug: 'fakeorg',
            scanId: 'scan-ai-dee',
            fold: 'none',
            reportLevel: 'ignore'
          }
        )

        expect(result).toMatchInlineSnapshot(`
          {
            "alerts": Map {},
            "healthy": true,
            "options": {
              "fold": "none",
              "reportLevel": "ignore",
            },
            "orgSlug": "fakeorg",
            "scanId": "scan-ai-dee",
          }
        `)
        expect(result.healthy).toBe(true)
        expect((result as ScanReport)['alerts']?.size).toBe(0)
      })

      it('should return a healthy report without alerts when an alert has no policy entry', () => {
        const result = generateReport(
          getScanWithEnvVars(),
          {
            securityPolicyRules: {},
            securityPolicyDefault: 'medium'
          },
          {
            orgSlug: 'fakeorg',
            scanId: 'scan-ai-dee',
            fold: 'none',
            reportLevel: 'ignore'
          }
        )

        expect(result).toMatchInlineSnapshot(`
          {
            "alerts": Map {},
            "healthy": true,
            "options": {
              "fold": "none",
              "reportLevel": "ignore",
            },
            "orgSlug": "fakeorg",
            "scanId": "scan-ai-dee",
          }
        `)
        expect(result.healthy).toBe(true)
        expect((result as ScanReport)['alerts']?.size).toBe(0)
      })
    })
  })

  describe('fold', () => {
    it('should not fold anything when fold=none', () => {
      const result = generateReport(
        getScanWithEnvVars(),
        {
          securityPolicyRules: {
            envVars: {
              action: 'error'
            }
          },
          securityPolicyDefault: 'medium'
        },
        {
          orgSlug: 'fakeorg',
          scanId: 'scan-ai-dee',
          fold: 'none',
          reportLevel: 'warn'
        }
      )

      expect(result).toMatchInlineSnapshot(`
        {
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
                      "url": "https://socket.dev/npm/package/tslib/1.14.1",
                    },
                    "envVars at 200:250" => {
                      "manifest": [
                        "package-lock.json",
                      ],
                      "policy": "error",
                      "type": "envVars",
                      "url": "https://socket.dev/npm/package/tslib/1.14.1",
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
          "orgSlug": "fakeorg",
          "scanId": "scan-ai-dee",
        }
      `)
    })

    it('should fold the file locations when fold=file', () => {
      const result = generateReport(
        getScanWithEnvVars(),
        {
          securityPolicyRules: {
            envVars: {
              action: 'error'
            }
          },
          securityPolicyDefault: 'medium'
        },
        {
          orgSlug: 'fakeorg',
          scanId: 'scan-ai-dee',
          fold: 'file',
          reportLevel: 'warn'
        }
      )

      expect(result).toMatchInlineSnapshot(`
        {
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
                    "url": "https://socket.dev/npm/package/tslib/1.14.1",
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
          "orgSlug": "fakeorg",
          "scanId": "scan-ai-dee",
        }
      `)
    })

    it('should fold the files up when fold=version', () => {
      const result = generateReport(
        getScanWithEnvVars(),
        {
          securityPolicyRules: {
            envVars: {
              action: 'error'
            }
          },
          securityPolicyDefault: 'medium'
        },
        {
          orgSlug: 'fakeorg',
          scanId: 'scan-ai-dee',
          fold: 'version',
          reportLevel: 'warn'
        }
      )

      expect(result).toMatchInlineSnapshot(`
        {
          "alerts": Map {
            "npm" => Map {
              "tslib" => Map {
                "1.14.1" => {
                  "manifest": [
                    "package-lock.json",
                  ],
                  "policy": "error",
                  "type": "envVars",
                  "url": "https://socket.dev/npm/package/tslib/1.14.1",
                },
              },
            },
          },
          "healthy": false,
          "options": {
            "fold": "version",
            "reportLevel": "warn",
          },
          "orgSlug": "fakeorg",
          "scanId": "scan-ai-dee",
        }
      `)
    })

    it('should fold the versions up when fold=pkg', () => {
      const result = generateReport(
        getScanWithEnvVars(),
        {
          securityPolicyRules: {
            envVars: {
              action: 'error'
            }
          },
          securityPolicyDefault: 'medium'
        },
        {
          orgSlug: 'fakeorg',
          scanId: 'scan-ai-dee',
          fold: 'pkg',
          reportLevel: 'warn'
        }
      )

      expect(result).toMatchInlineSnapshot(`
        {
          "alerts": Map {
            "npm" => Map {
              "tslib" => {
                "manifest": [
                  "package-lock.json",
                ],
                "policy": "error",
                "type": "envVars",
                "url": "https://socket.dev/npm/package/tslib/1.14.1",
              },
            },
          },
          "healthy": false,
          "options": {
            "fold": "pkg",
            "reportLevel": "warn",
          },
          "orgSlug": "fakeorg",
          "scanId": "scan-ai-dee",
        }
      `)
    })
  })
})

function getSimpleCleanScan(): Array<components['schemas']['SocketArtifact']> {
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
        vulnerability: 1
      },
      alerts: [],
      manifestFiles: [
        {
          file: 'package-lock.json',
          start: 600172,
          end: 600440
        }
      ],
      topLevelAncestors: ['15903631404']
    }
  ]
}

function getScanWithEnvVars(): Array<components['schemas']['SocketArtifact']> {
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
        vulnerability: 1
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
            envVars: 'XYZ'
          }
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
            envVars: 'ABC'
          }
        }
      ],
      manifestFiles: [
        {
          file: 'package-lock.json',
          start: 600172,
          end: 600440
        }
      ],
      topLevelAncestors: ['15903631404']
    }
  ]
}
