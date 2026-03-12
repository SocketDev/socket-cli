/**
 * Unit tests for alert constants.
 *
 * Purpose:
 * Tests the security alert type constants.
 *
 * Test Coverage:
 * - Alert type constant values
 *
 * Related Files:
 * - constants/alerts.mts (implementation)
 */

import { describe, expect, it } from 'vitest'

import {
  ALERT_TYPE_CRITICAL_CVE,
  ALERT_TYPE_CVE,
  ALERT_TYPE_MEDIUM_CVE,
  ALERT_TYPE_MILD_CVE,
} from '../../../src/constants/alerts.mts'

describe('alerts constants', () => {
  describe('alert type constants', () => {
    it('has ALERT_TYPE_CRITICAL_CVE constant', () => {
      expect(ALERT_TYPE_CRITICAL_CVE).toBe('criticalCVE')
    })

    it('has ALERT_TYPE_CVE constant', () => {
      expect(ALERT_TYPE_CVE).toBe('cve')
    })

    it('has ALERT_TYPE_MEDIUM_CVE constant', () => {
      expect(ALERT_TYPE_MEDIUM_CVE).toBe('mediumCVE')
    })

    it('has ALERT_TYPE_MILD_CVE constant', () => {
      expect(ALERT_TYPE_MILD_CVE).toBe('mildCVE')
    })
  })

  describe('alert type usage patterns', () => {
    it('critical CVE is for most severe vulnerabilities', () => {
      expect(ALERT_TYPE_CRITICAL_CVE).toContain('critical')
    })

    it('all CVE types contain CVE', () => {
      expect(ALERT_TYPE_CRITICAL_CVE.toLowerCase()).toContain('cve')
      expect(ALERT_TYPE_CVE.toLowerCase()).toContain('cve')
      expect(ALERT_TYPE_MEDIUM_CVE.toLowerCase()).toContain('cve')
      expect(ALERT_TYPE_MILD_CVE.toLowerCase()).toContain('cve')
    })
  })
})
