/**
 * Unit tests for Python standalone utilities.
 *
 * Purpose:
 * Tests the re-exports from the DLX spawn utilities.
 *
 * Test Coverage:
 * - Re-export verification
 * - Type export verification
 * - Function signatures
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

// Also import directly from dlx/spawn to verify the re-exports match.
import {
  ensurePython as dlxEnsurePython,
  ensurePythonDlx as dlxEnsurePythonDlx,
  ensureSocketPyCli as dlxEnsureSocketPyCli,
  spawnSocketPyCli as dlxSpawnSocketPyCli,
} from '../../../../src/utils/dlx/spawn.mts'

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

  describe('re-export identity', () => {
    it('ensurePython is the same function from dlx/spawn', () => {
      expect(ensurePython).toBe(dlxEnsurePython)
    })

    it('ensurePythonDlx is the same function from dlx/spawn', () => {
      expect(ensurePythonDlx).toBe(dlxEnsurePythonDlx)
    })

    it('ensureSocketPyCli is the same function from dlx/spawn', () => {
      expect(ensureSocketPyCli).toBe(dlxEnsureSocketPyCli)
    })

    it('spawnSocketPyCli is the same function from dlx/spawn', () => {
      expect(spawnSocketPyCli).toBe(dlxSpawnSocketPyCli)
    })
  })

  describe('function signatures', () => {
    it('ensurePython is an async function', () => {
      // Async functions have a constructor named AsyncFunction.
      expect(ensurePython.constructor.name).toBe('AsyncFunction')
    })

    it('ensurePythonDlx is an async function', () => {
      expect(ensurePythonDlx.constructor.name).toBe('AsyncFunction')
    })

    it('ensureSocketPyCli is an async function', () => {
      expect(ensureSocketPyCli.constructor.name).toBe('AsyncFunction')
    })

    it('spawnSocketPyCli is an async function', () => {
      expect(spawnSocketPyCli.constructor.name).toBe('AsyncFunction')
    })
  })
})
