/**
 * Unit tests for Python standalone utilities.
 *
 * Purpose:
 * Tests the re-exports from the DLX spawn utilities.
 *
 * Test Coverage:
 * - Re-export verification
 * - Type export verification
 *
 * Related Files:
 * - utils/python/standalone.mts (implementation)
 * - utils/dlx/spawn.mts (source module)
 */

import { describe, expect, it } from 'vitest'

import {
  ensurePython,
  ensurePythonDlx,
  ensureSocketPyCli,
  spawnSocketPyCli,
} from '../../../../src/utils/python/standalone.mts'

describe('python/standalone exports', () => {
  describe('re-exported functions', () => {
    it('exports ensurePython function', () => {
      expect(typeof ensurePython).toBe('function')
    })

    it('exports ensurePythonDlx function', () => {
      expect(typeof ensurePythonDlx).toBe('function')
    })

    it('exports ensureSocketPyCli function', () => {
      expect(typeof ensureSocketPyCli).toBe('function')
    })

    it('exports spawnSocketPyCli function', () => {
      expect(typeof spawnSocketPyCli).toBe('function')
    })
  })
})
