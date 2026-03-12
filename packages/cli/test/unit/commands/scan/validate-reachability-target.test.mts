/**
 * Unit tests for reachability target validation.
 *
 * Purpose:
 * Tests the validateReachabilityTarget function for validating scan targets.
 *
 * Test Coverage:
 * - Single target validation
 * - Multiple targets rejection
 * - Directory vs file detection
 * - Path containment checks
 *
 * Related Files:
 * - commands/scan/validate-reachability-target.mts (implementation)
 */

import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { validateReachabilityTarget } from '../../../../src/commands/scan/validate-reachability-target.mts'

describe('validate-reachability-target', () => {
  describe('validateReachabilityTarget', () => {
    it('returns invalid for empty targets array', async () => {
      const result = await validateReachabilityTarget([], '/home/user')

      expect(result.isValid).toBe(false)
    })

    it('returns invalid for multiple targets', async () => {
      const result = await validateReachabilityTarget(
        ['/path1', '/path2'],
        '/home/user',
      )

      expect(result.isValid).toBe(false)
    })

    it('returns valid with target inside cwd', async () => {
      const cwd = process.cwd()
      const result = await validateReachabilityTarget(['.'], cwd)

      expect(result.isValid).toBe(true)
      expect(result.isInsideCwd).toBe(true)
    })

    it('detects existing directory', async () => {
      const cwd = process.cwd()
      const result = await validateReachabilityTarget(['.'], cwd)

      expect(result.targetExists).toBe(true)
      expect(result.isDirectory).toBe(true)
    })

    it('detects non-existent target', async () => {
      const cwd = process.cwd()
      const result = await validateReachabilityTarget(
        ['./non-existent-dir-xyz'],
        cwd,
      )

      expect(result.targetExists).toBe(false)
      expect(result.isDirectory).toBe(false)
    })

    it('detects target outside cwd', async () => {
      const cwd = '/home/user/project'
      const result = await validateReachabilityTarget(['../other'], cwd)

      expect(result.isValid).toBe(true)
      expect(result.isInsideCwd).toBe(false)
    })

    it('handles absolute path inside cwd', async () => {
      const cwd = process.cwd()
      const absolutePath = path.join(cwd, 'src')
      const result = await validateReachabilityTarget([absolutePath], cwd)

      expect(result.isValid).toBe(true)
      expect(result.isInsideCwd).toBe(true)
    })

    it('handles absolute path outside cwd', async () => {
      const cwd = '/home/user/project'
      const result = await validateReachabilityTarget(['/tmp'], cwd)

      expect(result.isValid).toBe(true)
      expect(result.isInsideCwd).toBe(false)
    })

    it('detects file as non-directory', async () => {
      const cwd = process.cwd()
      // Use package.json as a known file.
      const result = await validateReachabilityTarget(['package.json'], cwd)

      expect(result.targetExists).toBe(true)
      expect(result.isDirectory).toBe(false)
    })
  })
})
