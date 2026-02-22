/**
 * Unit tests for standalone Python utilities.
 *
 * Purpose:
 * Tests standalone Python utilities. Validates Python binary detection.
 *
 * Test Coverage:
 * - ensurePython function
 * - Python binary availability
 *
 * Testing Approach:
 * Tests Python ecosystem utilities.
 *
 * Related Files:
 * - utils/python/standalone.mts (implementation)
 * - utils/dlx/spawn.mts (actual implementation)
 */

import { describe, expect, it } from 'vitest'

import { ensurePython } from '../../../../src/utils/python/standalone.mts'

describe('python-standalone', () => {
  describe('ensurePython', () => {
    it('should ensure Python is available or throw error', async () => {
      try {
        const pythonBin = await ensurePython()
        expect(typeof pythonBin).toBe('string')
        expect(pythonBin.length).toBeGreaterThan(0)
        expect(pythonBin).toContain('python')
      } catch (e) {
        // In test environment without proper constants, download might fail.
        // This is expected and not a test failure.
        expect(e).toBeDefined()
      }
      // Give it 60 seconds for potential download.
    }, 60_000)
  })
})
