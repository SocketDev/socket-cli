import { describe, expect, it } from 'vitest'

import { generateReport } from './generate-report.mts'
import {
  getSimpleCleanScan,
  getScanWithEnvVars,
} from './generate-report-test-helpers.mts'

import type { ScanReport } from './generate-report.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

type SecurityPolicyData = SocketSdkSuccessResult<'getOrgSecurityPolicy'>['data']

describe('generate-report - report shape', () => {
  describe('report-level=warn', () => {
    it('should return a healthy report without alerts when there are no violations', () => {
      const result = generateReport(
        getSimpleCleanScan(),
        {
          securityPolicyRules: {
            gptSecurity: {
              action: 'ignore',
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
      expect(result.ok && result.data.healthy).toBe(false)
      expect((result.data as ScanReport)['alerts']?.size).toBeGreaterThan(0)
    })

    it('should return a healthy report without alerts when an alert violates at warn', () => {
      const result = generateReport(
        getScanWithEnvVars(),
        {
          securityPolicyRules: {
            envVars: {
              action: 'warn',
            },
          },
          securityPolicyDefault: 'medium',
        },
        {
          orgSlug: 'fakeOrg',
          scanId: 'scan-ai-dee',
          fold: 'none',
          reportLevel: 'error', // When reportLevel is 'error', warns don't show up as alerts
        },
      )

      expect(result.ok).toBe(true)
      expect(result.ok && result.data.healthy).toBe(true)
      expect((result.data as ScanReport)['alerts']?.size).toBe(0)
    })
  })

  describe('report-level=error', () => {
    it('should return a healthy report without alerts when there are no violations', () => {
      const result = generateReport(
        getSimpleCleanScan(),
        {
          securityPolicyRules: {
            gptSecurity: {
              action: 'ignore',
            },
          },
          securityPolicyDefault: 'medium',
        },
        {
          orgSlug: 'fakeOrg',
          scanId: 'scan-ai-dee',
          fold: 'none',
          reportLevel: 'error',
        },
      )

      expect(result.ok).toBe(true)
      expect(result.ok && result.data.healthy).toBe(true)
      expect((result.data as ScanReport)['alerts']?.size).toBe(0)
    })

    it('should return a sick report with alert when an alert violates at error', () => {
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
          reportLevel: 'error',
        },
      )

      expect(result.ok).toBe(true)
      expect(result.ok && result.data.healthy).toBe(false)
      expect((result.data as ScanReport)['alerts']?.size).toBeGreaterThan(0)
    })

    it('should return a healthy report without alerts when an alert violates at warn', () => {
      const result = generateReport(
        getScanWithEnvVars(),
        {
          securityPolicyRules: {
            envVars: {
              action: 'warn',
            },
          },
          securityPolicyDefault: 'medium',
        },
        {
          orgSlug: 'fakeOrg',
          scanId: 'scan-ai-dee',
          fold: 'none',
          reportLevel: 'error',
        },
      )

      expect(result.ok).toBe(true)
      expect(result.ok && result.data.healthy).toBe(true)
      expect((result.data as ScanReport)['alerts']?.size).toBe(0)
    })
  })
})
