import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { findUp } from './fs.mts'

describe('fs utilities', () => {
  describe('findUp', () => {
    let testDir: string
    let nestedDir: string

    beforeEach(async () => {
      // Create temporary test directory structure.
      testDir = path.join(tmpdir(), `socket-test-${Date.now()}`)
      nestedDir = path.join(testDir, 'level1', 'level2', 'level3')

      await fs.mkdir(nestedDir, { recursive: true })

      // Create test files at different levels.
      await fs.writeFile(path.join(testDir, 'root.txt'), 'root')
      await fs.writeFile(path.join(testDir, 'package.json'), '{}')
      await fs.writeFile(path.join(testDir, 'level1', 'middle.txt'), 'middle')
      await fs.writeFile(
        path.join(testDir, 'level1', 'level2', 'package.json'),
        '{}',
      )

      // Create test directory.
      await fs.mkdir(path.join(testDir, 'level1', '.git'))
    })

    afterEach(async () => {
      // Clean up test directory.
      try {
        await fs.rm(testDir, { recursive: true, force: true })
      } catch {
        // Ignore cleanup errors.
      }
    })

    it('finds file in current directory', async () => {
      const result = await findUp('package.json', { cwd: testDir })
      expect(result).toBe(path.join(testDir, 'package.json'))
    })

    it('finds file in parent directory', async () => {
      const result = await findUp('root.txt', { cwd: nestedDir })
      expect(result).toBe(path.join(testDir, 'root.txt'))
    })

    it('finds nearest file when multiple exist', async () => {
      const result = await findUp('package.json', { cwd: nestedDir })
      expect(result).toBe(
        path.join(testDir, 'level1', 'level2', 'package.json'),
      )
    })

    it('returns undefined when file not found', async () => {
      const result = await findUp('nonexistent.txt', { cwd: nestedDir })
      expect(result).toBeUndefined()
    })

    it('searches for multiple file names', async () => {
      const result = await findUp(['nonexistent.txt', 'middle.txt'], {
        cwd: nestedDir,
      })
      expect(result).toBe(path.join(testDir, 'level1', 'middle.txt'))
    })

    it('finds directory when onlyDirectories is true', async () => {
      const result = await findUp('.git', {
        cwd: nestedDir,
        onlyDirectories: true,
      })
      expect(result).toBe(path.join(testDir, 'level1', '.git'))
    })

    it('ignores directories when onlyFiles is true', async () => {
      const result = await findUp('.git', {
        cwd: nestedDir,
        onlyFiles: true,
      })
      expect(result).toBeUndefined()
    })

    it('respects abort signal', async () => {
      const controller = new AbortController()
      controller.abort()

      const result = await findUp('package.json', {
        cwd: nestedDir,
        signal: controller.signal,
      })
      expect(result).toBeUndefined()
    })

    it('searches both files and directories when neither flag is set', async () => {
      const fileResult = await findUp('package.json', {
        cwd: nestedDir,
        onlyFiles: false,
        onlyDirectories: false,
      })
      expect(fileResult).toBe(
        path.join(testDir, 'level1', 'level2', 'package.json'),
      )

      const dirResult = await findUp('.git', {
        cwd: nestedDir,
        onlyFiles: false,
        onlyDirectories: false,
      })
      expect(dirResult).toBe(path.join(testDir, 'level1', '.git'))
    })

    it('uses current working directory by default', async () => {
      const originalCwd = process.cwd()
      try {
        process.chdir(testDir)
        const result = await findUp('package.json')
        // Handle macOS /private symlink.
        const _expectedPath = path.join(testDir, 'package.json')
        expect(result).toMatch(
          new RegExp(`${path.basename(testDir)}/package\\.json$`),
        )
      } finally {
        process.chdir(originalCwd)
      }
    })

    it('stops at filesystem root', async () => {
      const result = await findUp('absolutely-nonexistent-file.xyz', {
        cwd: '/',
      })
      expect(result).toBeUndefined()
    })
  })
})
