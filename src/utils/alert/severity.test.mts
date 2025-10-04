/** @fileoverview Tests for alert severity utilities. */

import { describe, expect, it } from 'vitest'

import {
  ALERT_SEVERITIES_SORTED,
  ALERT_SEVERITY,
  formatSeverityCount,
  getSeverityCount,
} from './severity.mts'

import type { SocketSdkAlertList } from './severity.mts'

describe('alert severity utilities', () => {
  describe('ALERT_SEVERITY', () => {
    it('should define all severity levels', () => {
      expect(ALERT_SEVERITY.critical).toBe('critical')
      expect(ALERT_SEVERITY.high).toBe('high')
      expect(ALERT_SEVERITY.middle).toBe('middle')
      expect(ALERT_SEVERITY.low).toBe('low')
    })
  })

  describe('ALERT_SEVERITIES_SORTED', () => {
    it('should be ordered from most to least severe', () => {
      expect(ALERT_SEVERITIES_SORTED).toEqual([
        'critical',
        'high',
        'middle',
        'low',
      ])
    })

    it('should be frozen', () => {
      expect(Object.isFrozen(ALERT_SEVERITIES_SORTED)).toBe(true)
    })
  })

  describe('formatSeverityCount', () => {
    it('should format single severity', () => {
      const result = formatSeverityCount({
        critical: 1,
        high: 0,
        middle: 0,
        low: 0,
      })
      expect(result).toBe('1 critical')
    })

    it('should format multiple severities with "and"', () => {
      const result = formatSeverityCount({
        critical: 2,
        high: 3,
        middle: 0,
        low: 0,
      })
      expect(result).toBe('2 critical and 3 high')
    })

    it('should format all severities', () => {
      const result = formatSeverityCount({
        critical: 1,
        high: 2,
        middle: 3,
        low: 4,
      })
      expect(result).toBe('1 critical, 2 high, 3 middle, and 4 low')
    })

    it('should skip zero counts', () => {
      const result = formatSeverityCount({
        critical: 0,
        high: 5,
        middle: 0,
        low: 2,
      })
      expect(result).toBe('5 high and 2 low')
    })

    it('should return empty string for all zeros', () => {
      const result = formatSeverityCount({
        critical: 0,
        high: 0,
        middle: 0,
        low: 0,
      })
      expect(result).toBe('')
    })
  })

  describe('getSeverityCount', () => {
    it('should count issues by severity', () => {
      const issues: SocketSdkAlertList = [
        { value: { severity: 'critical' } } as any,
        { value: { severity: 'high' } } as any,
        { value: { severity: 'high' } } as any,
        { value: { severity: 'middle' } } as any,
      ]

      const result = getSeverityCount(issues, undefined)
      expect(result).toEqual({
        critical: 1,
        high: 2,
        middle: 1,
        low: 0,
      })
    })

    it('should filter by lowestToInclude', () => {
      const issues: SocketSdkAlertList = [
        { value: { severity: 'critical' } } as any,
        { value: { severity: 'high' } } as any,
        { value: { severity: 'middle' } } as any,
        { value: { severity: 'low' } } as any,
      ]

      const result = getSeverityCount(issues, 'high')
      expect(result).toEqual({
        critical: 1,
        high: 1,
      })
    })

    it('should handle issues without value', () => {
      const issues: SocketSdkAlertList = [
        { value: undefined } as any,
        { value: { severity: 'high' } } as any,
      ]

      const result = getSeverityCount(issues, undefined)
      expect(result).toEqual({
        critical: 0,
        high: 1,
        middle: 0,
        low: 0,
      })
    })

    it('should handle empty issues array', () => {
      const issues: SocketSdkAlertList = []

      const result = getSeverityCount(issues, undefined)
      expect(result).toEqual({
        critical: 0,
        high: 0,
        middle: 0,
        low: 0,
      })
    })

    it('should only count desired severities', () => {
      const issues: SocketSdkAlertList = [
        { value: { severity: 'critical' } } as any,
        { value: { severity: 'low' } } as any,
      ]

      const result = getSeverityCount(issues, 'critical')
      expect(result).toEqual({
        critical: 1,
      })
    })
  })
})
