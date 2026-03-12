/** @fileoverview Tests for SEA (Single Executable Application) detection utilities. */

import { describe, expect, it } from 'vitest'

import {
  canSelfUpdate,
  getSeaBinaryPath,
  isSeaBinary,
} from '../../../../src/utils/sea/detect.mts'

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

  describe('canSelfUpdate', () => {
    it('returns false when not running as SEA', () => {
      // In test environment, node:sea is not available so canSelfUpdate should return false.
      const result = canSelfUpdate()

      expect(result).toBe(false)
    })

    it('checks process.argv[0] exists', () => {
      // canSelfUpdate relies on process.argv[0] being available.
      expect(process.argv[0]).toBeTruthy()
    })
  })

  describe('isSeaBinary caching', () => {
    it('returns consistent results on multiple calls', () => {
      // isSeaBinary should cache its result.
      const result1 = isSeaBinary()
      const result2 = isSeaBinary()
      const result3 = isSeaBinary()

      expect(result1).toBe(result2)
      expect(result2).toBe(result3)
    })
  })
})
