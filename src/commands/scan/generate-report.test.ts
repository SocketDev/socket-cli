import { describe, expect, it } from 'vitest'

import { generateReport } from './generate-report'

import type { SocketSdkReturnType } from '@socketsecurity/sdk'
import type { components } from '@socketsecurity/sdk/types/api'

describe('generate-report', () => {
  it('should accept empty args', () => {
    const result = generateReport([], undefined, undefined, {
      fold: 'none',
      reportLevel: 'warn'
    })

    expect(result).toMatchInlineSnapshot(`
      {
        "alerts": Map {},
        "healthy": true,
      }
    `)
  })

  describe('report shape', () => {
    describe('report-level=warn', () => {
      it('should return a healthy report without alerts when there are no violations', () => {
        const result = generateReport(
          getSimpleCleanScan(),
          undefined,
          {
            success: true,
            data: {
              securityPolicyRules: {
                gptSecurity: {
                  action: 'ignore'
                }
              },
              securityPolicyDefault: 'medium'
            }
          } as SocketSdkReturnType<'getOrgSecurityPolicy'>,
          {
            fold: 'none',
            reportLevel: 'warn'
          }
        )

        expect(result).toMatchInlineSnapshot(`
      {
        "alerts": Map {},
        "healthy": true,
      }
    `)
        expect(result.healthy).toBe(true)
        expect(result.alerts.size).toBe(0)
      })

      it('should return a sick report with alert when an alert violates at error', () => {
        const result = generateReport(
          getScanWithEnvVars(),
          undefined,
          {
            success: true,
            data: {
              securityPolicyRules: {
                envVars: {
                  action: 'error'
                }
              },
              securityPolicyDefault: 'medium'
            }
          } as SocketSdkReturnType<'getOrgSecurityPolicy'>,
          {
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
                      "envVars at 54:72" => "error",
                      "envVars at 200:250" => "error",
                    },
                  },
                },
              },
            },
            "healthy": false,
          }
        `)
        expect(result.healthy).toBe(false)
        expect(result.alerts.size).toBe(1)
      })

      it('should return a healthy report with alert when an alert violates at warn', () => {
        const result = generateReport(
          getScanWithEnvVars(),
          undefined,
          {
            success: true,
            data: {
              securityPolicyRules: {
                envVars: {
                  action: 'warn'
                }
              },
              securityPolicyDefault: 'medium'
            }
          } as SocketSdkReturnType<'getOrgSecurityPolicy'>,
          {
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
                      "envVars at 54:72" => "warn",
                      "envVars at 200:250" => "warn",
                    },
                  },
                },
              },
            },
            "healthy": true,
          }
        `)
        expect(result.healthy).toBe(true)
        expect(result.alerts.size).toBe(1)
      })

      it('should return a healthy report without alerts when an alert violates at monitor', () => {
        const result = generateReport(
          getScanWithEnvVars(),
          undefined,
          {
            success: true,
            data: {
              securityPolicyRules: {
                envVars: {
                  action: 'monitor'
                }
              },
              securityPolicyDefault: 'medium'
            }
          } as SocketSdkReturnType<'getOrgSecurityPolicy'>,
          {
            fold: 'none',
            reportLevel: 'warn'
          }
        )

        expect(result).toMatchInlineSnapshot(`
      {
        "alerts": Map {},
        "healthy": true,
      }
    `)
        expect(result.healthy).toBe(true)
        expect(result.alerts.size).toBe(0)
      })

      it('should return a healthy report without alerts when an alert violates at ignore', () => {
        const result = generateReport(
          getScanWithEnvVars(),
          undefined,
          {
            success: true,
            data: {
              securityPolicyRules: {
                envVars: {
                  action: 'ignore'
                }
              },
              securityPolicyDefault: 'medium'
            }
          } as SocketSdkReturnType<'getOrgSecurityPolicy'>,
          {
            fold: 'none',
            reportLevel: 'warn'
          }
        )

        expect(result).toMatchInlineSnapshot(`
      {
        "alerts": Map {},
        "healthy": true,
      }
    `)
        expect(result.healthy).toBe(true)
        expect(result.alerts.size).toBe(0)
      })

      it('should return a healthy report without alerts when an alert violates at defer', () => {
        const result = generateReport(
          getScanWithEnvVars(),
          undefined,
          {
            success: true,
            data: {
              securityPolicyRules: {
                envVars: {
                  action: 'defer'
                }
              },
              securityPolicyDefault: 'medium'
            }
          } as SocketSdkReturnType<'getOrgSecurityPolicy'>,
          {
            fold: 'none',
            reportLevel: 'warn'
          }
        )

        expect(result).toMatchInlineSnapshot(`
      {
        "alerts": Map {},
        "healthy": true,
      }
    `)
        expect(result.healthy).toBe(true)
        expect(result.alerts.size).toBe(0)
      })

      it('should return a healthy report without alerts when an alert has no policy value', () => {
        const result = generateReport(
          getScanWithEnvVars(),
          undefined,
          {
            success: true,
            data: {
              securityPolicyRules: {
                envVars: {}
              },
              securityPolicyDefault: 'medium'
            }
          } as SocketSdkReturnType<'getOrgSecurityPolicy'>,
          {
            fold: 'none',
            reportLevel: 'warn'
          }
        )

        expect(result).toMatchInlineSnapshot(`
      {
        "alerts": Map {},
        "healthy": true,
      }
    `)
        expect(result.healthy).toBe(true)
        expect(result.alerts.size).toBe(0)
      })

      it('should return a healthy report without alerts when an alert has no policy entry', () => {
        const result = generateReport(
          getScanWithEnvVars(),
          undefined,
          {
            success: true,
            data: {
              securityPolicyRules: {},
              securityPolicyDefault: 'medium'
            }
          } as SocketSdkReturnType<'getOrgSecurityPolicy'>,
          {
            fold: 'none',
            reportLevel: 'warn'
          }
        )

        expect(result).toMatchInlineSnapshot(`
      {
        "alerts": Map {},
        "healthy": true,
      }
    `)
        expect(result.healthy).toBe(true)
        expect(result.alerts.size).toBe(0)
      })
    })

    describe('report-level=ignore', () => {
      it('should return a healthy report without alerts when there are no violations', () => {
        const result = generateReport(
          getSimpleCleanScan(),
          undefined,
          {
            success: true,
            data: {
              securityPolicyRules: {
                gptSecurity: {
                  action: 'ignore'
                }
              },
              securityPolicyDefault: 'medium'
            }
          } as SocketSdkReturnType<'getOrgSecurityPolicy'>,
          {
            fold: 'none',
            reportLevel: 'ignore'
          }
        )

        expect(result).toMatchInlineSnapshot(`
      {
        "alerts": Map {},
        "healthy": true,
      }
    `)
        expect(result.healthy).toBe(true)
        expect(result.alerts.size).toBe(0)
      })

      it('should return a sick report with alert when an alert violates at error', () => {
        const result = generateReport(
          getScanWithEnvVars(),
          undefined,
          {
            success: true,
            data: {
              securityPolicyRules: {
                envVars: {
                  action: 'error'
                }
              },
              securityPolicyDefault: 'medium'
            }
          } as SocketSdkReturnType<'getOrgSecurityPolicy'>,
          {
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
                      "envVars at 54:72" => "error",
                      "envVars at 200:250" => "error",
                    },
                  },
                },
              },
            },
            "healthy": false,
          }
        `)
        expect(result.healthy).toBe(false)
        expect(result.alerts.size).toBe(1)
      })

      it('should return a healthy report with alert when an alert violates at warn', () => {
        const result = generateReport(
          getScanWithEnvVars(),
          undefined,
          {
            success: true,
            data: {
              securityPolicyRules: {
                envVars: {
                  action: 'warn'
                }
              },
              securityPolicyDefault: 'medium'
            }
          } as SocketSdkReturnType<'getOrgSecurityPolicy'>,
          {
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
                      "envVars at 54:72" => "warn",
                      "envVars at 200:250" => "warn",
                    },
                  },
                },
              },
            },
            "healthy": true,
          }
        `)
        expect(result.healthy).toBe(true)
        expect(result.alerts.size).toBe(1)
      })

      it('should return a healthy report with alert when an alert violates at monitor', () => {
        const result = generateReport(
          getScanWithEnvVars(),
          undefined,
          {
            success: true,
            data: {
              securityPolicyRules: {
                envVars: {
                  action: 'monitor'
                }
              },
              securityPolicyDefault: 'medium'
            }
          } as SocketSdkReturnType<'getOrgSecurityPolicy'>,
          {
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
                      "envVars at 54:72" => "monitor",
                      "envVars at 200:250" => "monitor",
                    },
                  },
                },
              },
            },
            "healthy": true,
          }
        `)
        expect(result.healthy).toBe(true)
        expect(result.alerts.size).toBe(1)
      })

      it('should return a healthy report with alert when an alert violates at ignore', () => {
        const result = generateReport(
          getScanWithEnvVars(),
          undefined,
          {
            success: true,
            data: {
              securityPolicyRules: {
                envVars: {
                  action: 'ignore'
                }
              },
              securityPolicyDefault: 'medium'
            }
          } as SocketSdkReturnType<'getOrgSecurityPolicy'>,
          {
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
                      "envVars at 54:72" => "ignore",
                      "envVars at 200:250" => "ignore",
                    },
                  },
                },
              },
            },
            "healthy": true,
          }
        `)
        expect(result.healthy).toBe(true)
        expect(result.alerts.size).toBe(1)
      })

      it('should return a healthy report without alerts when an alert violates at defer', () => {
        const result = generateReport(
          getScanWithEnvVars(),
          undefined,
          {
            success: true,
            data: {
              securityPolicyRules: {
                envVars: {
                  action: 'defer'
                }
              },
              securityPolicyDefault: 'medium'
            }
          } as SocketSdkReturnType<'getOrgSecurityPolicy'>,
          {
            fold: 'none',
            reportLevel: 'ignore'
          }
        )

        expect(result).toMatchInlineSnapshot(`
      {
        "alerts": Map {},
        "healthy": true,
      }
    `)
        expect(result.healthy).toBe(true)
        expect(result.alerts.size).toBe(0)
      })

      it('should return a healthy report without alerts when an alert has no policy value', () => {
        const result = generateReport(
          getScanWithEnvVars(),
          undefined,
          {
            success: true,
            data: {
              securityPolicyRules: {
                envVars: {}
              },
              securityPolicyDefault: 'medium'
            }
          } as SocketSdkReturnType<'getOrgSecurityPolicy'>,
          {
            fold: 'none',
            reportLevel: 'ignore'
          }
        )

        expect(result).toMatchInlineSnapshot(`
      {
        "alerts": Map {},
        "healthy": true,
      }
    `)
        expect(result.healthy).toBe(true)
        expect(result.alerts.size).toBe(0)
      })

      it('should return a healthy report without alerts when an alert has no policy entry', () => {
        const result = generateReport(
          getScanWithEnvVars(),
          undefined,
          {
            success: true,
            data: {
              securityPolicyRules: {},
              securityPolicyDefault: 'medium'
            }
          } as SocketSdkReturnType<'getOrgSecurityPolicy'>,
          {
            fold: 'none',
            reportLevel: 'ignore'
          }
        )

        expect(result).toMatchInlineSnapshot(`
      {
        "alerts": Map {},
        "healthy": true,
      }
    `)
        expect(result.healthy).toBe(true)
        expect(result.alerts.size).toBe(0)
      })
    })
  })

  describe('fold', () => {
    it('should not fold anything when fold=none', () => {
      const result = generateReport(
        getScanWithEnvVars(),
        undefined,
        {
          success: true,
          data: {
            securityPolicyRules: {
              envVars: {
                action: 'error'
              }
            },
            securityPolicyDefault: 'medium'
          }
        } as SocketSdkReturnType<'getOrgSecurityPolicy'>,
        {
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
                    "envVars at 54:72" => "error",
                    "envVars at 200:250" => "error",
                  },
                },
              },
            },
          },
          "healthy": false,
        }
      `)
    })

    it('should fold the file locations when fold=file', () => {
      const result = generateReport(
        getScanWithEnvVars(),
        undefined,
        {
          success: true,
          data: {
            securityPolicyRules: {
              envVars: {
                action: 'error'
              }
            },
            securityPolicyDefault: 'medium'
          }
        } as SocketSdkReturnType<'getOrgSecurityPolicy'>,
        {
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
                  "package/which.js" => "error",
                },
              },
            },
          },
          "healthy": false,
        }
      `)
    })

    it('should fold the files up when fold=version', () => {
      const result = generateReport(
        getScanWithEnvVars(),
        undefined,
        {
          success: true,
          data: {
            securityPolicyRules: {
              envVars: {
                action: 'error'
              }
            },
            securityPolicyDefault: 'medium'
          }
        } as SocketSdkReturnType<'getOrgSecurityPolicy'>,
        {
          fold: 'version',
          reportLevel: 'warn'
        }
      )

      expect(result).toMatchInlineSnapshot(`
        {
          "alerts": Map {
            "npm" => Map {
              "tslib" => Map {
                "1.14.1" => "error",
              },
            },
          },
          "healthy": false,
        }
      `)
    })

    it('should fold the versions up when fold=pkg', () => {
      const result = generateReport(
        getScanWithEnvVars(),
        undefined,
        {
          success: true,
          data: {
            securityPolicyRules: {
              envVars: {
                action: 'error'
              }
            },
            securityPolicyDefault: 'medium'
          }
        } as SocketSdkReturnType<'getOrgSecurityPolicy'>,
        {
          fold: 'pkg',
          reportLevel: 'warn'
        }
      )

      expect(result).toMatchInlineSnapshot(`
        {
          "alerts": Map {
            "npm" => Map {
              "tslib" => "error",
            },
          },
          "healthy": false,
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
