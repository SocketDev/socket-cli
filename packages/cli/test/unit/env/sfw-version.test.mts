/**
 * Unit tests for Socket Firewall version getter.
 *
 * Purpose: Tests the version getter function for sfw (Socket Firewall).
 *
 * Test Coverage: - getSwfVersion function.
 *
 * Related Files: - env/sfw-version.mts (implementation)
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { getSwfVersion } from '../../../src/env/sfw-version.mts'

describe('env/sfw-version', () => {
  let originalSwfVersion: string | undefined

  beforeEach(() => {
    // Save original env values.
    originalSwfVersion = process.env['INLINED_SFW_VERSION']
  })

  afterEach(() => {
    // Restore original env values.
    if (originalSwfVersion !== undefined) {
      process.env['INLINED_SFW_VERSION'] = originalSwfVersion
    } else {
      delete process.env['INLINED_SFW_VERSION']
    }
  })

  describe('getSwfVersion', () => {
    it('returns version when env var is set', () => {
      process.env['INLINED_SFW_VERSION'] = 'v1.12.0'
      expect(getSwfVersion()).toBe('v1.12.0')
    })

    it('throws error when env var is not set', () => {
      delete process.env['INLINED_SFW_VERSION']
      expect(() => getSwfVersion()).toThrow('INLINED_SFW_VERSION')
    })
  })
})
