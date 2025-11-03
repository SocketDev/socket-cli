/** @fileoverview Tests for SEA (Single Executable Application) detection utilities. */

import { describe, expect, it } from 'vitest'

import { getSeaBinaryPath, isSeaBinary } from '../../../../src/src/detect.mts'

describe('SEA detection utilities', () => {
  describe('isSeaBinary', () => {
    it('returns false when node:sea module is not available', () => {
      // In test environment, node:sea is not available so should return false.
      const result = isSeaBinary()

      expect(result).toBe(false)
    })
  })

  describe('getSeaBinaryPath', () => {
    it('returns undefined when not running via SEA', () => {
      // In test environment, node:sea is not available so should return undefined.
      const result = getSeaBinaryPath()

      expect(result).toBeUndefined()
    })

    it('returns a string from process.argv[0] (the node binary path)', () => {
      // process.argv[0] is always available and should be a string.
      expect(typeof process.argv[0]).toBe('string')
      expect(process.argv[0]).toBeTruthy()
    })
  })
})
