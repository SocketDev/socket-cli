/**
 * Unit tests for find-up utility.
 *
 * Purpose:
 * Tests the findUp function for searching files up the directory tree.
 *
 * Test Coverage:
 * - Finding files by single name
 * - Finding files by multiple names
 * - Finding directories
 * - Abort signal handling
 * - Custom working directory
 *
 * Related Files:
 * - src/utils/fs/find-up.mts (implementation)
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { findUp } from '../../../../src/utils/fs/find-up.mts'

describe('find-up', () => {
  // Create a temporary test directory structure.
  const testRoot = path.join(process.cwd(), '.test-find-up-temp')
  const level1 = path.join(testRoot, 'level1')
  const level2 = path.join(level1, 'level2')
  const level3 = path.join(level2, 'level3')

  beforeAll(() => {
    // Create directory structure.
    mkdirSync(level3, { recursive: true })

    // Create test files at different levels.
    writeFileSync(path.join(testRoot, 'root.config'), 'root')
    writeFileSync(path.join(testRoot, 'package.json'), '{}')
    writeFileSync(path.join(level1, 'level1.config'), 'level1')
    writeFileSync(path.join(level2, 'level2.config'), 'level2')

    // Create a directory to test onlyDirectories.
    mkdirSync(path.join(level1, 'target-dir'), { recursive: true })
  })

  afterAll(() => {
    // Clean up test directory.
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true })
    }
  })

  describe('findUp', () => {
    describe('basic file finding', () => {
      it('finds file in current directory', async () => {
        const result = await findUp('level2.config', { cwd: level2 })

        expect(result).toBe(path.join(level2, 'level2.config'))
      })

      it('finds file in parent directory', async () => {
        const result = await findUp('level1.config', { cwd: level2 })

        expect(result).toBe(path.join(level1, 'level1.config'))
      })

      it('finds file in ancestor directory', async () => {
        const result = await findUp('root.config', { cwd: level3 })

        expect(result).toBe(path.join(testRoot, 'root.config'))
      })

      it('returns undefined when file not found', async () => {
        const result = await findUp('nonexistent.config', { cwd: level3 })

        expect(result).toBeUndefined()
      })
    })

    describe('multiple names', () => {
      it('finds first matching file from array', async () => {
        const result = await findUp(['level1.config', 'level2.config'], {
          cwd: level2,
        })

        // Should find level2.config first since we're starting in level2.
        expect(result).toBe(path.join(level2, 'level2.config'))
      })

      it('finds second name if first not present', async () => {
        const result = await findUp(['nonexistent.config', 'root.config'], {
          cwd: level3,
        })

        expect(result).toBe(path.join(testRoot, 'root.config'))
      })

      it('returns undefined when no names match', async () => {
        const result = await findUp(['a.config', 'b.config', 'c.config'], {
          cwd: level3,
        })

        expect(result).toBeUndefined()
      })
    })

    describe('directory finding', () => {
      it('finds directory with onlyDirectories option', async () => {
        const result = await findUp('target-dir', {
          cwd: level2,
          onlyDirectories: true,
        })

        expect(result).toBe(path.join(level1, 'target-dir'))
      })

      it('does not find file when onlyDirectories is true', async () => {
        const result = await findUp('level1.config', {
          cwd: level2,
          onlyDirectories: true,
        })

        expect(result).toBeUndefined()
      })

      it('does not find directory when onlyFiles is true', async () => {
        const result = await findUp('target-dir', {
          cwd: level2,
          onlyFiles: true,
        })

        expect(result).toBeUndefined()
      })
    })

    describe('options', () => {
      it('uses provided cwd', async () => {
        const result = await findUp('level2.config', { cwd: level2 })

        expect(result).toBe(path.join(level2, 'level2.config'))
      })

      it('uses process.cwd when cwd not provided', async () => {
        // This test depends on the actual cwd, so just verify it doesn't throw.
        const result = await findUp('package.json')

        // Should find package.json somewhere up the tree.
        if (result) {
          expect(result).toContain('package.json')
        }
      })
    })

    describe('abort signal', () => {
      it('returns undefined when signal is aborted', async () => {
        const controller = new AbortController()
        controller.abort()

        const result = await findUp('root.config', {
          cwd: level3,
          signal: controller.signal,
        })

        expect(result).toBeUndefined()
      })
    })

    describe('edge cases', () => {
      it('handles single name as string', async () => {
        const result = await findUp('package.json', { cwd: level3 })

        expect(result).toBe(path.join(testRoot, 'package.json'))
      })

      it('handles empty names array', async () => {
        const result = await findUp([], { cwd: level3 })

        expect(result).toBeUndefined()
      })
    })
  })
})
