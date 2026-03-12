/**
 * Unit tests for reporting constants.
 *
 * Purpose:
 * Tests the report level constants for security issue severity.
 *
 * Test Coverage:
 * - Fold setting constants
 * - Report level constants
 *
 * Related Files:
 * - constants/reporting.mts (implementation)
 */

import { describe, expect, it } from 'vitest'

import {
  FOLD_SETTING_VERSION,
  REPORT_LEVEL_DEFER,
  REPORT_LEVEL_ERROR,
  REPORT_LEVEL_IGNORE,
  REPORT_LEVEL_MONITOR,
  REPORT_LEVEL_WARN,
} from '../../../src/constants/reporting.mts'

describe('reporting constants', () => {
  describe('fold setting constants', () => {
    it('has FOLD_SETTING_VERSION constant', () => {
      expect(FOLD_SETTING_VERSION).toBe('version')
    })
  })

  describe('report level constants', () => {
    it('has REPORT_LEVEL_DEFER constant', () => {
      expect(REPORT_LEVEL_DEFER).toBe('defer')
    })

    it('has REPORT_LEVEL_ERROR constant', () => {
      expect(REPORT_LEVEL_ERROR).toBe('error')
    })

    it('has REPORT_LEVEL_IGNORE constant', () => {
      expect(REPORT_LEVEL_IGNORE).toBe('ignore')
    })

    it('has REPORT_LEVEL_MONITOR constant', () => {
      expect(REPORT_LEVEL_MONITOR).toBe('monitor')
    })

    it('has REPORT_LEVEL_WARN constant', () => {
      expect(REPORT_LEVEL_WARN).toBe('warn')
    })
  })

  describe('report level severity order', () => {
    it('all report levels are lowercase strings', () => {
      const levels = [
        REPORT_LEVEL_DEFER,
        REPORT_LEVEL_ERROR,
        REPORT_LEVEL_IGNORE,
        REPORT_LEVEL_MONITOR,
        REPORT_LEVEL_WARN,
      ]
      for (const level of levels) {
        expect(level).toBe(level.toLowerCase())
      }
    })
  })
})
