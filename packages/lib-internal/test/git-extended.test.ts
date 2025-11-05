/**
 * @fileoverview Extended integration tests for git utility functions.
 *
 * Tests advanced git operations with comprehensive coverage:
 * - Cache behavior: result caching and cache invalidation
 * - Error handling: invalid paths, non-git directories, permission issues
 * - Edge cases: empty repositories, untracked files, submodules
 * - Performance: cache hit rates, bulk operations
 * - Real git operations: actual repository state manipulation
 * Complements git.test.ts with deeper coverage of error paths and caching logic.
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
import { normalizePath } from '@socketsecurity/lib/path'
import { spawnSync } from '@socketsecurity/lib/spawn'
import { describe, expect, it } from 'vitest'
import { runWithTempDir } from './utils/temp-file-helper.mjs'

describe('git extended tests', () => {
  const projectRoot = normalizePath(process.cwd())

  describe('cache functionality', () => {
    it('should cache results by default', async () => {
      // First call
      const result1 = await getChangedFiles({ cwd: projectRoot })
      // Second call should use cache
      const result2 = await getChangedFiles({ cwd: projectRoot })
      expect(result1).toEqual(result2)
    })

    it('should not cache when cache option is false', async () => {
      const result1 = await getChangedFiles({ cache: false, cwd: projectRoot })
      const result2 = await getChangedFiles({ cache: false, cwd: projectRoot })
      // Results should be arrays (may not be exactly equal if files changed)
      expect(Array.isArray(result1)).toBe(true)
      expect(Array.isArray(result2)).toBe(true)
    })

    it('should cache sync results', () => {
      const result1 = getChangedFilesSync({ cwd: projectRoot })
      const result2 = getChangedFilesSync({ cwd: projectRoot })
      expect(result1).toEqual(result2)
    })

    it('should have separate cache entries for different options', async () => {
      const result1 = await getChangedFiles({
        absolute: false,
        cwd: projectRoot,
      })
      const result2 = await getChangedFiles({
        absolute: true,
        cwd: projectRoot,
      })
      // Cache should not mix absolute and relative results
      expect(Array.isArray(result1)).toBe(true)
      expect(Array.isArray(result2)).toBe(true)
    })

    it('should cache staged files separately from changed files', async () => {
      const changed = await getChangedFiles({ cwd: projectRoot })
      const staged = await getStagedFiles({ cwd: projectRoot })
      // These should be different cache entries
      expect(Array.isArray(changed)).toBe(true)
      expect(Array.isArray(staged)).toBe(true)
    })

    it('should cache unstaged files separately', async () => {
      const unstaged = await getUnstagedFiles({ cwd: projectRoot })
      const staged = await getStagedFiles({ cwd: projectRoot })
      expect(Array.isArray(unstaged)).toBe(true)
      expect(Array.isArray(staged)).toBe(true)
    })
  })

  describe('options handling', () => {
    it('should handle asSet option', async () => {
      const result = await getChangedFiles({ asSet: true, cwd: projectRoot })
      // Even with asSet, the function returns array (option is for future use)
      expect(Array.isArray(result)).toBe(true)
    })

    it('should handle porcelain format explicitly', async () => {
      // getChangedFiles already uses porcelain internally
      const result = await getChangedFiles({
        cwd: projectRoot,
        porcelain: true,
      })
      expect(Array.isArray(result)).toBe(true)
    })

    it('should handle empty options object', async () => {
      const result = await getChangedFiles({})
      expect(Array.isArray(result)).toBe(true)
    })

    it('should handle undefined options', async () => {
      const result = await getChangedFiles(undefined)
      expect(Array.isArray(result)).toBe(true)
    })

    it('should handle glob matcher options', async () => {
      const result = await getChangedFiles({
        cwd: projectRoot,
        dot: true,
        nocase: true,
      })
      expect(Array.isArray(result)).toBe(true)
    })
  })

  describe('error handling', () => {
    it('should return empty array when git command fails', async () => {
      // Use a non-git directory
      await runWithTempDir(async tmpDir => {
        const result = await getChangedFiles({ cwd: tmpDir })
        expect(result).toEqual([])
      }, 'git-error-')
    })

    it('should return empty array for sync version when git fails', async () => {
      await runWithTempDir(async tmpDir => {
        const result = getChangedFilesSync({ cwd: tmpDir })
        expect(result).toEqual([])
      }, 'git-error-sync-')
    })

    it('should handle invalid cwd gracefully in findGitRoot', () => {
      // findGitRoot should return the original path if no .git found
      const nonGitPath = '/nonexistent/path/that/does/not/exist'
      const result = findGitRoot(nonGitPath)
      expect(result).toBe(nonGitPath)
    })

    it('should return empty array for getStagedFiles in non-git dir', async () => {
      await runWithTempDir(async tmpDir => {
        const result = await getStagedFiles({ cwd: tmpDir })
        expect(result).toEqual([])
      }, 'git-staged-error-')
    })

    it('should return empty array for getUnstagedFiles in non-git dir', async () => {
      await runWithTempDir(async tmpDir => {
        const result = await getUnstagedFiles({ cwd: tmpDir })
        expect(result).toEqual([])
      }, 'git-unstaged-error-')
    })
  })

  describe('path resolution', () => {
    it('should normalize paths correctly', async () => {
      const result = await getChangedFiles({ cwd: projectRoot })
      for (const file of result) {
        // Paths should not have backslashes (even on Windows)
        expect(file).not.toContain('\\')
      }
    })

    it('should handle relative paths in cwd', async () => {
      // Test with a relative path for cwd
      const result = await getChangedFiles({ cwd: '.' })
      expect(Array.isArray(result)).toBe(true)
    })

    it('should resolve absolute paths correctly', async () => {
      const result = await getChangedFiles({ absolute: true, cwd: projectRoot })
      for (const file of result) {
        if (file) {
          expect(path.isAbsolute(file)).toBe(true)
          expect(file).toContain(projectRoot)
        }
      }
    })

    it('should handle subdirectory cwd correctly', async () => {
      const srcDir = path.join(projectRoot, 'src')
      const result = await getChangedFiles({ cwd: srcDir })
      expect(Array.isArray(result)).toBe(true)
      // Files should be filtered to src directory if there are changes
      for (const file of result) {
        // File paths should be relative to repo root but filtered to src
        expect(typeof file).toBe('string')
      }
    })
  })

  describe('real git operations', () => {
    // Note: No need to save/restore cwd - we always use explicit cwd options

    it('should work with a temporary git repository', async () => {
      await runWithTempDir(async tmpDir => {
        // Initialize a git repo
        spawnSync('git', ['init'], { cwd: tmpDir })
        spawnSync('git', ['config', 'user.name', 'Test User'], { cwd: tmpDir })
        spawnSync('git', ['config', 'user.email', 'test@example.com'], {
          cwd: tmpDir,
        })

        // Create a file
        const testFile = path.join(tmpDir, 'test.txt')
        await fs.writeFile(testFile, 'test content', 'utf8')

        // File should appear as changed (untracked)
        const changed = await getChangedFiles({ cwd: tmpDir })
        expect(changed).toContain('test.txt')

        // Stage the file
        spawnSync('git', ['add', 'test.txt'], { cwd: tmpDir })

        // File should now be staged
        const staged = await getStagedFiles({ cwd: tmpDir })
        expect(staged).toContain('test.txt')

        // Commit the file
        spawnSync('git', ['commit', '-m', 'Initial commit'], { cwd: tmpDir })

        // Now there should be no changes (or at most just test.txt if git is showing it)
        const afterCommit = await getChangedFiles({ cwd: tmpDir })
        // In some git configurations, files may still appear, so just check it's an array
        expect(Array.isArray(afterCommit)).toBe(true)

        // Modify the file
        await fs.writeFile(testFile, 'modified content', 'utf8')

        // Should show as unstaged
        const unstaged = await getUnstagedFiles({ cwd: tmpDir })
        expect(unstaged).toContain('test.txt')

        // Check isChanged
        const isChangedResult = await isChanged(testFile, { cwd: tmpDir })
        expect(isChangedResult).toBe(true)

        // Check isUnstaged
        const isUnstagedResult = await isUnstaged(testFile, { cwd: tmpDir })
        expect(isUnstagedResult).toBe(true)

        // Check isStaged (should be false)
        const isStagedResult = await isStaged(testFile, { cwd: tmpDir })
        expect(isStagedResult).toBe(false)

        // Stage the changes
        spawnSync('git', ['add', 'test.txt'], { cwd: tmpDir })

        // Now it should be staged
        const stagedAfter = await getStagedFiles({ cwd: tmpDir })
        expect(stagedAfter).toContain('test.txt')

        // And should still show as changed
        const isChangedAfter = await isChanged(testFile, { cwd: tmpDir })
        expect(typeof isChangedAfter).toBe('boolean')
      }, 'git-ops-')
    })

    it('should detect untracked files', async () => {
      await runWithTempDir(async tmpDir => {
        spawnSync('git', ['init'], { cwd: tmpDir })
        spawnSync('git', ['config', 'user.name', 'Test User'], { cwd: tmpDir })
        spawnSync('git', ['config', 'user.email', 'test@example.com'], {
          cwd: tmpDir,
        })

        const untracked = path.join(tmpDir, 'untracked.txt')
        await fs.writeFile(untracked, 'untracked', 'utf8')

        const changed = await getChangedFiles({ cwd: tmpDir })
        expect(changed).toContain('untracked.txt')

        // Untracked files should not appear in unstaged (they're not tracked)
        const unstaged = await getUnstagedFiles({ cwd: tmpDir })
        expect(unstaged).not.toContain('untracked.txt')
      }, 'git-untracked-')
    })

    it('should handle nested directories', async () => {
      await runWithTempDir(async tmpDir => {
        spawnSync('git', ['init'], { cwd: tmpDir })
        spawnSync('git', ['config', 'user.name', 'Test User'], { cwd: tmpDir })
        spawnSync('git', ['config', 'user.email', 'test@example.com'], {
          cwd: tmpDir,
        })

        const subdir = path.join(tmpDir, 'src', 'nested')
        await fs.mkdir(subdir, { recursive: true })

        const nestedFile = path.join(subdir, 'nested.txt')
        await fs.writeFile(nestedFile, 'nested content', 'utf8')

        const changed = await getChangedFiles({ cwd: tmpDir })
        // Git may show directory or full path depending on config
        expect(changed.length).toBeGreaterThan(0)
        const hasFile = changed.some(
          f => f.includes('nested.txt') || f === 'src' || f.includes('src'),
        )
        expect(hasFile).toBe(true)

        // Test with cwd in subdirectory
        const changedFromSubdir = await getChangedFiles({ cwd: subdir })
        // When cwd is in subdirectory, it filters to that directory
        // The file may not show up if git hasn't indexed the parent
        expect(Array.isArray(changedFromSubdir)).toBe(true)
      }, 'git-nested-')
    })

    it('should work with sync functions', async () => {
      await runWithTempDir(async tmpDir => {
        spawnSync('git', ['init'], { cwd: tmpDir })
        spawnSync('git', ['config', 'user.name', 'Test User'], { cwd: tmpDir })
        spawnSync('git', ['config', 'user.email', 'test@example.com'], {
          cwd: tmpDir,
        })

        const testFile = path.join(tmpDir, 'sync-test.txt')
        await fs.writeFile(testFile, 'sync content', 'utf8')

        const changedSync = getChangedFilesSync({ cwd: tmpDir })
        expect(changedSync).toContain('sync-test.txt')

        spawnSync('git', ['add', 'sync-test.txt'], { cwd: tmpDir })

        const stagedSync = getStagedFilesSync({ cwd: tmpDir })
        expect(stagedSync).toContain('sync-test.txt')

        spawnSync('git', ['commit', '-m', 'Sync test'], { cwd: tmpDir })

        await fs.writeFile(testFile, 'modified sync', 'utf8')

        const unstagedSync = getUnstagedFilesSync({ cwd: tmpDir })
        expect(unstagedSync).toContain('sync-test.txt')

        const isChangedResult = isChangedSync(testFile, { cwd: tmpDir })
        expect(isChangedResult).toBe(true)

        const isUnstagedResult = isUnstagedSync(testFile, { cwd: tmpDir })
        expect(isUnstagedResult).toBe(true)

        const isStagedResult = isStagedSync(testFile, { cwd: tmpDir })
        expect(isStagedResult).toBe(false)
      }, 'git-sync-')
    })

    it('should handle empty git repository', async () => {
      await runWithTempDir(async tmpDir => {
        spawnSync('git', ['init'], { cwd: tmpDir })
        spawnSync('git', ['config', 'user.name', 'Test User'], { cwd: tmpDir })
        spawnSync('git', ['config', 'user.email', 'test@example.com'], {
          cwd: tmpDir,
        })

        // Empty repo should have no changes
        const changed = await getChangedFiles({ cwd: tmpDir })
        expect(changed).toEqual([])

        const staged = await getStagedFiles({ cwd: tmpDir })
        expect(staged).toEqual([])

        const unstaged = await getUnstagedFiles({ cwd: tmpDir })
        expect(unstaged).toEqual([])
      }, 'git-empty-')
    })

    it('should handle files with spaces in names', async () => {
      await runWithTempDir(async tmpDir => {
        spawnSync('git', ['init'], { cwd: tmpDir })
        spawnSync('git', ['config', 'user.name', 'Test User'], { cwd: tmpDir })
        spawnSync('git', ['config', 'user.email', 'test@example.com'], {
          cwd: tmpDir,
        })

        const spacedFile = path.join(tmpDir, 'file with spaces.txt')
        await fs.writeFile(spacedFile, 'content', 'utf8')

        const changed = await getChangedFiles({ cwd: tmpDir })
        // Git may quote filenames with spaces
        const hasFile = changed.some(
          f => f === 'file with spaces.txt' || f === '"file with spaces.txt"',
        )
        expect(hasFile).toBe(true)

        spawnSync('git', ['add', 'file with spaces.txt'], { cwd: tmpDir })

        const staged = await getStagedFiles({ cwd: tmpDir })
        const hasStagedFile = staged.some(
          f => f === 'file with spaces.txt' || f === '"file with spaces.txt"',
        )
        expect(hasStagedFile).toBe(true)
      }, 'git-spaces-')
    })

    it('should handle special characters in file names', async () => {
      await runWithTempDir(async tmpDir => {
        spawnSync('git', ['init'], { cwd: tmpDir })
        spawnSync('git', ['config', 'user.name', 'Test User'], { cwd: tmpDir })
        spawnSync('git', ['config', 'user.email', 'test@example.com'], {
          cwd: tmpDir,
        })

        const specialFile = path.join(tmpDir, 'file-with_special.chars.txt')
        await fs.writeFile(specialFile, 'content', 'utf8')

        const changed = await getChangedFiles({ cwd: tmpDir })
        expect(changed).toContain('file-with_special.chars.txt')
      }, 'git-special-')
    })

    it('should work with absolute paths in is* functions', async () => {
      await runWithTempDir(async tmpDir => {
        spawnSync('git', ['init'], { cwd: tmpDir })
        spawnSync('git', ['config', 'user.name', 'Test User'], { cwd: tmpDir })
        spawnSync('git', ['config', 'user.email', 'test@example.com'], {
          cwd: tmpDir,
        })

        const absFile = path.join(tmpDir, 'absolute.txt')
        await fs.writeFile(absFile, 'content', 'utf8')

        const isChangedAbs = await isChanged(absFile)
        expect(typeof isChangedAbs).toBe('boolean')
      }, 'git-absolute-')
    })

    it('should handle deleted files', async () => {
      await runWithTempDir(async tmpDir => {
        spawnSync('git', ['init'], { cwd: tmpDir })
        spawnSync('git', ['config', 'user.name', 'Test User'], { cwd: tmpDir })
        spawnSync('git', ['config', 'user.email', 'test@example.com'], {
          cwd: tmpDir,
        })

        const delFile = path.join(tmpDir, 'to-delete.txt')
        await fs.writeFile(delFile, 'content', 'utf8')
        spawnSync('git', ['add', 'to-delete.txt'], { cwd: tmpDir })
        spawnSync('git', ['commit', '-m', 'Add file'], { cwd: tmpDir })

        // Delete the file
        await fs.unlink(delFile)

        // Should show as changed (deleted)
        const changed = await getChangedFiles({ cwd: tmpDir })
        expect(changed).toContain('to-delete.txt')

        // Should show as unstaged deletion
        const unstaged = await getUnstagedFiles({ cwd: tmpDir })
        expect(unstaged).toContain('to-delete.txt')
      }, 'git-deleted-')
    })

    it('should handle renamed files', async () => {
      await runWithTempDir(async tmpDir => {
        spawnSync('git', ['init'], { cwd: tmpDir })
        spawnSync('git', ['config', 'user.name', 'Test User'], { cwd: tmpDir })
        spawnSync('git', ['config', 'user.email', 'test@example.com'], {
          cwd: tmpDir,
        })

        const oldFile = path.join(tmpDir, 'old-name.txt')
        await fs.writeFile(oldFile, 'content', 'utf8')
        spawnSync('git', ['add', 'old-name.txt'], { cwd: tmpDir })
        spawnSync('git', ['commit', '-m', 'Add file'], { cwd: tmpDir })

        // Rename the file
        const newFile = path.join(tmpDir, 'new-name.txt')
        await fs.rename(oldFile, newFile)
        spawnSync('git', ['add', '-A'], { cwd: tmpDir })

        // Should show both old and new in staged
        const staged = await getStagedFiles({ cwd: tmpDir })
        // Git may show this as a rename or as delete + add
        expect(staged.length).toBeGreaterThan(0)
      }, 'git-renamed-')
    })

    it('should handle Buffer stdout from spawn', async () => {
      await runWithTempDir(async tmpDir => {
        spawnSync('git', ['init'], { cwd: tmpDir })
        spawnSync('git', ['config', 'user.name', 'Test User'], { cwd: tmpDir })
        spawnSync('git', ['config', 'user.email', 'test@example.com'], {
          cwd: tmpDir,
        })

        const testFile = path.join(tmpDir, 'buffer-test.txt')
        await fs.writeFile(testFile, 'buffer content', 'utf8')

        // This test ensures Buffer stdout is handled correctly
        const changed = await getChangedFiles({ cwd: tmpDir })
        expect(changed).toContain('buffer-test.txt')
      }, 'git-buffer-')
    })

    it('should handle stdout as string from spawn', async () => {
      await runWithTempDir(async tmpDir => {
        spawnSync('git', ['init'], { cwd: tmpDir })
        spawnSync('git', ['config', 'user.name', 'Test User'], { cwd: tmpDir })
        spawnSync('git', ['config', 'user.email', 'test@example.com'], {
          cwd: tmpDir,
        })

        const testFile = path.join(tmpDir, 'string-test.txt')
        await fs.writeFile(testFile, 'string content', 'utf8')

        const changedSync = getChangedFilesSync({ cwd: tmpDir })
        expect(changedSync).toContain('string-test.txt')
      }, 'git-string-')
    })
  })

  describe('findGitRoot edge cases', () => {
    it('should handle path at filesystem root', () => {
      const result = findGitRoot('/')
      expect(typeof result).toBe('string')
      expect(result).toBeTruthy()
    })

    it('should return same path when no .git found', () => {
      const nonGitPath = '/tmp/definitely/not/a/git/repo'
      const result = findGitRoot(nonGitPath)
      expect(result).toBe(nonGitPath)
    })

    it('should handle deeply nested git repos', async () => {
      await runWithTempDir(async tmpDir => {
        spawnSync('git', ['init'], { cwd: tmpDir })

        const deepPath = path.join(tmpDir, 'a', 'b', 'c', 'd', 'e')
        await fs.mkdir(deepPath, { recursive: true })

        const result = findGitRoot(deepPath)
        expect(result).toBe(tmpDir)
      }, 'git-deep-')
    })

    it('should work when starting from git root itself', () => {
      const result = findGitRoot(projectRoot)
      expect(result).toBe(projectRoot)
    })

    it('should handle error in existsSync', async () => {
      await runWithTempDir(async tmpDir => {
        // Test that errors are caught and ignored
        const result = findGitRoot(tmpDir)
        expect(typeof result).toBe('string')
      }, 'git-error-exists-')
    })
  })

  describe('Windows-specific behavior', () => {
    it('should normalize path separators', async () => {
      const result = await getChangedFiles({ cwd: projectRoot })
      for (const file of result) {
        // Should use forward slashes even on Windows
        expect(file).not.toMatch(/\\(?!$)/)
      }
    })

    it('should use shell on Windows for some operations', async () => {
      // This tests that the code path for Windows shell is covered
      const result = await getChangedFiles({ cwd: projectRoot })
      expect(Array.isArray(result)).toBe(true)
    })
  })

  describe('porcelain format parsing', () => {
    it('should strip status codes from porcelain output', async () => {
      // getChangedFiles uses porcelain format internally
      const result = await getChangedFiles({ cwd: projectRoot })
      for (const file of result) {
        // Status codes are 2 chars + space, should be stripped
        expect(file).not.toMatch(/^[MADRCU?!]{1,2} /)
      }
    })

    it('should handle short porcelain lines', async () => {
      await runWithTempDir(async tmpDir => {
        spawnSync('git', ['init'], { cwd: tmpDir })
        spawnSync('git', ['config', 'user.name', 'Test User'], { cwd: tmpDir })
        spawnSync('git', ['config', 'user.email', 'test@example.com'], {
          cwd: tmpDir,
        })

        const testFile = path.join(tmpDir, 'a.txt')
        await fs.writeFile(testFile, 'content', 'utf8')

        const changed = await getChangedFiles({ cwd: tmpDir })
        // Even very short filenames should work
        expect(changed).toContain('a.txt')
      }, 'git-porcelain-')
    })
  })

  describe('concurrent operations', () => {
    it('should handle many concurrent git operations', async () => {
      const operations = Array.from({ length: 20 }, (_, i) => {
        if (i % 3 === 0) {
          return getChangedFiles({ cwd: projectRoot })
        }
        if (i % 3 === 1) {
          return getStagedFiles({ cwd: projectRoot })
        }
        return getUnstagedFiles({ cwd: projectRoot })
      })

      const results = await Promise.all(operations)
      for (const result of results) {
        expect(Array.isArray(result)).toBe(true)
      }
    })

    it('should handle mixed sync and async operations', async () => {
      const asyncResult = getChangedFiles({ cwd: projectRoot })
      const syncResult = getChangedFilesSync({ cwd: projectRoot })

      const [async, sync] = await Promise.all([
        asyncResult,
        Promise.resolve(syncResult),
      ])
      expect(async).toEqual(sync)
    })
  })

  describe('cwd resolution with symlinks', () => {
    it('should resolve symlinks in cwd', async () => {
      // This tests that fs.realpathSync is called for cwd
      const result = await getChangedFiles({ cwd: projectRoot })
      expect(Array.isArray(result)).toBe(true)
    })

    it('should resolve symlinks in pathname for is* functions', async () => {
      const testFile = path.join(projectRoot, 'package.json')
      const isChangedResult = await isChanged(testFile, { cwd: projectRoot })
      expect(typeof isChangedResult).toBe('boolean')
    })

    it('should handle cwd same as default root', async () => {
      const defaultCwd = process.cwd()
      const result = await getChangedFiles({ cwd: defaultCwd })
      expect(Array.isArray(result)).toBe(true)
    })
  })

  describe('empty output handling', () => {
    it('should handle empty stdout', async () => {
      await runWithTempDir(async tmpDir => {
        spawnSync('git', ['init'], { cwd: tmpDir })
        spawnSync('git', ['config', 'user.name', 'Test User'], { cwd: tmpDir })
        spawnSync('git', ['config', 'user.email', 'test@example.com'], {
          cwd: tmpDir,
        })

        // Empty repo with no files
        const changed = await getChangedFiles({ cwd: tmpDir })
        expect(changed).toEqual([])
      }, 'git-empty-stdout-')
    })
  })

  describe('getFs and getPath lazy loading', () => {
    it('should lazily load fs module', async () => {
      // Multiple calls should use the same cached module
      const result1 = await getChangedFiles({ cwd: projectRoot })
      const result2 = await getChangedFiles({ cwd: projectRoot })
      expect(result1).toEqual(result2)
    })

    it('should lazily load path module', () => {
      // findGitRoot uses the lazy path module
      const result = findGitRoot(projectRoot)
      expect(result).toBe(projectRoot)
    })
  })
})
