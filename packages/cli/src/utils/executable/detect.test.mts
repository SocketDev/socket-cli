/** @fileoverview Tests for SEA (Single Executable Application) detection utilities. */

/* eslint-disable n/no-unsupported-features/node-builtins -- SEA is experimental but required for tests */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getSeaBinaryPath, isSeaBinary } from '../executable/detect.mts'

// Mock node:sea module.
vi.mock('node:sea', () => ({
  isSea: vi.fn(),
}))

describe('SEA detection utilities', () => {
  beforeEach(() => {
    // Clear all mocks before each test.
    vi.clearAllMocks()
    // Reset the internal cache by requiring fresh module.
    vi.resetModules()
  })

  describe('isSeaBinary', () => {
    it('returns false when node:sea.isSea() returns false', () => {
      const seaModule = require('node:sea')
      vi.mocked(seaModule.isSea).mockReturnValue(false)

      const result = isSeaBinary()

      expect(result).toBe(false)
      expect(seaModule.isSea).toHaveBeenCalled()
    })

    it('returns true when node:sea.isSea() returns true', () => {
      const seaModule = require('node:sea')
      vi.mocked(seaModule.isSea).mockReturnValue(true)

      const result = isSeaBinary()

      expect(result).toBe(true)
      expect(seaModule.isSea).toHaveBeenCalled()
    })

    it('returns false when node:sea module is not available', () => {
      vi.doMock('node:sea', () => {
        throw new Error('Module not found')
      })

      const result = isSeaBinary()

      expect(result).toBe(false)
    })

    it('caches the result across multiple calls', () => {
      const seaModule = require('node:sea')
      vi.mocked(seaModule.isSea).mockReturnValue(true)

      const result1 = isSeaBinary()
      const result2 = isSeaBinary()

      expect(result1).toBe(true)
      expect(result2).toBe(true)
      expect(seaModule.isSea).toHaveBeenCalledTimes(1)
    })
  })

  describe('getSeaBinaryPath', () => {
    it('returns undefined when not running via SEA', () => {
      const seaModule = require('node:sea')
      vi.mocked(seaModule.isSea).mockReturnValue(false)

      const result = getSeaBinaryPath()

      expect(result).toBeUndefined()
    })

    it('returns process.argv[0] when running via SEA', () => {
      const seaModule = require('node:sea')
      vi.mocked(seaModule.isSea).mockReturnValue(true)

      const result = getSeaBinaryPath()

      expect(result).toBe(process.argv[0])
    })

    it('handles different binary paths correctly', () => {
      const seaModule = require('node:sea')
      vi.mocked(seaModule.isSea).mockReturnValue(true)

      const result = getSeaBinaryPath()

      expect(typeof result).toBe('string')
      expect(result).toBeTruthy()
    })
  })
})
