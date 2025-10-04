/** @fileoverview Tests for alert fix type definitions. */

import { describe, expect, it } from 'vitest'

import { ALERT_FIX_TYPE } from './fix.mts'

describe('ALERT_FIX_TYPE', () => {
  it('should define cve type', () => {
    expect(ALERT_FIX_TYPE.cve).toBe('cve')
  })

  it('should define remove type', () => {
    expect(ALERT_FIX_TYPE.remove).toBe('remove')
  })

  it('should define upgrade type', () => {
    expect(ALERT_FIX_TYPE.upgrade).toBe('upgrade')
  })

  it('should have all expected types', () => {
    const types = Object.keys(ALERT_FIX_TYPE)
    expect(types).toContain('cve')
    expect(types).toContain('remove')
    expect(types).toContain('upgrade')
    expect(types.length).toBe(3)
  })
})
