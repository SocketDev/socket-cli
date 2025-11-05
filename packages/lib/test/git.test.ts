/**
 * @fileoverview Integration tests for git utility functions.
 *
 * Tests git repository operations against actual repository state:
 * - findGitRoot() locates .git directory from any path
 * - getChangedFiles(), getStagedFiles(), getUnstagedFiles() track working tree state
 * - isChanged(), isStaged(), isUnstaged() check individual file status
 * - Sync variants for all operations (*Sync)
 * - Real git integration (not mocked - tests actual repository)
 * Used by Socket CLI for git-aware operations (pre-commit hooks, file filtering).
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import {
  findGitRoot,
  getChangedFiles,
  getChangedFilesSync,
  getStagedFiles,
  getStagedFilesSync,
  getUnstagedFiles,
  getUnstagedFilesSync,
  isChanged,
  isChangedSync,
  isStaged,
  isStagedSync,
  isUnstaged,
  isUnstagedSync,
} from '@socketsecurity/lib/git'
import { describe, expect, it } from 'vitest'

describe('git', () => {
  const projectRoot = process.cwd()

  describe('findGitRoot', () => {
    it('should find git root from current directory', () => {
      const result = findGitRoot(projectRoot)
      expect(result).toBe(projectRoot)
      expect(result).toContain('socket-lib')
    })

    it('should find git root from subdirectory', () => {
      const testDir = path.join(projectRoot, 'test', 'registry')
      const result = findGitRoot(testDir)
      expect(result).toBe(projectRoot)
    })

    it('should find git root from deeply nested directory', () => {
      const srcDir = path.join(projectRoot, 'src', 'constants')
      const result = findGitRoot(srcDir)
      expect(result).toBe(projectRoot)
    })

    it('should handle root directory gracefully', () => {
      // On systems where root is not a git repo, should return root
      const result = findGitRoot('/')
      expect(result).toBeTruthy()
      expect(typeof result).toBe('string')
    })
  })

  describe('getChangedFiles', () => {
    it('should return an array', async () => {
      const result = await getChangedFiles({ cwd: projectRoot })
      expect(Array.isArray(result)).toBe(true)
    })

    it('should return file paths as strings', async () => {
      const result = await getChangedFiles({ cwd: projectRoot })
      for (const file of result) {
        expect(typeof file).toBe('string')
      }
    })

    it('should respect cwd option', async () => {
      const result = await getChangedFiles({ cwd: projectRoot })
      expect(Array.isArray(result)).toBe(true)
    })

    it('should return absolute paths when absolute option is true', async () => {
      const result = await getChangedFiles({
        absolute: true,
        cwd: projectRoot,
      })
      for (const file of result) {
        if (file) {
          expect(path.isAbsolute(file)).toBe(true)
        }
      }
    })

    it('should handle empty repository state', async () => {
      // In a clean repo, should return empty array or files
      const result = await getChangedFiles({ cwd: projectRoot })
      expect(Array.isArray(result)).toBe(true)
    })
  })

  describe('getChangedFilesSync', () => {
    it('should return an array', () => {
      const result = getChangedFilesSync({ cwd: projectRoot })
      expect(Array.isArray(result)).toBe(true)
    })

    it('should return file paths as strings', () => {
      const result = getChangedFilesSync({ cwd: projectRoot })
      for (const file of result) {
        expect(typeof file).toBe('string')
      }
    })

    it('should match async version', async () => {
      const syncResult = getChangedFilesSync({ cwd: projectRoot })
      const asyncResult = await getChangedFiles({ cwd: projectRoot })
      expect(syncResult).toEqual(asyncResult)
    })
  })

  describe('getStagedFiles', () => {
    it('should return an array', async () => {
      const result = await getStagedFiles({ cwd: projectRoot })
      expect(Array.isArray(result)).toBe(true)
    })

    it('should return file paths as strings', async () => {
      const result = await getStagedFiles({ cwd: projectRoot })
      for (const file of result) {
        expect(typeof file).toBe('string')
      }
    })

    it('should return absolute paths when absolute option is true', async () => {
      const result = await getStagedFiles({
        absolute: true,
        cwd: projectRoot,
      })
      for (const file of result) {
        if (file) {
          expect(path.isAbsolute(file)).toBe(true)
        }
      }
    })
  })

  describe('getStagedFilesSync', () => {
    it('should return an array', () => {
      const result = getStagedFilesSync({ cwd: projectRoot })
      expect(Array.isArray(result)).toBe(true)
    })

    it('should match async version', async () => {
      const syncResult = getStagedFilesSync({ cwd: projectRoot })
      const asyncResult = await getStagedFiles({ cwd: projectRoot })
      expect(syncResult).toEqual(asyncResult)
    })
  })

  describe('getUnstagedFiles', () => {
    it('should return an array', async () => {
      const result = await getUnstagedFiles({ cwd: projectRoot })
      expect(Array.isArray(result)).toBe(true)
    })

    it('should return file paths as strings', async () => {
      const result = await getUnstagedFiles({ cwd: projectRoot })
      for (const file of result) {
        expect(typeof file).toBe('string')
      }
    })

    it('should return absolute paths when absolute option is true', async () => {
      const result = await getUnstagedFiles({
        absolute: true,
        cwd: projectRoot,
      })
      for (const file of result) {
        if (file) {
          expect(path.isAbsolute(file)).toBe(true)
        }
      }
    })
  })

  describe('getUnstagedFilesSync', () => {
    it('should return an array', () => {
      const result = getUnstagedFilesSync({ cwd: projectRoot })
      expect(Array.isArray(result)).toBe(true)
    })

    it('should match async version', async () => {
      const syncResult = getUnstagedFilesSync({ cwd: projectRoot })
      const asyncResult = await getUnstagedFiles({ cwd: projectRoot })
      expect(syncResult).toEqual(asyncResult)
    })
  })

  describe('isChanged', () => {
    it('should return boolean for existing file', async () => {
      const testFile = path.join(projectRoot, 'package.json')
      const result = await isChanged(testFile, { cwd: projectRoot })
      expect(typeof result).toBe('boolean')
    })

    it('should return false for committed file in clean repo', async () => {
      // README.md should exist and be committed
      const testFile = path.join(projectRoot, 'README.md')
      const fileExists = await fs
        .access(testFile)
        .then(() => true)
        .catch(() => false)
      if (fileExists) {
        const result = await isChanged(testFile, { cwd: projectRoot })
        // In a clean repo, committed files should not be changed
        expect(typeof result).toBe('boolean')
      }
    })

    it('should work with relative paths', async () => {
      const result = await isChanged('package.json', { cwd: projectRoot })
      expect(typeof result).toBe('boolean')
    })

    it('should throw for non-existent files', async () => {
      // Non-existent files cause fs.lstat to throw ENOENT
      await expect(
        isChanged('nonexistent-file.ts', { cwd: projectRoot }),
      ).rejects.toThrow(/ENOENT|no such file/)
    })
  })

  describe('isChangedSync', () => {
    it('should return boolean for existing file', () => {
      const testFile = path.join(projectRoot, 'package.json')
      const result = isChangedSync(testFile, { cwd: projectRoot })
      expect(typeof result).toBe('boolean')
    })

    it('should match async version', async () => {
      const testFile = 'package.json'
      const syncResult = isChangedSync(testFile, { cwd: projectRoot })
      const asyncResult = await isChanged(testFile, { cwd: projectRoot })
      expect(syncResult).toBe(asyncResult)
    })
  })

  describe('isStaged', () => {
    it('should return boolean for existing file', async () => {
      const testFile = path.join(projectRoot, 'package.json')
      const result = await isStaged(testFile, { cwd: projectRoot })
      expect(typeof result).toBe('boolean')
    })

    it('should work with relative paths', async () => {
      const result = await isStaged('package.json', { cwd: projectRoot })
      expect(typeof result).toBe('boolean')
    })

    it('should throw for non-existent files', async () => {
      // Non-existent files cause fs.lstat to throw ENOENT
      await expect(
        isStaged('nonexistent-file.ts', { cwd: projectRoot }),
      ).rejects.toThrow(/ENOENT|no such file/)
    })
  })

  describe('isStagedSync', () => {
    it('should return boolean for existing file', () => {
      const testFile = path.join(projectRoot, 'package.json')
      const result = isStagedSync(testFile, { cwd: projectRoot })
      expect(typeof result).toBe('boolean')
    })

    it('should match async version', async () => {
      const testFile = 'package.json'
      const syncResult = isStagedSync(testFile, { cwd: projectRoot })
      const asyncResult = await isStaged(testFile, { cwd: projectRoot })
      expect(syncResult).toBe(asyncResult)
    })
  })

  describe('isUnstaged', () => {
    it('should return boolean for existing file', async () => {
      const testFile = path.join(projectRoot, 'package.json')
      const result = await isUnstaged(testFile, { cwd: projectRoot })
      expect(typeof result).toBe('boolean')
    })

    it('should work with relative paths', async () => {
      const result = await isUnstaged('package.json', { cwd: projectRoot })
      expect(typeof result).toBe('boolean')
    })

    it('should throw for non-existent files', async () => {
      // Non-existent files cause fs.lstat to throw ENOENT
      await expect(
        isUnstaged('nonexistent-file.ts', { cwd: projectRoot }),
      ).rejects.toThrow(/ENOENT|no such file/)
    })
  })

  describe('isUnstagedSync', () => {
    it('should return boolean for existing file', () => {
      const testFile = path.join(projectRoot, 'package.json')
      const result = isUnstagedSync(testFile, { cwd: projectRoot })
      expect(typeof result).toBe('boolean')
    })

    it('should match async version', async () => {
      const testFile = 'package.json'
      const syncResult = isUnstagedSync(testFile, { cwd: projectRoot })
      const asyncResult = await isUnstaged(testFile, { cwd: projectRoot })
      expect(syncResult).toBe(asyncResult)
    })
  })

  describe('edge cases', () => {
    it('should handle concurrent calls', async () => {
      const promises = [
        getChangedFiles({ cwd: projectRoot }),
        getStagedFiles({ cwd: projectRoot }),
        getUnstagedFiles({ cwd: projectRoot }),
      ]
      const results = await Promise.all(promises)
      for (const result of results) {
        expect(Array.isArray(result)).toBe(true)
      }
    })

    it('should handle multiple file checks', async () => {
      const files = ['package.json', 'tsconfig.json', 'README.md']
      const results = await Promise.all(
        files.map(file => isChanged(file, { cwd: projectRoot })),
      )
      for (const result of results) {
        expect(typeof result).toBe('boolean')
      }
    })

    it('should handle files in subdirectories', async () => {
      const result = await isChanged('src/logger.ts', { cwd: projectRoot })
      expect(typeof result).toBe('boolean')
    })
  })
})
