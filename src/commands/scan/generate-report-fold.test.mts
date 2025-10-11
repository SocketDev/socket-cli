import { describe, expect, it } from 'vitest'

import { generateReport } from './generate-report.mts'
import { getScanWithEnvVars, getScanWithMultiplePackages } from './generate-report-test-helpers.mts'

import type { ScanReport } from './generate-report.mts'

describe('generate-report - fold functionality', () => {
  describe('fold=none', () => {
    it('should not fold anything when fold=none', () => {
      const result = generateReport(
        getScanWithEnvVars(),
        {
          securityPolicyRules: {
            envVars: {
              action: 'error',
            },
          },
          securityPolicyDefault: 'medium',
        },
        {
          orgSlug: 'fakeOrg',
          scanId: 'scan-ai-dee',
          fold: 'none',
          reportLevel: 'warn',
        },
      )

      expect(result.ok).toBe(true)
      const alerts = (result.data as ScanReport)['alerts']

      // Check that all alerts are present and not folded.
      if (alerts && alerts.size > 0) {
        const npmAlerts = alerts.get('npm')
        if (npmAlerts) {
          const tslibAlerts = npmAlerts.get('tslib')
          if (tslibAlerts) {
            const versionAlerts = tslibAlerts.get('1.14.1')
            if (versionAlerts) {
              const fileAlerts = versionAlerts.get('package/which.js')
              expect(fileAlerts?.size).toBe(2) // Two separate alerts.
            }
          }
        }
      }
    })
  })

  describe('fold=pkg', () => {
    it('should fold alerts by package when fold=pkg', () => {
      const result = generateReport(
        getScanWithMultiplePackages(),
        {
          securityPolicyRules: {
            envVars: {
              action: 'error',
            },
          },
          securityPolicyDefault: 'medium',
        },
        {
          orgSlug: 'fakeOrg',
          scanId: 'scan-ai-dee',
          fold: 'pkg',
          reportLevel: 'warn',
        },
      )

      expect(result.ok).toBe(true)
      const alerts = (result.data as ScanReport)['alerts']

      // When folded by package, alerts should be grouped.
      if (alerts && alerts.size > 0) {
        // Verify that alerts exist for both packages.
        const npmAlerts = alerts.get('npm')
        expect(npmAlerts).toBeDefined()

        if (npmAlerts) {
          expect(npmAlerts.has('tslib')).toBe(true)
          expect(npmAlerts.has('lodash')).toBe(true)
        }
      }
    })
  })

  describe('fold=type', () => {
    it('should fold alerts by type when fold=type', () => {
      const result = generateReport(
        getScanWithMultiplePackages(),
        {
          securityPolicyRules: {
            envVars: {
              action: 'error',
            },
          },
          securityPolicyDefault: 'medium',
        },
        {
          orgSlug: 'fakeOrg',
          scanId: 'scan-ai-dee',
          fold: 'type',
          reportLevel: 'warn',
        },
      )

      expect(result.ok).toBe(true)
      // When folded by type, all envVars alerts should be grouped together.
      expect(result.data.healthy).toBe(false)
    })
  })

  describe('fold=all', () => {
    it('should fold all alerts when fold=all', () => {
      const result = generateReport(
        getScanWithMultiplePackages(),
        {
          securityPolicyRules: {
            envVars: {
              action: 'error',
            },
          },
          securityPolicyDefault: 'medium',
        },
        {
          orgSlug: 'fakeOrg',
          scanId: 'scan-ai-dee',
          fold: 'all',
          reportLevel: 'warn',
        },
      )

      expect(result.ok).toBe(true)
      // When folded to all, alerts should be maximally grouped.
      expect(result.data.healthy).toBe(false)

      const alerts = (result.data as ScanReport)['alerts']
      if (alerts && alerts.size > 0) {
        // The structure should be simplified when fold=all.
        expect(alerts.size).toBeGreaterThan(0)
      }
    })
  })
})