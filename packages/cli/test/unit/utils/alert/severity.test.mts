/**
 * Unit tests for alert severity utilities.
 *
 * Purpose:
 * Tests severity ordering, counting, and formatting for Socket security alerts.
 *
 * Test Coverage:
 * - ALERT_SEVERITY enum values
 * - ALERT_SEVERITIES_SORTED ordering
 * - formatSeverityCount output formatting
 * - getSeverityCount counting logic
 *
 * Testing Approach:
 * Uses mock alert data to validate severity utilities.
 *
 * Related Files:
 * - utils/alert/severity.mts (implementation)
 */

import { describe, expect, it } from 'vitest'

import {
  ALERT_SEVERITY,
  ALERT_SEVERITIES_SORTED,
  formatSeverityCount,
  getSeverityCount,
} from '../../../../src/utils/alert/severity.mts'

import type { SocketSdkAlertList } from '../../../../src/utils/alert/severity.mts'

describe('alert severity utilities', () => {
  describe('ALERT_SEVERITY', () => {
    it('has all severity levels', () => {
      expect(ALERT_SEVERITY.critical).toBe('critical')
      expect(ALERT_SEVERITY.high).toBe('high')
      expect(ALERT_SEVERITY.middle).toBe('middle')
      expect(ALERT_SEVERITY.low).toBe('low')
    })

    it('has exactly 4 severity levels', () => {
      expect(Object.keys(ALERT_SEVERITY)).toHaveLength(4)
    })
  })

  describe('ALERT_SEVERITIES_SORTED', () => {
    it('is sorted from most severe to least', () => {
      expect(ALERT_SEVERITIES_SORTED).toEqual([
        'critical',
        'high',
        'middle',
        'low',
      ])
    })

    it('is frozen', () => {
      expect(Object.isFrozen(ALERT_SEVERITIES_SORTED)).toBe(true)
    })
  })

  describe('formatSeverityCount', () => {
    it('formats a single severity', () => {
      const result = formatSeverityCount({
        critical: 1,
        high: 0,
        middle: 0,
        low: 0,
      })
      expect(result).toBe('1 critical')
    })

    it('formats multiple severities with "and"', () => {
      const result = formatSeverityCount({
        critical: 2,
        high: 3,
        middle: 0,
        low: 0,
      })
      expect(result).toBe('2 critical and 3 high')
    })

    it('formats all severities', () => {
      const result = formatSeverityCount({
        critical: 1,
        high: 2,
        middle: 3,
        low: 4,
      })
      expect(result).toBe('1 critical, 2 high, 3 middle, and 4 low')
    })

    it('returns empty string when all counts are zero', () => {
      const result = formatSeverityCount({
        critical: 0,
        high: 0,
        middle: 0,
        low: 0,
      })
      expect(result).toBe('')
    })

    it('skips zero counts in output', () => {
      const result = formatSeverityCount({
        critical: 0,
        high: 5,
        middle: 0,
        low: 2,
      })
      expect(result).toBe('5 high and 2 low')
    })

    it('maintains severity order in output', () => {
      const result = formatSeverityCount({
        critical: 1,
        high: 0,
        middle: 1,
        low: 0,
      })
      // Critical comes before middle.
      expect(result).toBe('1 critical and 1 middle')
    })
  })

  describe('getSeverityCount', () => {
    const createMockIssue = (
      severity: 'critical' | 'high' | 'middle' | 'low',
    ) => ({
      key: `issue-${severity}`,
      value: { severity },
    })

    it('counts issues by severity', () => {
      const issues = [
        createMockIssue('critical'),
        createMockIssue('critical'),
        createMockIssue('high'),
        createMockIssue('low'),
      ] as SocketSdkAlertList

      const result = getSeverityCount(issues, 'low')

      expect(result).toEqual({
        critical: 2,
        high: 1,
        middle: 0,
        low: 1,
      })
    })

    it('filters by lowestToInclude severity', () => {
      const issues = [
        createMockIssue('critical'),
        createMockIssue('high'),
        createMockIssue('middle'),
        createMockIssue('low'),
      ] as SocketSdkAlertList

      // Only count critical and high.
      const result = getSeverityCount(issues, 'high')

      expect(result).toEqual({
        critical: 1,
        high: 1,
      })
    })

    it('returns only critical when lowestToInclude is critical', () => {
      const issues = [
        createMockIssue('critical'),
        createMockIssue('critical'),
        createMockIssue('high'),
      ] as SocketSdkAlertList

      const result = getSeverityCount(issues, 'critical')

      expect(result).toEqual({
        critical: 2,
      })
    })

    it('handles empty issues array', () => {
      const result = getSeverityCount([], 'low')

      expect(result).toEqual({
        critical: 0,
        high: 0,
        middle: 0,
        low: 0,
      })
    })

    it('ignores issues with undefined value', () => {
      const issues = [
        createMockIssue('critical'),
        { key: 'issue-no-value', value: undefined },
        createMockIssue('high'),
      ] as SocketSdkAlertList

      const result = getSeverityCount(issues, 'low')

      expect(result).toEqual({
        critical: 1,
        high: 1,
        middle: 0,
        low: 0,
      })
    })

    it('handles undefined lowestToInclude', () => {
      const issues = [
        createMockIssue('critical'),
        createMockIssue('low'),
      ] as SocketSdkAlertList

      const result = getSeverityCount(issues, undefined)

      // With undefined, only counts through the loop until break on undefined.
      // Since lowestToInclude is undefined, the loop doesn't break and includes all.
      expect(result).toEqual({
        critical: 1,
        high: 0,
        middle: 0,
        low: 1,
      })
    })

    it('counts middle severity correctly', () => {
      const issues = [
        createMockIssue('middle'),
        createMockIssue('middle'),
        createMockIssue('middle'),
      ] as SocketSdkAlertList

      const result = getSeverityCount(issues, 'middle')

      expect(result).toEqual({
        critical: 0,
        high: 0,
        middle: 3,
      })
    })
  })
})
