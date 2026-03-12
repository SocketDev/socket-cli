/**
 * Unit tests for Socket package alert utilities.
 *
 * Purpose:
 * Tests Socket package alert utilities. Validates alert data extraction and formatting.
 *
 * Test Coverage:
 * - Alert extraction from package data
 * - Alert severity mapping
 * - Alert type categorization
 * - Alert deduplication
 * - Alert sorting
 *
 * Testing Approach:
 * Tests package-specific alert utilities.
 *
 * Related Files:
 * - utils/socket/package-alert.mts (implementation)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ALERT_SEVERITY } from '../../../../src/utils/alert/severity.mts'
import {
  addArtifactToAlertsMap,
  ALERT_SEVERITY_COLOR,
  ALERT_SEVERITY_ORDER,
  alertSeverityComparator,
  alertsHaveBlocked,
  alertsHaveSeverity,
  getAlertSeverityOrder,
  getAlertsSeverityOrder,
  getCveInfoFromAlertsMap,
  getSeverityLabel,
  logAlertsMap,
} from '../../../../src/utils/socket/package-alert.mts'

import type {
  AlertsByPurl,
  SocketPackageAlert,
} from '../../../../src/utils/socket/package-alert.mts'
import type { CompactSocketArtifactAlert } from '../../../../src/utils/alert/artifact.mts'

// Mock getManifestData.
const mockGetManifestData = vi.hoisted(() => vi.fn())
vi.mock('@socketsecurity/registry', () => ({
  getManifestData: mockGetManifestData,
}))

// Mock translations.
const mockGetTranslations = vi.hoisted(() =>
  vi.fn(() => ({
    alerts: {
      criticalCVE: {
        description: 'Critical vulnerability',
        title: 'Critical CVE',
      },
      missingSemver: {
        description: 'Package lacks semantic versioning',
        title: 'Missing Semver',
      },
    },
  })),
)
vi.mock('../../../../src/utils/alert/translations.mts', () => ({
  getTranslations: mockGetTranslations,
}))

// Mock debug.
vi.mock('@socketsecurity/lib/debug', () => ({
  debugDirNs: vi.fn(),
  debugNs: vi.fn(),
}))

// Helper to create mock alerts.
function createMockAlert(
  overrides: Partial<CompactSocketArtifactAlert> = {},
): CompactSocketArtifactAlert {
  return {
    key: 'test-key-1',
    severity: 'high',
    type: 'criticalCVE',
    ...overrides,
  } as CompactSocketArtifactAlert
}

// Helper to create mock SocketPackageAlert.
function createMockSocketPackageAlert(
  overrides: Partial<SocketPackageAlert> = {},
): SocketPackageAlert {
  return {
    blocked: false,
    critical: false,
    ecosystem: 'npm',
    fixable: false,
    key: 'test-key',
    name: 'test-package',
    raw: createMockAlert(),
    type: 'criticalCVE',
    upgradable: false,
    version: '1.0.0',
    ...overrides,
  }
}

describe('socket-package-alert', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetManifestData.mockReturnValue(null)
  })

  describe('alertsHaveBlocked', () => {
    it('returns true when alerts contain blocked alert', () => {
      const alerts: SocketPackageAlert[] = [
        { blocked: false } as SocketPackageAlert,
        { blocked: true } as SocketPackageAlert,
      ]
      expect(alertsHaveBlocked(alerts)).toBe(true)
    })

    it('returns false when no alerts are blocked', () => {
      const alerts: SocketPackageAlert[] = [
        { blocked: false } as SocketPackageAlert,
        { blocked: false } as SocketPackageAlert,
      ]
      expect(alertsHaveBlocked(alerts)).toBe(false)
    })

    it('returns false for empty array', () => {
      expect(alertsHaveBlocked([])).toBe(false)
    })
  })

  describe('alertsHaveSeverity', () => {
    it('returns true when alerts contain specified severity', () => {
      const alerts: SocketPackageAlert[] = [
        { raw: { severity: ALERT_SEVERITY.low } } as SocketPackageAlert,
        { raw: { severity: ALERT_SEVERITY.critical } } as SocketPackageAlert,
      ]
      expect(alertsHaveSeverity(alerts, ALERT_SEVERITY.critical)).toBe(true)
    })

    it('returns false when alerts do not contain specified severity', () => {
      const alerts: SocketPackageAlert[] = [
        { raw: { severity: ALERT_SEVERITY.low } } as SocketPackageAlert,
        { raw: { severity: ALERT_SEVERITY.middle } } as SocketPackageAlert,
      ]
      expect(alertsHaveSeverity(alerts, ALERT_SEVERITY.critical)).toBe(false)
    })

    it('returns false for empty array', () => {
      expect(alertsHaveSeverity([], ALERT_SEVERITY.high)).toBe(false)
    })
  })

  describe('getAlertSeverityOrder', () => {
    it('returns 0 for critical severity', () => {
      const alert = {
        raw: { severity: ALERT_SEVERITY.critical },
      } as SocketPackageAlert
      expect(getAlertSeverityOrder(alert)).toBe(0)
    })

    it('returns 1 for high severity', () => {
      const alert = {
        raw: { severity: ALERT_SEVERITY.high },
      } as SocketPackageAlert
      expect(getAlertSeverityOrder(alert)).toBe(1)
    })

    it('returns 2 for middle severity', () => {
      const alert = {
        raw: { severity: ALERT_SEVERITY.middle },
      } as SocketPackageAlert
      expect(getAlertSeverityOrder(alert)).toBe(2)
    })

    it('returns 3 for low severity', () => {
      const alert = {
        raw: { severity: ALERT_SEVERITY.low },
      } as SocketPackageAlert
      expect(getAlertSeverityOrder(alert)).toBe(3)
    })

    it('returns 4 for unknown severity', () => {
      const alert = {
        raw: { severity: 'unknown' as any },
      } as SocketPackageAlert
      expect(getAlertSeverityOrder(alert)).toBe(4)
    })
  })

  describe('alertSeverityComparator', () => {
    it('sorts critical before high', () => {
      const alertCritical = {
        raw: { severity: ALERT_SEVERITY.critical },
      } as SocketPackageAlert
      const alertHigh = {
        raw: { severity: ALERT_SEVERITY.high },
      } as SocketPackageAlert

      expect(alertSeverityComparator(alertCritical, alertHigh)).toBeLessThan(0)
      expect(alertSeverityComparator(alertHigh, alertCritical)).toBeGreaterThan(
        0,
      )
    })

    it('sorts high before middle', () => {
      const alertHigh = {
        raw: { severity: ALERT_SEVERITY.high },
      } as SocketPackageAlert
      const alertMiddle = {
        raw: { severity: ALERT_SEVERITY.middle },
      } as SocketPackageAlert

      expect(alertSeverityComparator(alertHigh, alertMiddle)).toBeLessThan(0)
    })

    it('sorts middle before low', () => {
      const alertMiddle = {
        raw: { severity: ALERT_SEVERITY.middle },
      } as SocketPackageAlert
      const alertLow = {
        raw: { severity: ALERT_SEVERITY.low },
      } as SocketPackageAlert

      expect(alertSeverityComparator(alertMiddle, alertLow)).toBeLessThan(0)
    })

    it('returns 0 for same severity', () => {
      const alert1 = {
        raw: { severity: ALERT_SEVERITY.high },
      } as SocketPackageAlert
      const alert2 = {
        raw: { severity: ALERT_SEVERITY.high },
      } as SocketPackageAlert

      expect(alertSeverityComparator(alert1, alert2)).toBe(0)
    })
  })

  describe('getAlertsSeverityOrder', () => {
    it('returns 0 for blocked alerts', () => {
      const alerts: SocketPackageAlert[] = [
        {
          blocked: true,
          raw: { severity: ALERT_SEVERITY.low },
        } as SocketPackageAlert,
      ]
      expect(getAlertsSeverityOrder(alerts)).toBe(0)
    })

    it('returns 0 for critical alerts', () => {
      const alerts: SocketPackageAlert[] = [
        {
          blocked: false,
          raw: { severity: ALERT_SEVERITY.critical },
        } as SocketPackageAlert,
      ]
      expect(getAlertsSeverityOrder(alerts)).toBe(0)
    })

    it('returns 1 for high alerts without critical or blocked', () => {
      const alerts: SocketPackageAlert[] = [
        {
          blocked: false,
          raw: { severity: ALERT_SEVERITY.high },
        } as SocketPackageAlert,
        {
          blocked: false,
          raw: { severity: ALERT_SEVERITY.low },
        } as SocketPackageAlert,
      ]
      expect(getAlertsSeverityOrder(alerts)).toBe(1)
    })

    it('returns 2 for middle alerts without higher severity', () => {
      const alerts: SocketPackageAlert[] = [
        {
          blocked: false,
          raw: { severity: ALERT_SEVERITY.middle },
        } as SocketPackageAlert,
        {
          blocked: false,
          raw: { severity: ALERT_SEVERITY.low },
        } as SocketPackageAlert,
      ]
      expect(getAlertsSeverityOrder(alerts)).toBe(2)
    })

    it('returns 3 for low alerts only', () => {
      const alerts: SocketPackageAlert[] = [
        {
          blocked: false,
          raw: { severity: ALERT_SEVERITY.low },
        } as SocketPackageAlert,
      ]
      expect(getAlertsSeverityOrder(alerts)).toBe(3)
    })

    it('returns 4 for empty array', () => {
      expect(getAlertsSeverityOrder([])).toBe(4)
    })
  })

  describe('getSeverityLabel', () => {
    it('returns "moderate" for "middle" severity', () => {
      expect(getSeverityLabel('middle')).toBe('moderate')
    })

    it('returns same value for other severities', () => {
      expect(getSeverityLabel('critical')).toBe('critical')
      expect(getSeverityLabel('high')).toBe('high')
      expect(getSeverityLabel('low')).toBe('low')
    })
  })

  describe('ALERT_SEVERITY_COLOR', () => {
    it('maps severities to colors', () => {
      expect(ALERT_SEVERITY_COLOR.critical).toBe('magenta')
      expect(ALERT_SEVERITY_COLOR.high).toBe('red')
      expect(ALERT_SEVERITY_COLOR.middle).toBe('yellow')
      expect(ALERT_SEVERITY_COLOR.low).toBe('white')
    })
  })

  describe('ALERT_SEVERITY_ORDER', () => {
    it('has correct ordering (lower = more severe)', () => {
      expect(ALERT_SEVERITY_ORDER.critical).toBe(0)
      expect(ALERT_SEVERITY_ORDER.high).toBe(1)
      expect(ALERT_SEVERITY_ORDER.middle).toBe(2)
      expect(ALERT_SEVERITY_ORDER.low).toBe(3)
      expect(ALERT_SEVERITY_ORDER.none).toBe(4)
    })
  })

  describe('addArtifactToAlertsMap', () => {
    it('returns unchanged map for artifact without alerts', async () => {
      const alertsMap = new Map()
      const artifact = {
        name: 'test-package',
        version: '1.0.0',
        type: 'npm',
        alerts: [],
      }

      const result = await addArtifactToAlertsMap(artifact as any, alertsMap)

      expect(result.size).toBe(0)
    })

    it('returns unchanged map for artifact without name', async () => {
      const alertsMap = new Map()
      const artifact = {
        version: '1.0.0',
        type: 'npm',
        alerts: [{ type: 'cve', severity: 'high' }],
      }

      const result = await addArtifactToAlertsMap(artifact as any, alertsMap)

      expect(result.size).toBe(0)
    })

    it('returns unchanged map for artifact without version', async () => {
      const alertsMap = new Map()
      const artifact = {
        name: 'test-package',
        type: 'npm',
        alerts: [{ type: 'cve', severity: 'high' }],
      }

      const result = await addArtifactToAlertsMap(artifact as any, alertsMap)

      expect(result.size).toBe(0)
    })

    it('adds alerts for artifact with blocked action', async () => {
      const alertsMap: AlertsByPurl = new Map()
      const artifact = {
        alerts: [createMockAlert({ action: 'error', key: 'blocked-alert' })],
        name: 'test-package',
        type: 'npm',
        version: '1.0.0',
      }

      const result = await addArtifactToAlertsMap(artifact as any, alertsMap)

      expect(result.size).toBe(1)
      const alerts = result.get('pkg:npm/test-package@1.0.0')
      expect(alerts).toHaveLength(1)
      expect(alerts?.[0]?.blocked).toBe(true)
    })

    it('adds alerts for artifact with critical severity', async () => {
      const alertsMap: AlertsByPurl = new Map()
      const artifact = {
        alerts: [createMockAlert({ severity: 'critical' })],
        name: 'test-package',
        type: 'npm',
        version: '1.0.0',
      }

      const result = await addArtifactToAlertsMap(artifact as any, alertsMap)

      expect(result.size).toBe(1)
      const alerts = result.get('pkg:npm/test-package@1.0.0')
      expect(alerts?.[0]?.critical).toBe(true)
    })

    it('skips alerts with ignore action when not explicitly enabled', async () => {
      const alertsMap: AlertsByPurl = new Map()
      const artifact = {
        alerts: [createMockAlert({ action: 'ignore' })],
        name: 'test-package',
        type: 'npm',
        version: '1.0.0',
      }

      const result = await addArtifactToAlertsMap(artifact as any, alertsMap)

      expect(result.size).toBe(0)
    })

    it('includes ignored alerts when explicitly enabled in socketYml', async () => {
      const alertsMap: AlertsByPurl = new Map()
      const artifact = {
        alerts: [createMockAlert({ action: 'ignore', type: 'criticalCVE' })],
        name: 'test-package',
        type: 'npm',
        version: '1.0.0',
      }

      const result = await addArtifactToAlertsMap(artifact as any, alertsMap, {
        socketYml: {
          issueRules: {
            criticalCVE: true,
          },
        } as any,
      })

      expect(result.size).toBe(1)
    })

    it('skips alerts when explicitly disabled in socketYml', async () => {
      const alertsMap: AlertsByPurl = new Map()
      const artifact = {
        alerts: [createMockAlert({ type: 'criticalCVE' })],
        name: 'test-package',
        type: 'npm',
        version: '1.0.0',
      }

      const result = await addArtifactToAlertsMap(artifact as any, alertsMap, {
        socketYml: {
          issueRules: {
            criticalCVE: false,
          },
        } as any,
      })

      expect(result.size).toBe(0)
    })

    it('handles scoped package names', async () => {
      const alertsMap: AlertsByPurl = new Map()
      const artifact = {
        alerts: [createMockAlert({ action: 'error' })],
        name: 'package',
        namespace: '@scope',
        type: 'npm',
        version: '1.0.0',
      }

      const result = await addArtifactToAlertsMap(artifact as any, alertsMap)

      expect(result.has('pkg:npm/@scope/package@1.0.0')).toBe(true)
    })

    it('marks alerts as fixable when fix type is cve', async () => {
      const alertsMap: AlertsByPurl = new Map()
      const artifact = {
        alerts: [
          createMockAlert({
            fix: { type: 'cve' },
            props: { firstPatchedVersionIdentifier: '1.0.1' },
          }),
        ],
        name: 'test-package',
        type: 'npm',
        version: '1.0.0',
      }

      const result = await addArtifactToAlertsMap(artifact as any, alertsMap)

      const alerts = result.get('pkg:npm/test-package@1.0.0')
      expect(alerts?.[0]?.fixable).toBe(true)
    })

    it('marks alerts as upgradable when fix type is upgrade', async () => {
      const alertsMap: AlertsByPurl = new Map()
      const artifact = {
        alerts: [createMockAlert({ fix: { type: 'upgrade' } })],
        name: 'test-package',
        type: 'npm',
        version: '1.0.0',
      }

      const result = await addArtifactToAlertsMap(artifact as any, alertsMap)

      const alerts = result.get('pkg:npm/test-package@1.0.0')
      expect(alerts?.[0]?.upgradable).toBe(true)
    })

    it('does not mark as upgradable when override exists', async () => {
      const alertsMap: AlertsByPurl = new Map()
      const artifact = {
        alerts: [createMockAlert({ fix: { type: 'upgrade' } })],
        name: 'test-package',
        type: 'npm',
        version: '1.0.0',
      }

      const result = await addArtifactToAlertsMap(artifact as any, alertsMap, {
        overrides: { 'test-package': '2.0.0' },
      })

      const alerts = result.get('pkg:npm/test-package@1.0.0')
      expect(alerts?.[0]?.upgradable).toBe(false)
    })

    it('consolidates CVE alerts by highest version when consolidate is true', async () => {
      const alertsMap: AlertsByPurl = new Map()
      const artifact = {
        alerts: [
          createMockAlert({
            fix: { type: 'cve' },
            key: 'cve-1',
            props: {
              firstPatchedVersionIdentifier: '1.0.1',
              vulnerableVersionRange: '<1.0.1',
            },
          }),
          createMockAlert({
            fix: { type: 'cve' },
            key: 'cve-2',
            props: {
              firstPatchedVersionIdentifier: '1.0.2',
              vulnerableVersionRange: '<1.0.2',
            },
          }),
        ],
        name: 'test-package',
        type: 'npm',
        version: '1.0.0',
      }

      const result = await addArtifactToAlertsMap(artifact as any, alertsMap, {
        consolidate: true,
      })

      const alerts = result.get('pkg:npm/test-package@1.0.0')
      // Should consolidate to highest version in same major.
      expect(alerts).toHaveLength(1)
    })

    it('filters alerts based on custom filter config', async () => {
      const alertsMap: AlertsByPurl = new Map()
      const artifact = {
        alerts: [createMockAlert({ action: 'warn', severity: 'low' })],
        name: 'test-package',
        type: 'npm',
        version: '1.0.0',
      }

      // Only blocked=true in filter, so low severity warn should not match.
      const result = await addArtifactToAlertsMap(artifact as any, alertsMap, {
        filter: { blocked: true, critical: false, cve: false },
      })

      expect(result.size).toBe(0)
    })
  })

  describe('getCveInfoFromAlertsMap', () => {
    it('returns null when no CVE alerts exist', () => {
      const alertsMap: AlertsByPurl = new Map()
      alertsMap.set('pkg:npm/test@1.0.0', [
        createMockSocketPackageAlert({
          raw: createMockAlert({ fix: { type: 'upgrade' } }),
        }),
      ])

      const result = getCveInfoFromAlertsMap(alertsMap)

      expect(result).toBeNull()
    })

    it('extracts CVE info from alerts', () => {
      const alertsMap: AlertsByPurl = new Map()
      alertsMap.set('pkg:npm/test@1.0.0', [
        createMockSocketPackageAlert({
          ecosystem: 'npm',
          name: 'test',
          raw: createMockAlert({
            fix: { type: 'cve' },
            key: 'GHSA-xxx',
            props: {
              firstPatchedVersionIdentifier: '1.0.1',
              vulnerableVersionRange: '<1.0.1',
            },
          }),
        }),
      ])

      const result = getCveInfoFromAlertsMap(alertsMap)

      expect(result).not.toBeNull()
      expect(result?.has('pkg:npm/test')).toBe(true)
      const infos = result?.get('pkg:npm/test')
      expect(infos?.has('GHSA-xxx')).toBe(true)
    })

    it('handles complex version ranges', () => {
      const alertsMap: AlertsByPurl = new Map()
      alertsMap.set('pkg:npm/test@1.0.0', [
        createMockSocketPackageAlert({
          ecosystem: 'npm',
          name: 'test',
          raw: createMockAlert({
            fix: { type: 'cve' },
            key: 'CVE-123',
            props: {
              firstPatchedVersionIdentifier: '1.8.2',
              vulnerableVersionRange: '>= 1.0.0, < 1.8.2',
            },
          }),
        }),
      ])

      const result = getCveInfoFromAlertsMap(alertsMap)

      expect(result).not.toBeNull()
      const infos = result?.get('pkg:npm/test')
      const cveInfo = infos?.get('CVE-123')
      expect(cveInfo?.vulnerableVersionRange).toBeDefined()
    })

    it('skips alerts when upgradable filter is false and manifest exists', () => {
      mockGetManifestData.mockReturnValue({ name: 'test' })

      const alertsMap: AlertsByPurl = new Map()
      alertsMap.set('pkg:npm/test@1.0.0', [
        createMockSocketPackageAlert({
          ecosystem: 'npm',
          name: 'test',
          raw: createMockAlert({
            fix: { type: 'cve' },
            key: 'CVE-123',
            props: {
              firstPatchedVersionIdentifier: '1.0.1',
              vulnerableVersionRange: '<1.0.1',
            },
          }),
        }),
      ])

      const result = getCveInfoFromAlertsMap(alertsMap, {
        filter: { upgradable: false },
      })

      expect(result).toBeNull()
    })

    it('handles invalid PURL gracefully', () => {
      const alertsMap: AlertsByPurl = new Map()
      alertsMap.set('invalid-purl', [
        createMockSocketPackageAlert({
          raw: createMockAlert({ fix: { type: 'cve' } }),
        }),
      ])

      const result = getCveInfoFromAlertsMap(alertsMap)

      expect(result).toBeNull()
    })
  })

  describe('logAlertsMap', () => {
    it('writes alert output to stream', () => {
      const output: string[] = []
      const mockStream = {
        write: (str: string) => {
          output.push(str)
        },
      } as NodeJS.WriteStream

      const alertsMap: AlertsByPurl = new Map()
      alertsMap.set('pkg:npm/test-package@1.0.0', [
        createMockSocketPackageAlert({
          raw: createMockAlert({ severity: 'high' }),
        }),
      ])

      logAlertsMap(alertsMap, { output: mockStream })

      expect(output.join('')).toContain('test-package')
    })

    it('respects hideAt threshold for severity filtering', () => {
      const output: string[] = []
      const mockStream = {
        write: (str: string) => {
          output.push(str)
        },
      } as NodeJS.WriteStream

      const alertsMap: AlertsByPurl = new Map()
      alertsMap.set('pkg:npm/test@1.0.0', [
        createMockSocketPackageAlert({
          name: 'test',
          raw: createMockAlert({ severity: 'high' }),
        }),
      ])

      // With hideAt: 'none', only blocked alerts would be shown, but high severity will still appear
      // because of MIN_ABOVE_THE_FOLD_COUNT logic.
      logAlertsMap(alertsMap, { hideAt: 'none', output: mockStream })

      const combined = output.join('')
      // The package should still be shown.
      expect(combined).toContain('test@1.0.0')
    })

    it('shows blocked alerts regardless of severity', () => {
      const output: string[] = []
      const mockStream = {
        write: (str: string) => {
          output.push(str)
        },
      } as NodeJS.WriteStream

      const alertsMap: AlertsByPurl = new Map()
      alertsMap.set('pkg:npm/test@1.0.0', [
        createMockSocketPackageAlert({
          blocked: true,
          raw: createMockAlert({ severity: 'low' }),
        }),
      ])

      logAlertsMap(alertsMap, { hideAt: 'none', output: mockStream })

      const combined = output.join('')
      expect(combined).toContain('blocked')
    })

    it('handles empty alerts map', () => {
      const output: string[] = []
      const mockStream = {
        write: (str: string) => {
          output.push(str)
        },
      } as NodeJS.WriteStream

      const alertsMap: AlertsByPurl = new Map()

      logAlertsMap(alertsMap, { output: mockStream })

      // Should just write newline.
      expect(output.join('')).toBe('\n')
    })

    it('shows fixable attribute for fixable alerts', () => {
      const output: string[] = []
      const mockStream = {
        write: (str: string) => {
          output.push(str)
        },
      } as NodeJS.WriteStream

      const alertsMap: AlertsByPurl = new Map()
      alertsMap.set('pkg:npm/test@1.0.0', [
        createMockSocketPackageAlert({
          fixable: true,
          raw: createMockAlert({ severity: 'high' }),
        }),
      ])

      logAlertsMap(alertsMap, { output: mockStream })

      expect(output.join('')).toContain('fixable')
    })

    it('handles multiple hidden alerts with risk counts', () => {
      const output: string[] = []
      const mockStream = {
        write: (str: string) => {
          output.push(str)
        },
      } as NodeJS.WriteStream

      const alertsMap: AlertsByPurl = new Map()
      alertsMap.set('pkg:npm/test@1.0.0', [
        createMockSocketPackageAlert({
          raw: createMockAlert({ key: '1', severity: 'low' }),
        }),
        createMockSocketPackageAlert({
          raw: createMockAlert({ key: '2', severity: 'low' }),
        }),
        createMockSocketPackageAlert({
          raw: createMockAlert({ key: '3', severity: 'middle' }),
        }),
      ])

      logAlertsMap(alertsMap, { hideAt: 'low', output: mockStream })

      const combined = output.join('')
      expect(combined).toContain('Hidden')
    })

    it('uses translations for alert titles', () => {
      const output: string[] = []
      const mockStream = {
        write: (str: string) => {
          output.push(str)
        },
      } as NodeJS.WriteStream

      const alertsMap: AlertsByPurl = new Map()
      alertsMap.set('pkg:npm/test@1.0.0', [
        createMockSocketPackageAlert({
          raw: createMockAlert({ severity: 'high', type: 'criticalCVE' }),
          type: 'criticalCVE',
        }),
      ])

      logAlertsMap(alertsMap, { output: mockStream })

      expect(output.join('')).toContain('Critical CVE')
    })

    it('shows packages with hidden alerts not above the fold', () => {
      const output: string[] = []
      const mockStream = {
        write: (str: string) => {
          output.push(str)
        },
      } as NodeJS.WriteStream

      // Create more than MIN_ABOVE_THE_FOLD_COUNT packages so some end up hidden.
      const alertsMap: AlertsByPurl = new Map()
      // 4 packages with high severity (above fold).
      alertsMap.set('pkg:npm/pkg1@1.0.0', [
        createMockSocketPackageAlert({
          raw: createMockAlert({ key: 'a1', severity: 'high' }),
        }),
      ])
      alertsMap.set('pkg:npm/pkg2@1.0.0', [
        createMockSocketPackageAlert({
          raw: createMockAlert({ key: 'a2', severity: 'high' }),
        }),
      ])
      alertsMap.set('pkg:npm/pkg3@1.0.0', [
        createMockSocketPackageAlert({
          raw: createMockAlert({ key: 'a3', severity: 'high' }),
        }),
      ])
      alertsMap.set('pkg:npm/pkg4@1.0.0', [
        createMockSocketPackageAlert({
          raw: createMockAlert({ key: 'a4', severity: 'high' }),
        }),
      ])
      // Additional packages with low severity alerts that will be hidden.
      alertsMap.set('pkg:npm/pkg5@1.0.0', [
        createMockSocketPackageAlert({
          raw: createMockAlert({ key: 'a5', severity: 'low' }),
        }),
      ])
      alertsMap.set('pkg:npm/pkg6@1.0.0', [
        createMockSocketPackageAlert({
          raw: createMockAlert({ key: 'a6', severity: 'low' }),
        }),
      ])

      logAlertsMap(alertsMap, { hideAt: 'middle', output: mockStream })

      const combined = output.join('')
      // Should show the additional hidden packages count.
      expect(combined).toContain('Packages with hidden alerts')
    })

    it('aggregates risk counts for hidden packages', () => {
      const output: string[] = []
      const mockStream = {
        write: (str: string) => {
          output.push(str)
        },
      } as NodeJS.WriteStream

      const alertsMap: AlertsByPurl = new Map()
      // Above fold packages.
      for (let i = 1; i <= 4; i++) {
        alertsMap.set(`pkg:npm/high${i}@1.0.0`, [
          createMockSocketPackageAlert({
            raw: createMockAlert({ key: `h${i}`, severity: 'critical' }),
          }),
        ])
      }
      // Hidden packages with different severities.
      alertsMap.set('pkg:npm/hidden1@1.0.0', [
        createMockSocketPackageAlert({
          raw: createMockAlert({ key: 'l1', severity: 'low' }),
        }),
        createMockSocketPackageAlert({
          raw: createMockAlert({ key: 'l2', severity: 'middle' }),
        }),
      ])
      alertsMap.set('pkg:npm/hidden2@1.0.0', [
        createMockSocketPackageAlert({
          raw: createMockAlert({ key: 'l3', severity: 'low' }),
        }),
      ])

      logAlertsMap(alertsMap, { hideAt: 'middle', output: mockStream })

      const combined = output.join('')
      // Should aggregate risk counts across multiple hidden packages.
      expect(combined).toContain('low')
    })

    it('handles single hidden alert per package', () => {
      const output: string[] = []
      const mockStream = {
        write: (str: string) => {
          output.push(str)
        },
      } as NodeJS.WriteStream

      // Create a package with both viewable and hidden alerts.
      const alertsMap: AlertsByPurl = new Map()
      alertsMap.set('pkg:npm/test@1.0.0', [
        createMockSocketPackageAlert({
          raw: createMockAlert({ key: 'high', severity: 'high' }),
        }),
        createMockSocketPackageAlert({
          raw: createMockAlert({ key: 'low', severity: 'low' }),
        }),
      ])

      logAlertsMap(alertsMap, { hideAt: 'middle', output: mockStream })

      const combined = output.join('')
      // Single hidden alert should show singular form.
      expect(combined).toContain('+1 Hidden')
      expect(combined).toContain('risk alert')
    })

    it('shows severity label for hidden alerts', () => {
      const output: string[] = []
      const mockStream = {
        write: (str: string) => {
          output.push(str)
        },
      } as NodeJS.WriteStream

      const alertsMap: AlertsByPurl = new Map()
      alertsMap.set('pkg:npm/test@1.0.0', [
        createMockSocketPackageAlert({
          blocked: true,
          raw: createMockAlert({ key: 'blocked', severity: 'low' }),
        }),
        createMockSocketPackageAlert({
          raw: createMockAlert({ key: 'hidden-mid', severity: 'middle' }),
        }),
      ])

      logAlertsMap(alertsMap, { hideAt: 'middle', output: mockStream })

      const combined = output.join('')
      // The hidden middle alert should show "moderate" label.
      expect(combined).toContain('moderate')
    })

    it('handles empty severity gracefully', () => {
      const output: string[] = []
      const mockStream = {
        write: (str: string) => {
          output.push(str)
        },
      } as NodeJS.WriteStream

      const alertsMap: AlertsByPurl = new Map()
      alertsMap.set('pkg:npm/test@1.0.0', [
        createMockSocketPackageAlert({
          blocked: true,
          raw: createMockAlert({ key: 'no-sev', severity: undefined as any }),
        }),
      ])

      logAlertsMap(alertsMap, { output: mockStream })

      // Should not throw.
      expect(output.join('')).toContain('test@1.0.0')
    })

    it('shows alerts without description when translation missing', () => {
      const output: string[] = []
      const mockStream = {
        write: (str: string) => {
          output.push(str)
        },
      } as NodeJS.WriteStream

      const alertsMap: AlertsByPurl = new Map()
      alertsMap.set('pkg:npm/test@1.0.0', [
        createMockSocketPackageAlert({
          raw: createMockAlert({ severity: 'high', type: 'unknownAlertType' }),
          type: 'unknownAlertType',
        }),
      ])

      logAlertsMap(alertsMap, { output: mockStream })

      // Should show type as title when no translation exists.
      expect(output.join('')).toContain('unknownAlertType')
    })
  })
})
