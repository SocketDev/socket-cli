/**
 * Unit tests for Socket Firewall version getters.
 *
 * Purpose:
 * Tests the version getter functions for sfw (Socket Firewall).
 *
 * Test Coverage:
 * - getSwfVersion function
 * - getSfwNpmVersion function
 *
 * Related Files:
 * - env/sfw-version.mts (implementation)
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  getSfwNpmVersion,
  getSwfVersion,
} from '../../../src/env/sfw-version.mts'

describe('env/sfw-version', () => {
  let originalSwfVersion: string | undefined
  let originalSwfNpmVersion: string | undefined

  beforeEach(() => {
    // Save original env values.
    originalSwfVersion = process.env['INLINED_SFW_VERSION']
    originalSwfNpmVersion = process.env['INLINED_SFW_NPM_VERSION']
  })

  afterEach(() => {
    // Restore original env values.
    if (originalSwfVersion !== undefined) {
      process.env['INLINED_SFW_VERSION'] = originalSwfVersion
    } else {
      delete process.env['INLINED_SFW_VERSION']
    }
    if (originalSwfNpmVersion !== undefined) {
      process.env['INLINED_SFW_NPM_VERSION'] = originalSwfNpmVersion
    } else {
      delete process.env['INLINED_SFW_NPM_VERSION']
    }
  })

  describe('getSwfVersion', () => {
    it('returns version when env var is set', () => {
      process.env['INLINED_SFW_VERSION'] = 'v1.6.1'
      expect(getSwfVersion()).toBe('v1.6.1')
    })

    it('throws error when env var is not set', () => {
      delete process.env['INLINED_SFW_VERSION']
      expect(() => getSwfVersion()).toThrow('INLINED_SFW_VERSION')
    })
  })

  describe('getSfwNpmVersion', () => {
    it('returns version when env var is set', () => {
      process.env['INLINED_SFW_NPM_VERSION'] = '2.0.4'
      expect(getSfwNpmVersion()).toBe('2.0.4')
    })

    it('throws error when env var is not set', () => {
      delete process.env['INLINED_SFW_NPM_VERSION']
      expect(() => getSfwNpmVersion()).toThrow('INLINED_SFW_NPM_VERSION')
    })
  })
})
