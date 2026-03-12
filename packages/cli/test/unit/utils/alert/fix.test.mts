/**
 * Unit tests for alert fix type constants.
 *
 * Purpose:
 * Tests the ALERT_FIX_TYPE enum for fix operations.
 *
 * Test Coverage:
 * - ALERT_FIX_TYPE enum values
 *
 * Related Files:
 * - src/utils/alert/fix.mts (implementation)
 */

import { describe, expect, it } from 'vitest'

import { ALERT_FIX_TYPE } from '../../../../src/utils/alert/fix.mts'

describe('alert fix constants', () => {
  describe('ALERT_FIX_TYPE', () => {
    it('exports cve fix type', () => {
      expect(ALERT_FIX_TYPE.cve).toBe('cve')
    })

    it('exports remove fix type', () => {
      expect(ALERT_FIX_TYPE.remove).toBe('remove')
    })

    it('exports upgrade fix type', () => {
      expect(ALERT_FIX_TYPE.upgrade).toBe('upgrade')
    })

    it('has expected number of fix types', () => {
      const types = Object.keys(ALERT_FIX_TYPE)
      expect(types).toHaveLength(3)
    })
  })
})
