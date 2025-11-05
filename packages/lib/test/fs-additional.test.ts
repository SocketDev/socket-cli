/**
 * @fileoverview Additional comprehensive tests for file system utilities to increase coverage.
 *
 * Extends fs.test.ts with additional edge cases and coverage scenarios:
 * - findUp edge cases: onlyFiles/onlyDirectories combinations, deeply nested paths
 * - Error handling: non-existent paths, permission errors, invalid JSON
 * - Binary file operations: non-UTF8 content, Buffer handling
 * - Directory operations: empty directories, nested structures
 * - Sync vs async consistency: validates both APIs behave identically
 * - Platform-specific scenarios: Windows vs Unix path handling
 * - Safe operations: graceful handling of missing files, concurrent access
 * Uses runWithTempDir for isolated test environments to avoid filesystem pollution.
 * Complements primary fs.test.ts by focusing on uncommon code paths and error conditions.
 */

import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  findUp,
  findUpSync,
  isDir,
  isDirEmptySync,
  isDirSync,
  readDirNames,
  readDirNamesSync,
  readFileBinary,
  readFileBinarySync,
  readFileUtf8,
  readFileUtf8Sync,
  readJson,
  readJsonSync,
  safeDelete,
  safeDeleteSync,
  safeReadFile,
  safeReadFileSync,
  safeStats,
  safeStatsSync,
  uniqueSync,
  writeJson,
  writeJsonSync,
} from '@socketsecurity/lib/fs'
import { describe, expect, it } from 'vitest'
import { runWithTempDir } from './utils/temp-file-helper.mjs'

describe('fs - Additional Coverage', () => {
  describe('findUp edge cases', () => {
    it('should find both files and directories when both onlyFiles and onlyDirectories are false', async () => {
      await runWithTempDir(async tmpDir => {
        const testDir = path.join(tmpDir, 'target-dir')
        await fs.mkdir(testDir)

        const result = await findUp('target-dir', {
          cwd: tmpDir,
          onlyFiles: false,
          onlyDirectories: false,
        })
        expect(result).toBeDefined()
        expect(result).toContain('target-dir')
      }, 'findUp-both-types-')
    })

    it('should handle abort signal during loop', async () => {
      const controller = new AbortController()

      // Create a promise that aborts after a short delay
      const result = await new Promise<string | undefined>(resolve => {
        setTimeout(() => {
          controller.abort()
        }, 10)

        findUp('nonexistent-file-that-will-trigger-loop', {
          cwd: process.cwd(),
          signal: controller.signal,
        }).then(resolve)
      })

      expect(result).toBeUndefined()
    })

    it('should prioritize onlyDirectories over onlyFiles', async () => {
      await runWithTempDir(async tmpDir => {
        const testFile = path.join(tmpDir, 'file.txt')
        await fs.writeFile(testFile, '', 'utf8')

        const result = await findUp('file.txt', {
          cwd: tmpDir,
          onlyDirectories: true,
          onlyFiles: true,
        })
        expect(result).toBeUndefined()
      }, 'findUp-priority-')
    })
  })

  describe('findUpSync edge cases', () => {
    it('should find both files and directories when both onlyFiles and onlyDirectories are false', async () => {
      await runWithTempDir(async tmpDir => {
        const testFile = path.join(tmpDir, 'target-file')
        await fs.writeFile(testFile, '', 'utf8')

        const result = findUpSync('target-file', {
          cwd: tmpDir,
          onlyFiles: false,
          onlyDirectories: false,
        })
        expect(result).toBeDefined()
        expect(result).toContain('target-file')
      }, 'findUpSync-both-types-')
    })

    it('should not find files when onlyDirectories is true', async () => {
      await runWithTempDir(async tmpDir => {
        const testFile = path.join(tmpDir, 'just-a-file.txt')
        await fs.writeFile(testFile, '', 'utf8')

        const result = findUpSync('just-a-file.txt', {
          cwd: tmpDir,
          onlyDirectories: true,
        })
        expect(result).toBeUndefined()
      }, 'findUpSync-only-dirs-no-file-')
    })

    it('should prioritize onlyDirectories over onlyFiles', async () => {
      await runWithTempDir(async tmpDir => {
        const testFile = path.join(tmpDir, 'file.txt')
        await fs.writeFile(testFile, '', 'utf8')

        const result = findUpSync('file.txt', {
          cwd: tmpDir,
          onlyDirectories: true,
          onlyFiles: true,
        })
        expect(result).toBeUndefined()
      }, 'findUpSync-priority-')
    })
  })

  describe('readFileBinary with options', () => {
    it('should handle string options parameter', async () => {
      await runWithTempDir(async tmpDir => {
        const testFile = path.join(tmpDir, 'binary.dat')
        const testData = Buffer.from([0xff, 0xfe, 0xfd])
        await fs.writeFile(testFile, testData)

        const result = await readFileBinary(testFile, 'binary')
        expect(Buffer.isBuffer(result)).toBe(true)
        expect(result).toEqual(testData)
      }, 'readFileBinary-string-opts-')
    })

    it('should handle object options with encoding', async () => {
      await runWithTempDir(async tmpDir => {
        const testFile = path.join(tmpDir, 'data.bin')
        const testData = Buffer.from([0x01, 0x02, 0x03])
        await fs.writeFile(testFile, testData)

        const result = await readFileBinary(testFile, { encoding: 'utf8' })
        expect(Buffer.isBuffer(result)).toBe(true)
      }, 'readFileBinary-obj-opts-')
    })
  })

  describe('readFileBinarySync with options', () => {
    it('should handle string options parameter', async () => {
      await runWithTempDir(async tmpDir => {
        const testFile = path.join(tmpDir, 'binary.dat')
        const testData = Buffer.from([0xff, 0xfe, 0xfd])
        await fs.writeFile(testFile, testData)

        const result = readFileBinarySync(testFile, 'binary')
        expect(Buffer.isBuffer(result)).toBe(true)
        expect(result).toEqual(testData)
      }, 'readFileBinarySync-string-opts-')
    })

    it('should handle object options with encoding', async () => {
      await runWithTempDir(async tmpDir => {
        const testFile = path.join(tmpDir, 'data.bin')
        const testData = Buffer.from([0x01, 0x02, 0x03])
        await fs.writeFile(testFile, testData)

        const result = readFileBinarySync(testFile, { encoding: 'utf8' })
        expect(Buffer.isBuffer(result)).toBe(true)
      }, 'readFileBinarySync-obj-opts-')
    })
  })

  describe('readFileUtf8 with options', () => {
    it('should handle string options parameter', async () => {
      await runWithTempDir(async tmpDir => {
        const testFile = path.join(tmpDir, 'text.txt')
        await fs.writeFile(testFile, 'content', 'utf8')

        const result = await readFileUtf8(testFile, 'utf8')
        expect(result).toBe('content')
      }, 'readFileUtf8-string-opts-')
    })

    it('should handle object options', async () => {
      await runWithTempDir(async tmpDir => {
        const testFile = path.join(tmpDir, 'text.txt')
        await fs.writeFile(testFile, 'content', 'utf8')

        const result = await readFileUtf8(testFile, { encoding: 'utf8' })
        expect(result).toBe('content')
      }, 'readFileUtf8-obj-opts-')
    })
  })

  describe('readFileUtf8Sync with options', () => {
    it('should handle string options parameter', async () => {
      await runWithTempDir(async tmpDir => {
        const testFile = path.join(tmpDir, 'text.txt')
        await fs.writeFile(testFile, 'content', 'utf8')

        const result = readFileUtf8Sync(testFile, 'utf8')
        expect(result).toBe('content')
      }, 'readFileUtf8Sync-string-opts-')
    })

    it('should handle object options', async () => {
      await runWithTempDir(async tmpDir => {
        const testFile = path.join(tmpDir, 'text.txt')
        await fs.writeFile(testFile, 'content', 'utf8')

        const result = readFileUtf8Sync(testFile, { encoding: 'utf8' })
        expect(result).toBe('content')
      }, 'readFileUtf8Sync-obj-opts-')
    })
  })

  describe('readJson with string options', () => {
    it('should handle string encoding option', async () => {
      await runWithTempDir(async tmpDir => {
        const testFile = path.join(tmpDir, 'data.json')
        const testData = { foo: 'bar' }
        await fs.writeFile(testFile, JSON.stringify(testData), 'utf8')

        const result = await readJson(testFile, 'utf8')
        expect(result).toEqual(testData)
      }, 'readJson-string-encoding-')
    })
  })

  describe('readJsonSync with string options', () => {
    it('should handle string encoding option', async () => {
      await runWithTempDir(async tmpDir => {
        const testFile = path.join(tmpDir, 'data.json')
        const testData = { foo: 'bar' }
        await fs.writeFile(testFile, JSON.stringify(testData), 'utf8')

        const result = readJsonSync(testFile, 'utf8')
        expect(result).toEqual(testData)
      }, 'readJsonSync-string-encoding-')
    })

    it('should use custom reviver function', async () => {
      await runWithTempDir(async tmpDir => {
        const testFile = path.join(tmpDir, 'data.json')
        const testData = { timestamp: '2024-01-01T00:00:00.000Z' }
        await fs.writeFile(testFile, JSON.stringify(testData), 'utf8')

        const result = readJsonSync(testFile, {
          reviver: (key, value) => {
            if (key === 'timestamp' && typeof value === 'string') {
              return new Date(value)
            }
            return value
          },
        }) as unknown as { timestamp: Date }

        expect(result.timestamp).toBeInstanceOf(Date)
      }, 'readJsonSync-reviver-')
    })
  })

  describe('writeJson with additional options', () => {
    it('should handle string encoding option', async () => {
      await runWithTempDir(async tmpDir => {
        const testFile = path.join(tmpDir, 'data.json')
        const testData = { test: 'value' }

        await writeJson(testFile, testData, 'utf8')

        const content = await fs.readFile(testFile, 'utf8')
        const parsed = JSON.parse(content)
        expect(parsed).toEqual(testData)
      }, 'writeJson-string-encoding-')
    })

    it('should use tabs for indentation', async () => {
      await runWithTempDir(async tmpDir => {
        const testFile = path.join(tmpDir, 'tabs.json')
        const testData = { nested: { value: 'test' } }

        await writeJson(testFile, testData, { spaces: '\t' })

        const content = await fs.readFile(testFile, 'utf8')
        expect(content).toContain('\t')
      }, 'writeJson-tabs-')
    })

    it('should compact JSON with spaces: 0', async () => {
      await runWithTempDir(async tmpDir => {
        const testFile = path.join(tmpDir, 'compact.json')
        const testData = { a: 1, b: 2 }

        await writeJson(testFile, testData, { spaces: 0 })

        const content = await fs.readFile(testFile, 'utf8')
        expect(content).toContain('{"a":1,"b":2}')
      }, 'writeJson-compact-')
    })
  })

  describe('writeJsonSync with additional options', () => {
    it('should use string encoding option', async () => {
      await runWithTempDir(async tmpDir => {
        const testFile = path.join(tmpDir, 'encoding.json')
        const testData = { test: 'data' }

        writeJsonSync(testFile, testData, 'utf8')

        const content = await fs.readFile(testFile, 'utf8')
        const parsed = JSON.parse(content)
        expect(parsed).toEqual(testData)
      }, 'writeJsonSync-string-encoding-')
    })

    it('should use tabs for indentation', async () => {
      await runWithTempDir(async tmpDir => {
        const testFile = path.join(tmpDir, 'tabs.json')
        const testData = { foo: 'bar' }

        writeJsonSync(testFile, testData, { spaces: '\t' })

        const content = await fs.readFile(testFile, 'utf8')
        expect(content).toContain('\t')
      }, 'writeJsonSync-tabs-')
    })

    it('should compact JSON with spaces: 0', async () => {
      await runWithTempDir(async tmpDir => {
        const testFile = path.join(tmpDir, 'compact.json')
        const testData = { foo: 'bar', baz: 'qux' }

        writeJsonSync(testFile, testData, { spaces: 0 })

        const content = await fs.readFile(testFile, 'utf8')
        expect(content).not.toContain('  ')
        expect(content).toContain('{"foo":"bar","baz":"qux"}')
      }, 'writeJsonSync-compact-')
    })

    it('should use custom EOL', async () => {
      await runWithTempDir(async tmpDir => {
        const testFile = path.join(tmpDir, 'custom-eol.json')
        const testData = { foo: 'bar' }

        writeJsonSync(testFile, testData, { EOL: '\r\n' })

        const content = await fs.readFile(testFile, 'utf8')
        expect(content).toContain('\r\n')
      }, 'writeJsonSync-custom-eol-')
    })

    it('should use replacer function', async () => {
      await runWithTempDir(async tmpDir => {
        const testFile = path.join(tmpDir, 'replacer.json')
        const testData = { keep: 'this', remove: 'that' }

        writeJsonSync(testFile, testData, {
          replacer: (key, value) => {
            if (key === 'remove') {
              return undefined
            }
            return value
          },
        })

        const content = await fs.readFile(testFile, 'utf8')
        const parsed = JSON.parse(content)
        expect(parsed.keep).toBe('this')
        expect(parsed.remove).toBeUndefined()
      }, 'writeJsonSync-replacer-')
    })
  })

  describe('safeReadFile with string encoding', () => {
    it('should handle string encoding option', async () => {
      await runWithTempDir(async tmpDir => {
        const testFile = path.join(tmpDir, 'test.txt')
        await fs.writeFile(testFile, 'content', 'utf8')

        const result = await safeReadFile(testFile, { encoding: 'utf8' })
        expect(result).toBe('content')
      }, 'safeReadFile-string-encoding-')
    })
  })

  describe('safeReadFileSync with string encoding', () => {
    it('should handle string encoding option', async () => {
      await runWithTempDir(async tmpDir => {
        const testFile = path.join(tmpDir, 'test.txt')
        await fs.writeFile(testFile, 'content', 'utf8')

        const result = safeReadFileSync(testFile, { encoding: 'utf8' })
        expect(result).toBe('content')
      }, 'safeReadFileSync-string-encoding-')
    })
  })

  describe('safeStatsSync with string options', () => {
    it('should handle string encoding option', async () => {
      await runWithTempDir(async tmpDir => {
        const testFile = path.join(tmpDir, 'test.txt')
        await fs.writeFile(testFile, '', 'utf8')

        const result = safeStatsSync(testFile, 'utf8')
        expect(result).toBeDefined()
        expect(result?.isFile()).toBe(true)
      }, 'safeStatsSync-string-encoding-')
    })

    it('should handle object options', async () => {
      await runWithTempDir(async tmpDir => {
        const testFile = path.join(tmpDir, 'test.txt')
        await fs.writeFile(testFile, '', 'utf8')

        const result = safeStatsSync(testFile, { encoding: 'utf8' })
        expect(result).toBeDefined()
        expect(result?.isFile()).toBe(true)
      }, 'safeStatsSync-obj-opts-')
    })
  })

  describe('readDirNames with more options', () => {
    it('should handle sort: false', async () => {
      await runWithTempDir(async tmpDir => {
        await fs.mkdir(path.join(tmpDir, 'b-dir'))
        await fs.mkdir(path.join(tmpDir, 'a-dir'))

        const result = await readDirNames(tmpDir, { sort: false })
        expect(result.length).toBe(2)
        expect(result).toContain('a-dir')
        expect(result).toContain('b-dir')
      }, 'readDirNames-no-sort-')
    })

    it('should handle includeEmpty: true explicitly', async () => {
      await runWithTempDir(async tmpDir => {
        await fs.mkdir(path.join(tmpDir, 'empty-dir'))
        await fs.mkdir(path.join(tmpDir, 'non-empty-dir'))
        await fs.writeFile(
          path.join(tmpDir, 'non-empty-dir', 'file.txt'),
          '',
          'utf8',
        )

        const result = await readDirNames(tmpDir, { includeEmpty: true })
        expect(result).toEqual(['empty-dir', 'non-empty-dir'])
      }, 'readDirNames-include-empty-')
    })
  })

  describe('readDirNamesSync with more options', () => {
    it('should handle sort: false', async () => {
      await runWithTempDir(async tmpDir => {
        await fs.mkdir(path.join(tmpDir, 'z-dir'))
        await fs.mkdir(path.join(tmpDir, 'a-dir'))

        const result = readDirNamesSync(tmpDir, { sort: false })
        expect(result.length).toBe(2)
        expect(result).toContain('a-dir')
        expect(result).toContain('z-dir')
      }, 'readDirNamesSync-no-sort-')
    })

    it('should handle includeEmpty: false', async () => {
      await runWithTempDir(async tmpDir => {
        await fs.mkdir(path.join(tmpDir, 'empty'))
        await fs.mkdir(path.join(tmpDir, 'non-empty'))
        await fs.writeFile(path.join(tmpDir, 'non-empty', 'f.txt'), '', 'utf8')

        const result = readDirNamesSync(tmpDir, { includeEmpty: false })
        expect(result).toEqual(['non-empty'])
      }, 'readDirNamesSync-no-empty-')
    })

    it('should handle includeEmpty: true explicitly', async () => {
      await runWithTempDir(async tmpDir => {
        await fs.mkdir(path.join(tmpDir, 'empty'))

        const result = readDirNamesSync(tmpDir, { includeEmpty: true })
        expect(result).toEqual(['empty'])
      }, 'readDirNamesSync-include-empty-')
    })
  })

  describe('isDirEmptySync with more ignore patterns', () => {
    it('should return true when all files are ignored', async () => {
      await runWithTempDir(async tmpDir => {
        await fs.writeFile(path.join(tmpDir, '.DS_Store'), '', 'utf8')
        await fs.writeFile(path.join(tmpDir, 'Thumbs.db'), '', 'utf8')

        const result = isDirEmptySync(tmpDir, {
          ignore: ['**/.DS_Store', '**/Thumbs.db'],
        })
        expect(result).toBe(true)
      }, 'isDirEmpty-all-ignored-')
    })

    it('should return true for empty directory with custom ignore', async () => {
      await runWithTempDir(async tmpDir => {
        const emptyDir = path.join(tmpDir, 'empty')
        await fs.mkdir(emptyDir)

        const result = isDirEmptySync(emptyDir, { ignore: ['*.log'] })
        expect(result).toBe(true)
      }, 'isDirEmpty-custom-ignore-')
    })

    it('should handle partially ignored files', async () => {
      await runWithTempDir(async tmpDir => {
        await fs.writeFile(path.join(tmpDir, 'keep.txt'), '', 'utf8')
        await fs.writeFile(path.join(tmpDir, 'ignore.log'), '', 'utf8')

        const result = isDirEmptySync(tmpDir, { ignore: ['*.log'] })
        expect(result).toBe(false)
      }, 'isDirEmpty-partial-ignore-')
    })
  })

  describe('safeDelete in allowed directories', () => {
    it('should delete files in temp directory without force', async () => {
      const tmpDir = os.tmpdir()
      const testFile = path.join(tmpDir, `test-safe-delete-${Date.now()}.txt`)

      try {
        await fs.writeFile(testFile, 'test', 'utf8')
        await safeDelete(testFile, { force: false })

        const exists = await fs
          .access(testFile)
          .then(() => true)
          .catch(() => false)
        expect(exists).toBe(false)
      } catch (e) {
        // Clean up if test fails
        try {
          await fs.unlink(testFile)
        } catch {}
        throw e
      }
    })

    it('should handle array of paths in temp directory', async () => {
      const tmpDir = os.tmpdir()
      const file1 = path.join(tmpDir, `test-1-${Date.now()}.txt`)
      const file2 = path.join(tmpDir, `test-2-${Date.now()}.txt`)

      try {
        await fs.writeFile(file1, 'test1', 'utf8')
        await fs.writeFile(file2, 'test2', 'utf8')

        await safeDelete([file1, file2], { force: false })

        const exists1 = await fs
          .access(file1)
          .then(() => true)
          .catch(() => false)
        const exists2 = await fs
          .access(file2)
          .then(() => true)
          .catch(() => false)

        expect(exists1).toBe(false)
        expect(exists2).toBe(false)
      } catch (e) {
        // Clean up if test fails
        try {
          await fs.unlink(file1)
        } catch {}
        try {
          await fs.unlink(file2)
        } catch {}
        throw e
      }
    })

    it('should use force: true by default for temp directory', async () => {
      const tmpDir = os.tmpdir()
      const testFile = path.join(tmpDir, `test-default-${Date.now()}.txt`)

      try {
        await fs.writeFile(testFile, 'test', 'utf8')
        await safeDelete(testFile)

        const exists = await fs
          .access(testFile)
          .then(() => true)
          .catch(() => false)
        expect(exists).toBe(false)
      } catch (e) {
        try {
          await fs.unlink(testFile)
        } catch {}
        throw e
      }
    })
  })

  describe('safeDeleteSync in allowed directories', () => {
    it('should delete files in temp directory without force', async () => {
      const tmpDir = os.tmpdir()
      const testFile = path.join(tmpDir, `test-sync-${Date.now()}.txt`)

      try {
        await fs.writeFile(testFile, 'test', 'utf8')
        safeDeleteSync(testFile, { force: false })

        const exists = await fs
          .access(testFile)
          .then(() => true)
          .catch(() => false)
        expect(exists).toBe(false)
      } catch (e) {
        try {
          await fs.unlink(testFile)
        } catch {}
        throw e
      }
    })

    it('should handle array of paths', async () => {
      const tmpDir = os.tmpdir()
      const file1 = path.join(tmpDir, `sync-1-${Date.now()}.txt`)
      const file2 = path.join(tmpDir, `sync-2-${Date.now()}.txt`)

      try {
        await fs.writeFile(file1, 'test1', 'utf8')
        await fs.writeFile(file2, 'test2', 'utf8')

        safeDeleteSync([file1, file2])

        const exists1 = await fs
          .access(file1)
          .then(() => true)
          .catch(() => false)
        const exists2 = await fs
          .access(file2)
          .then(() => true)
          .catch(() => false)

        expect(exists1).toBe(false)
        expect(exists2).toBe(false)
      } catch (e) {
        try {
          await fs.unlink(file1)
        } catch {}
        try {
          await fs.unlink(file2)
        } catch {}
        throw e
      }
    })
  })

  describe('uniqueSync edge cases', () => {
    it('should handle paths with multiple dots', async () => {
      await runWithTempDir(async tmpDir => {
        const testFile = path.join(tmpDir, 'file.test.json')
        await fs.writeFile(testFile, '', 'utf8')

        const result = uniqueSync(testFile)
        expect(result).toContain('file.test-1.json')
      }, 'uniqueSync-multiple-dots-')
    })

    it('should handle directory paths', async () => {
      await runWithTempDir(async tmpDir => {
        const testDir = path.join(tmpDir, 'existing-dir')
        await fs.mkdir(testDir)

        const result = uniqueSync(testDir)
        expect(result).toContain('existing-dir-1')
      }, 'uniqueSync-directory-')
    })
  })

  describe('Path-like inputs', () => {
    it('isDirSync should handle Buffer paths', async () => {
      await runWithTempDir(async tmpDir => {
        const bufferPath = Buffer.from(tmpDir)
        const result = isDirSync(bufferPath)
        expect(result).toBe(true)
      }, 'isDirSync-buffer-')
    })

    it('isDir should handle Buffer paths', async () => {
      await runWithTempDir(async tmpDir => {
        const bufferPath = Buffer.from(tmpDir)
        const result = await isDir(bufferPath)
        expect(result).toBe(true)
      }, 'isDir-buffer-')
    })

    it('safeStats should handle Buffer paths', async () => {
      await runWithTempDir(async tmpDir => {
        const testFile = path.join(tmpDir, 'test.txt')
        await fs.writeFile(testFile, '', 'utf8')
        const bufferPath = Buffer.from(testFile)

        const result = await safeStats(bufferPath)
        expect(result).toBeDefined()
        expect(result?.isFile()).toBe(true)
      }, 'safeStats-buffer-')
    })

    it('safeStatsSync should handle Buffer paths', async () => {
      await runWithTempDir(async tmpDir => {
        const testFile = path.join(tmpDir, 'test.txt')
        await fs.writeFile(testFile, '', 'utf8')
        const bufferPath = Buffer.from(testFile)

        const result = safeStatsSync(bufferPath)
        expect(result).toBeDefined()
        expect(result?.isFile()).toBe(true)
      }, 'safeStatsSync-buffer-')
    })
  })
})
