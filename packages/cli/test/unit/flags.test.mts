/**
 * @fileoverview Unit tests for CLI flag definitions and memory management.
 *
 * Tests the flag system including common flags, output flags, validation flags,
 * and dynamic memory configuration based on system resources.
 *
 * Test Coverage:
 * - getMaxOldSpaceSizeFlag: Default based on system memory (75% of RAM), CLI flag override
 * - getMaxSemiSpaceSizeFlag: Calculation based on old space size, CLI flag override
 * - commonFlags: Banner, compactHeader, config, dryRun, help, helpFull, maxOldSpaceSize, maxSemiSpaceSize, spinner flags
 * - outputFlags: JSON and markdown output format flags
 * - validationFlags: All and strict validation mode flags
 * - Flag structure validation (type, description, shortFlag properties)
 *
 * Testing Approach:
 * - Mock meow to control CLI flag parsing
 * - Test flag calculations with various memory configurations
 * - Validate flag metadata and structure
 *
 * Related Files:
 * - src/flags.mts - Flag definitions and memory management
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Store mock values that can be changed per test.
const mockValues = vi.hoisted(() => ({
  maxOldSpaceSize: 0,
  maxSemiSpaceSize: 0,
  nodeOptions: '',
  totalMem: 8 * 1024 * 1024 * 1024, // 8GB default.
}))

// Mock meow to return controlled flag values.
vi.mock('../../src/meow.mts', () => ({
  default: vi.fn(() => ({
    flags: {
      maxOldSpaceSize: mockValues.maxOldSpaceSize,
      maxSemiSpaceSize: mockValues.maxSemiSpaceSize,
    },
  })),
}))

// Mock node:os to control total memory.
vi.mock('node:os', async importOriginal => {
  const original = await importOriginal<typeof import('node:os')>()
  return {
    ...original,
    default: {
      ...original.default,
      totalmem: () => mockValues.totalMem,
    },
  }
})

// Mock NODE_OPTIONS to be controllable.
vi.mock('../../src/env/node-options.mts', () => ({
  get NODE_OPTIONS() {
    return mockValues.nodeOptions
  },
}))

import {
  commonFlags,
  getMaxOldSpaceSizeFlag,
  getMaxSemiSpaceSizeFlag,
  outputFlags,
  resetFlagCache,
  validationFlags,
} from '../../src/flags.mts'

describe('flags', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetFlagCache()
    // Reset mock values to defaults.
    mockValues.maxOldSpaceSize = 0
    mockValues.maxSemiSpaceSize = 0
    mockValues.nodeOptions = ''
    mockValues.totalMem = 8 * 1024 * 1024 * 1024 // 8GB.
  })

  afterEach(() => {
    resetFlagCache()
  })

  describe('getMaxOldSpaceSizeFlag', () => {
    it('returns default based on system memory', () => {
      const result = getMaxOldSpaceSizeFlag()

      // Should be 75% of 8GB in MiB.
      expect(result).toBe(Math.floor(8 * 1024 * 0.75))
      expect(result).toBe(6144)
    })

    it('respects NODE_OPTIONS', () => {
      mockValues.nodeOptions = '--max-old-space-size=512'
      resetFlagCache()

      const result = getMaxOldSpaceSizeFlag()
      expect(result).toBe(512)
    })

    it('respects user-provided flag', () => {
      mockValues.maxOldSpaceSize = 1024
      resetFlagCache()

      const result = getMaxOldSpaceSizeFlag()
      expect(result).toBe(1024)
    })

    it('handles low memory systems', () => {
      mockValues.maxOldSpaceSize = 256
      resetFlagCache()

      const result = getMaxOldSpaceSizeFlag()
      // Should respect the explicitly set low value.
      expect(result).toBe(256)
    })

    it('calculates for 4GB system', () => {
      mockValues.totalMem = 4 * 1024 * 1024 * 1024 // 4GB.
      resetFlagCache()

      const result = getMaxOldSpaceSizeFlag()
      // Should be 75% of 4GB in MiB = 3072.
      expect(result).toBe(3072)
    })
  })

  describe('getMaxSemiSpaceSizeFlag', () => {
    it('calculates based on old space size for small heaps', () => {
      // With default 8GB, old space is 6144 MiB, so semi should be 64.
      const result = getMaxSemiSpaceSizeFlag()
      expect(result).toBe(64)
    })

    it('respects NODE_OPTIONS', () => {
      mockValues.nodeOptions = '--max-semi-space-size=16'
      resetFlagCache()

      const result = getMaxSemiSpaceSizeFlag()
      expect(result).toBe(16)
    })

    it('respects user-provided flag', () => {
      mockValues.maxSemiSpaceSize = 32
      resetFlagCache()

      const result = getMaxSemiSpaceSizeFlag()
      expect(result).toBe(32)
    })

    it('scales for very small heaps', () => {
      mockValues.maxOldSpaceSize = 512
      resetFlagCache()

      const result = getMaxSemiSpaceSizeFlag()
      // 512 MiB heap should use 4 MiB semi-space.
      expect(result).toBe(4)
    })

    it('scales for large heaps', () => {
      mockValues.maxOldSpaceSize = 16384
      resetFlagCache()

      const result = getMaxSemiSpaceSizeFlag()
      // 16384 MiB (16 GiB) heap: log2(16384) = 14, 14 * 8 = 112.
      expect(result).toBe(112)
    })

    it('scales for medium heaps', () => {
      mockValues.maxOldSpaceSize = 2048
      resetFlagCache()

      const result = getMaxSemiSpaceSizeFlag()
      // 2048 MiB heap should use 16 MiB semi-space.
      expect(result).toBe(16)
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
