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

import { describe, expect, it, vi } from 'vitest'

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
  getSeverityLabel,
} from '../../../../src/utils/socket/package-alert.mts'

import type { SocketPackageAlert } from '../../../../src/utils/socket/package-alert.mts'

// Mock dependencies.
vi.mock('../../../../../src/utils/alert/artifact.mts', () => ({
  isArtifactAlertCve: vi.fn(),
}))

vi.mock('../../../../../src/utils/alert/fix.mts', () => ({
  ALERT_FIX_TYPE: {
    cve: 'cve',
    upgrade: 'upgrade',
  },
}))

vi.mock('../../../../../src/utils/alert/severity.mts', () => ({
  ALERT_SEVERITY: {
    critical: 'critical',
    high: 'high',
    middle: 'middle',
    low: 'low',
  },
}))

describe('socket-package-alert', () => {
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
  })
})
