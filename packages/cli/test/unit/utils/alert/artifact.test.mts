/**
 * Unit tests for Socket artifact and alert type utilities.
 *
 * Purpose:
 * Tests type guards for artifact alerts. Validates CVE alert detection.
 *
 * Test Coverage:
 * - isArtifactAlertCve type guard
 * - CVE alert type detection
 *
 * Related Files:
 * - utils/alert/artifact.mts (implementation)
 */

import { describe, expect, it } from 'vitest'

import { isArtifactAlertCve } from '../../../../src/utils/alert/artifact.mts'
import {
  ALERT_TYPE_CRITICAL_CVE,
  ALERT_TYPE_CVE,
  ALERT_TYPE_MEDIUM_CVE,
  ALERT_TYPE_MILD_CVE,
} from '../../../../src/constants/alerts.mts'

import type { CompactSocketArtifactAlert } from '@socketsecurity/sdk'

describe('artifact', () => {
  describe('isArtifactAlertCve', () => {
    it('returns true for cve alert type', () => {
      const alert = {
        type: ALERT_TYPE_CVE,
        key: 'test-cve',
        severity: 'high',
      } as CompactSocketArtifactAlert

      expect(isArtifactAlertCve(alert)).toBe(true)
    })

    it('returns true for mediumCVE alert type', () => {
      const alert = {
        type: ALERT_TYPE_MEDIUM_CVE,
        key: 'test-medium-cve',
        severity: 'middle',
      } as CompactSocketArtifactAlert

      expect(isArtifactAlertCve(alert)).toBe(true)
    })

    it('returns true for mildCVE alert type', () => {
      const alert = {
        type: ALERT_TYPE_MILD_CVE,
        key: 'test-mild-cve',
        severity: 'low',
      } as CompactSocketArtifactAlert

      expect(isArtifactAlertCve(alert)).toBe(true)
    })

    it('returns true for criticalCVE alert type', () => {
      const alert = {
        type: ALERT_TYPE_CRITICAL_CVE,
        key: 'test-critical-cve',
        severity: 'critical',
      } as CompactSocketArtifactAlert

      expect(isArtifactAlertCve(alert)).toBe(true)
    })

    it('returns false for non-CVE alert type', () => {
      const alert = {
        type: 'badPackage',
        key: 'test-bad-package',
        severity: 'high',
      } as CompactSocketArtifactAlert

      expect(isArtifactAlertCve(alert)).toBe(false)
    })

    it('returns false for socketUpgradeAvailable alert type', () => {
      const alert = {
        type: 'socketUpgradeAvailable',
        key: 'test-upgrade',
        severity: 'low',
      } as CompactSocketArtifactAlert

      expect(isArtifactAlertCve(alert)).toBe(false)
    })

    it('returns false for telemetry alert type', () => {
      const alert = {
        type: 'telemetry',
        key: 'test-telemetry',
        severity: 'middle',
      } as CompactSocketArtifactAlert

      expect(isArtifactAlertCve(alert)).toBe(false)
    })

    it('returns false for network alert type', () => {
      const alert = {
        type: 'networkAccess',
        key: 'test-network',
        severity: 'middle',
      } as CompactSocketArtifactAlert

      expect(isArtifactAlertCve(alert)).toBe(false)
    })

    it('returns false for undefined type', () => {
      const alert = {
        key: 'test-no-type',
        severity: 'low',
      } as unknown as CompactSocketArtifactAlert

      expect(isArtifactAlertCve(alert)).toBe(false)
    })
  })
})
