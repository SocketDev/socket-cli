import { describe, expect, it } from 'vitest'

import { generateReport } from '../../../../src/commands/scan/generate-report.mts'

import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

type SecurityPolicyData = SocketSdkSuccessResult<'getOrgSecurityPolicy'>['data']

describe('generate-report - basic functionality', () => {
  it('should accept empty args', () => {
    const result = generateReport(
      [],
      { securityPolicyRules: [] } as SecurityPolicyData,
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
  })

  it('should handle empty security policy rules', () => {
    const result = generateReport(
      [],
      {
        securityPolicyRules: {},
        securityPolicyDefault: 'medium',
      } as SecurityPolicyData,
      {
        orgSlug: 'testOrg',
        scanId: 'test-scan-id',
        fold: 'none',
        reportLevel: 'error',
      },
    )

    expect(result.ok).toBe(true)
    expect(result.data.healthy).toBe(true)
    expect(result.data.orgSlug).toBe('testOrg')
    expect(result.data.scanId).toBe('test-scan-id')
  })

  it('should set correct options in result', () => {
    const result = generateReport(
      [],
      { securityPolicyRules: [] } as SecurityPolicyData,
      {
        orgSlug: 'myOrg',
        scanId: 'my-scan-123',
        fold: 'pkg',
        reportLevel: 'error',
      },
    )

    expect(result.data.options).toEqual({
      fold: 'pkg',
      reportLevel: 'error',
    })
    expect(result.data.orgSlug).toBe('myOrg')
    expect(result.data.scanId).toBe('my-scan-123')
  })

  it('should return ok:true for successful report generation', () => {
    const result = generateReport(
      [],
      { securityPolicyRules: [] } as SecurityPolicyData,
      {
        orgSlug: 'testOrg',
        scanId: 'test-id',
        fold: 'type',
        reportLevel: 'warn',
      },
    )

    expect(result.ok).toBe(true)
    expect(result).toHaveProperty('data')
  })
})
