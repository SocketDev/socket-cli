import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  commonFlags,
  getMaxOldSpaceSizeFlag,
  getMaxSemiSpaceSizeFlag,
  outputFlags,
  resetFlagCache,
  validationFlags,
} from './flags.mts'
import ENV from './constants/env.mts'

// Mock dependencies.
vi.mock('meow', () => ({
  default: vi.fn(() => ({
    flags: {
      maxOldSpaceSize: 0,
      maxSemiSpaceSize: 0,
    },
  })),
}))

vi.mock('node:os', () => ({
  default: {
    totalmem: vi.fn(() => 8 * 1024 * 1024 * 1024), // 8GB.
  },
}))

vi.mock('./constants.mts', () => ({
  default: {
    ENV: {
      NODE_OPTIONS: '',
    },
  },
}))

describe('flags', () => {
  let originalArgv: string[]

  beforeEach(() => {
    vi.clearAllMocks()
    resetFlagCache()
    // Save original argv and reset NODE_OPTIONS for clean state.
    originalArgv = process.argv
    process.env.NODE_OPTIONS = ''
  })

  afterEach(() => {
    // Restore original state.
    process.argv = originalArgv
    delete process.env.NODE_OPTIONS
  })

  describe('getMaxOldSpaceSizeFlag', () => {
    it('returns default based on system memory', () => {
      const result = getMaxOldSpaceSizeFlag()

      // Should be 75% of 8GB in MiB.
      expect(result).toBe(Math.floor(8 * 1024 * 0.75))
      expect(result).toBe(6144)
    })

    it('respects NODE_OPTIONS', () => {
      process.env.NODE_OPTIONS = '--max-old-space-size=512'
      resetFlagCache()

      const result = getMaxOldSpaceSizeFlag()
      expect(result).toBe(512)

      // Cleanup.
      delete process.env.NODE_OPTIONS
    })

    it('respects user-provided flag', () => {
      const originalArgv = process.argv
      process.argv = ['node', 'script.js', '--max-old-space-size=1024']
      resetFlagCache()

      const result = getMaxOldSpaceSizeFlag()
      expect(result).toBe(1024)

      // Cleanup.
      process.argv = originalArgv
    })

    it('handles low memory systems', () => {
      const originalArgv = process.argv
      process.argv = ['node', 'script.js', '--max-old-space-size=256']
      resetFlagCache()

      const result = getMaxOldSpaceSizeFlag()
      // Should respect the explicitly set low value.
      expect(result).toBe(256)

      // Cleanup.
      process.argv = originalArgv
    })
  })

  describe('getMaxSemiSpaceSizeFlag', () => {
    it('calculates based on old space size for small heaps', () => {
      const result = getMaxSemiSpaceSizeFlag()

      // With 6144 MiB old space, should be 64 MiB semi space.
      expect(result).toBe(64)
    })

    it('respects NODE_OPTIONS', () => {
      process.env.NODE_OPTIONS = '--max-semi-space-size=16'
      resetFlagCache()

      const result = getMaxSemiSpaceSizeFlag()
      expect(result).toBe(16)

      // Cleanup.
      delete process.env.NODE_OPTIONS
    })

    it('respects user-provided flag', () => {
      const originalArgv = process.argv
      process.argv = ['node', 'script.js', '--max-semi-space-size=32']
      resetFlagCache()

      const result = getMaxSemiSpaceSizeFlag()
      expect(result).toBe(32)

      // Cleanup.
      process.argv = originalArgv
    })

    it('scales for very small heaps', () => {
      const originalArgv = process.argv
      process.argv = ['node', 'script.js', '--max-old-space-size=512']
      resetFlagCache()

      const result = getMaxSemiSpaceSizeFlag()
      // 512 MiB heap should use 4 MiB semi-space.
      expect(result).toBe(4)

      // Cleanup.
      process.argv = originalArgv
    })

    it('scales for large heaps', () => {
      const originalArgv = process.argv
      process.argv = ['node', 'script.js', '--max-old-space-size=16384']
      resetFlagCache()

      const result = getMaxSemiSpaceSizeFlag()
      // 16384 MiB (16 GiB) heap: log2(16384) = 14, 14 * 8 = 112.
      expect(result).toBe(112)

      // Cleanup.
      process.argv = originalArgv
    })
  })

  describe('commonFlags', () => {
    it('exports common CLI flags', () => {
      expect(commonFlags).toBeDefined()
      expect(typeof commonFlags).toBe('object')

      // Check for expected common flags.
      expect(commonFlags).toHaveProperty('banner')
      expect(commonFlags).toHaveProperty('compactHeader')
      expect(commonFlags).toHaveProperty('config')
      expect(commonFlags).toHaveProperty('dryRun')
      expect(commonFlags).toHaveProperty('help')
      expect(commonFlags).toHaveProperty('helpFull')
      expect(commonFlags).toHaveProperty('maxOldSpaceSize')
      expect(commonFlags).toHaveProperty('maxSemiSpaceSize')
      expect(commonFlags).toHaveProperty('spinner')

      // Check flag types.
      expect(commonFlags.banner?.type).toBe('boolean')
      expect(commonFlags.compactHeader?.type).toBe('boolean')
      expect(commonFlags.config?.type).toBe('string')
      expect(commonFlags.dryRun?.type).toBe('boolean')
      expect(commonFlags.help?.type).toBe('boolean')
      expect(commonFlags.helpFull?.type).toBe('boolean')
      expect(commonFlags.maxOldSpaceSize?.type).toBe('number')
      expect(commonFlags.maxSemiSpaceSize?.type).toBe('number')
      expect(commonFlags.spinner?.type).toBe('boolean')
    })

    it('has descriptions for all flags', () => {
      for (const [, flag] of Object.entries(commonFlags)) {
        expect(flag).toHaveProperty('description')
        expect(typeof flag.description).toBe('string')
        expect(flag.description.length).toBeGreaterThan(0)
      }
    })

    it('has short flags for common options', () => {
      expect(commonFlags.config?.shortFlag).toBe('c')
      expect(commonFlags.help?.shortFlag).toBe('h')
    })
  })

  describe('outputFlags', () => {
    it('exports output formatting flags', () => {
      expect(outputFlags).toBeDefined()
      expect(typeof outputFlags).toBe('object')

      // Check for expected output flags.
      expect(outputFlags).toHaveProperty('json')
      expect(outputFlags).toHaveProperty('markdown')

      // Check flag types.
      expect(outputFlags.json?.type).toBe('boolean')
      expect(outputFlags.markdown?.type).toBe('boolean')
    })

    it('has descriptions for all flags', () => {
      for (const [, flag] of Object.entries(outputFlags)) {
        expect(flag).toHaveProperty('description')
        expect(typeof flag.description).toBe('string')
        expect(flag.description.length).toBeGreaterThan(0)
      }
    })

    it('has short flags for output options', () => {
      expect(outputFlags.json?.shortFlag).toBe('j')
      expect(outputFlags.markdown?.shortFlag).toBe('m')
    })
  })

  describe('validationFlags', () => {
    it('exports validation-related flags', () => {
      expect(validationFlags).toBeDefined()
      expect(typeof validationFlags).toBe('object')

      // Check for expected validation flags.
      expect(validationFlags).toHaveProperty('all')
      expect(validationFlags).toHaveProperty('strict')

      // Check flag types.
      expect(validationFlags.all?.type).toBe('boolean')
      expect(validationFlags.strict?.type).toBe('boolean')
    })

    it('has descriptions for all flags', () => {
      for (const [, flag] of Object.entries(validationFlags)) {
        expect(flag).toHaveProperty('description')
        expect(typeof flag.description).toBe('string')
        expect(flag.description.length).toBeGreaterThan(0)
      }
    })

    it('validation flags do not have short flags', () => {
      // Validation flags don't have short flags by design.
      expect(validationFlags.all?.shortFlag).toBeUndefined()
      expect(validationFlags.strict?.shortFlag).toBeUndefined()
    })
  })
})
