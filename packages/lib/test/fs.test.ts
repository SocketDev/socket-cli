/**
 * @fileoverview Unit tests for file system utility functions.
 *
 * Tests comprehensive file system operations with both async and sync variants:
 * - File search: findUp(), findUpSync() for locating files up directory tree
 * - Directory operations: isDir(), isDirSync(), isDirEmptySync(), safeMkdir/Sync()
 * - File reading: readFileUtf8/Sync(), readFileBinary/Sync(), safeReadFile/Sync()
 * - JSON operations: readJson/Sync(), writeJson/Sync() with proper encoding
 * - Directory listing: readDirNames/Sync() for directory contents
 * - Safe operations: safeStats/Sync(), safeDelete/Sync() with error handling
 * - Utilities: isSymLinkSync(), uniqueSync(), validateFiles()
 * Tests use temporary directories (runWithTempDir) for isolated filesystem operations.
 * Validates cross-platform behavior, error handling, and edge cases (missing files, permissions).
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import {
  findUp,
  findUpSync,
  isDir,
  isDirEmptySync,
  isDirSync,
  isSymLinkSync,
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
  safeMkdir,
  safeMkdirSync,
  safeReadFile,
  safeReadFileSync,
  safeStats,
  safeStatsSync,
  uniqueSync,
  validateFiles,
  writeJson,
  writeJsonSync,
} from '@socketsecurity/lib/fs'
import { describe, expect, it } from 'vitest'
import { runWithTempDir } from './utils/temp-file-helper.mjs'

describe('fs', () => {
  describe('findUp', () => {
    it('should find file in current directory', async () => {
      await runWithTempDir(async tmpDir => {
        const testFile = path.join(tmpDir, 'package.json')
        await fs.writeFile(testFile, '{}', 'utf8')

        const result = await findUp('package.json', { cwd: tmpDir })
        expect(result).toBeDefined()
        expect(result).toContain('package.json')
      }, 'findUp-current-')
    })

    it('should find file in parent directory', async () => {
      await runWithTempDir(async tmpDir => {
        const testFile = path.join(tmpDir, 'config.json')
        await fs.writeFile(testFile, '{}', 'utf8')

        const subDir = path.join(tmpDir, 'sub', 'nested')
        await fs.mkdir(subDir, { recursive: true })

        const result = await findUp('config.json', { cwd: subDir })
        expect(result).toBeDefined()
        expect(result).toContain('config.json')
      }, 'findUp-parent-')
    })

    it('should find directory when onlyDirectories is true', async () => {
      await runWithTempDir(async tmpDir => {
        const testDir = path.join(tmpDir, 'node_modules')
        await fs.mkdir(testDir, { recursive: true })

        const result = await findUp('node_modules', {
          cwd: tmpDir,
          onlyDirectories: true,
        })
        expect(result).toBeDefined()
        expect(result).toContain('node_modules')
      }, 'findUp-dir-')
    })

    it('should return undefined when file not found', async () => {
      await runWithTempDir(async tmpDir => {
        const result = await findUp('nonexistent.txt', { cwd: tmpDir })
        expect(result).toBeUndefined()
      }, 'findUp-notfound-')
    })

    it('should find first match when given array of names', async () => {
      await runWithTempDir(async tmpDir => {
        const testFile = path.join(tmpDir, 'config.yaml')
        await fs.writeFile(testFile, '', 'utf8')

        const result = await findUp(
          ['config.json', 'config.yaml', 'config.yml'],
          {
            cwd: tmpDir,
          },
        )
        expect(result).toBeDefined()
        expect(result).toContain('config.yaml')
      }, 'findUp-array-')
    })

    it('should respect abort signal', async () => {
      const controller = new AbortController()
      controller.abort()

      const result = await findUp('package.json', {
        cwd: process.cwd(),
        signal: controller.signal,
      })
      expect(result).toBeUndefined()
    })

    it('should not find files when onlyDirectories is true', async () => {
      await runWithTempDir(async tmpDir => {
        const testFile = path.join(tmpDir, 'file.txt')
        await fs.writeFile(testFile, '', 'utf8')

        const result = await findUp('file.txt', {
          cwd: tmpDir,
          onlyDirectories: true,
        })
        expect(result).toBeUndefined()
      }, 'findUp-only-dirs-')
    })
  })

  describe('findUpSync', () => {
    it('should find file in current directory', async () => {
      await runWithTempDir(async tmpDir => {
        const testFile = path.join(tmpDir, 'package.json')
        await fs.writeFile(testFile, '{}', 'utf8')

        const result = findUpSync('package.json', { cwd: tmpDir })
        expect(result).toBeDefined()
        expect(result).toContain('package.json')
      }, 'findUpSync-current-')
    })

    it('should find file in parent directory', async () => {
      await runWithTempDir(async tmpDir => {
        const testFile = path.join(tmpDir, 'config.json')
        await fs.writeFile(testFile, '{}', 'utf8')

        const subDir = path.join(tmpDir, 'sub', 'nested')
        await fs.mkdir(subDir, { recursive: true })

        const result = findUpSync('config.json', { cwd: subDir })
        expect(result).toBeDefined()
        expect(result).toContain('config.json')
      }, 'findUpSync-parent-')
    })

    it('should find directory when onlyDirectories is true', async () => {
      await runWithTempDir(async tmpDir => {
        const testDir = path.join(tmpDir, 'node_modules')
        await fs.mkdir(testDir, { recursive: true })

        const result = findUpSync('node_modules', {
          cwd: tmpDir,
          onlyDirectories: true,
        })
        expect(result).toBeDefined()
        expect(result).toContain('node_modules')
      }, 'findUpSync-dir-')
    })

    it('should return undefined when file not found', async () => {
      await runWithTempDir(async tmpDir => {
        const result = findUpSync('nonexistent.txt', { cwd: tmpDir })
        expect(result).toBeUndefined()
      }, 'findUpSync-notfound-')
    })

    it('should find first match when given array of names', async () => {
      await runWithTempDir(async tmpDir => {
        const testFile = path.join(tmpDir, 'config.yaml')
        await fs.writeFile(testFile, '', 'utf8')

        const result = findUpSync(
          ['config.json', 'config.yaml', 'config.yml'],
          {
            cwd: tmpDir,
          },
        )
        expect(result).toBeDefined()
        expect(result).toContain('config.yaml')
      }, 'findUpSync-array-')
    })

    it('should stop at stopAt directory', async () => {
      await runWithTempDir(async tmpDir => {
        const configFile = path.join(tmpDir, 'config.json')
        await fs.writeFile(configFile, '{}', 'utf8')

        const subDir = path.join(tmpDir, 'sub', 'nested')
        await fs.mkdir(subDir, { recursive: true })

        const midDir = path.join(tmpDir, 'sub')
        const result = findUpSync('config.json', {
          cwd: subDir,
          stopAt: midDir,
        })
        expect(result).toBeUndefined()
      }, 'findUpSync-stopAt-')
    })

    it('should check stopAt directory itself', async () => {
      await runWithTempDir(async tmpDir => {
        const subDir = path.join(tmpDir, 'sub')
        await fs.mkdir(subDir, { recursive: true })

        const configFile = path.join(subDir, 'config.json')
        await fs.writeFile(configFile, '{}', 'utf8')

        const nestedDir = path.join(subDir, 'nested')
        await fs.mkdir(nestedDir, { recursive: true })

        const result = findUpSync('config.json', {
          cwd: nestedDir,
          stopAt: subDir,
        })
        expect(result).toBeDefined()
        expect(result).toContain('config.json')
      }, 'findUpSync-stopAt-check-')
    })
  })

  describe('isDir', () => {
    it('should return true for directories', async () => {
      await runWithTempDir(async tmpDir => {
        const result = await isDir(tmpDir)
        expect(result).toBe(true)
      }, 'isDir-true-')
    })

    it('should return false for files', async () => {
      await runWithTempDir(async tmpDir => {
        const testFile = path.join(tmpDir, 'file.txt')
        await fs.writeFile(testFile, '', 'utf8')

        const result = await isDir(testFile)
        expect(result).toBe(false)
      }, 'isDir-false-file-')
    })

    it('should return false for non-existent paths', async () => {
      const result = await isDir('/nonexistent/path')
      expect(result).toBe(false)
    })
  })

  describe('isDirSync', () => {
    it('should return true for directories', async () => {
      await runWithTempDir(async tmpDir => {
        const result = isDirSync(tmpDir)
        expect(result).toBe(true)
      }, 'isDirSync-true-')
    })

    it('should return false for files', async () => {
      await runWithTempDir(async tmpDir => {
        const testFile = path.join(tmpDir, 'file.txt')
        await fs.writeFile(testFile, '', 'utf8')

        const result = isDirSync(testFile)
        expect(result).toBe(false)
      }, 'isDirSync-false-file-')
    })

    it('should return false for non-existent paths', () => {
      const result = isDirSync('/nonexistent/path')
      expect(result).toBe(false)
    })
  })

  describe('isDirEmptySync', () => {
    it('should return true for empty directories', async () => {
      await runWithTempDir(async tmpDir => {
        const emptyDir = path.join(tmpDir, 'empty')
        await fs.mkdir(emptyDir)

        const result = isDirEmptySync(emptyDir)
        expect(result).toBe(true)
      }, 'isDirEmpty-true-')
    })

    it('should return false for directories with files', async () => {
      await runWithTempDir(async tmpDir => {
        const testFile = path.join(tmpDir, 'file.txt')
        await fs.writeFile(testFile, '', 'utf8')

        const result = isDirEmptySync(tmpDir)
        expect(result).toBe(false)
      }, 'isDirEmpty-false-')
    })

    it('should return false for non-existent directories', () => {
      const result = isDirEmptySync('/nonexistent/path')
      expect(result).toBe(false)
    })

    it('should ignore files matching ignore patterns', async () => {
      await runWithTempDir(async tmpDir => {
        const gitDir = path.join(tmpDir, '.git')
        await fs.mkdir(gitDir)
        const gitSubDir = path.join(gitDir, 'objects')
        await fs.mkdir(gitSubDir)

        const result = isDirEmptySync(tmpDir, {
          ignore: ['.git'],
        })
        expect(result).toBe(true)
      }, 'isDirEmpty-ignore-')
    })

    it('should return false when non-ignored files exist', async () => {
      await runWithTempDir(async tmpDir => {
        const gitDir = path.join(tmpDir, '.git')
        await fs.mkdir(gitDir)
        const gitSubDir = path.join(gitDir, 'objects')
        await fs.mkdir(gitSubDir)

        const readmeFile = path.join(tmpDir, 'README.md')
        await fs.writeFile(readmeFile, '', 'utf8')

        const result = isDirEmptySync(tmpDir, {
          ignore: ['.git'],
        })
        expect(result).toBe(false)
      }, 'isDirEmpty-ignore-mixed-')
    })
  })

  describe('isSymLinkSync', () => {
    it('should return true for symlinks', async () => {
      await runWithTempDir(async tmpDir => {
        const targetFile = path.join(tmpDir, 'target.txt')
        await fs.writeFile(targetFile, '', 'utf8')

        const linkPath = path.join(tmpDir, 'link.txt')
        await fs.symlink(targetFile, linkPath)

        const result = isSymLinkSync(linkPath)
        expect(result).toBe(true)
      }, 'isSymLink-true-')
    })

    it('should return false for regular files', async () => {
      await runWithTempDir(async tmpDir => {
        const testFile = path.join(tmpDir, 'file.txt')
        await fs.writeFile(testFile, '', 'utf8')

        const result = isSymLinkSync(testFile)
        expect(result).toBe(false)
      }, 'isSymLink-false-')
    })

    it('should return false for non-existent paths', () => {
      const result = isSymLinkSync('/nonexistent/path')
      expect(result).toBe(false)
    })
  })

  describe('readDirNames', () => {
    it('should read directory names', async () => {
      await runWithTempDir(async tmpDir => {
        const dir1 = path.join(tmpDir, 'dir1')
        const dir2 = path.join(tmpDir, 'dir2')
        await fs.mkdir(dir1)
        await fs.mkdir(dir2)

        const result = await readDirNames(tmpDir)
        expect(result).toEqual(['dir1', 'dir2'])
      }, 'readDirNames-basic-')
    })

    it('should sort directory names by default', async () => {
      await runWithTempDir(async tmpDir => {
        const dirZ = path.join(tmpDir, 'z-dir')
        const dirA = path.join(tmpDir, 'a-dir')
        const dirM = path.join(tmpDir, 'm-dir')
        await fs.mkdir(dirZ)
        await fs.mkdir(dirA)
        await fs.mkdir(dirM)

        const result = await readDirNames(tmpDir)
        expect(result).toEqual(['a-dir', 'm-dir', 'z-dir'])
      }, 'readDirNames-sorted-')
    })

    it('should not sort when sort option is false', async () => {
      await runWithTempDir(async tmpDir => {
        const dirZ = path.join(tmpDir, 'z-dir')
        const dirA = path.join(tmpDir, 'a-dir')
        await fs.mkdir(dirZ)
        await fs.mkdir(dirA)

        const result = await readDirNames(tmpDir, { sort: false })
        expect(result.length).toBe(2)
        expect(result).toContain('z-dir')
        expect(result).toContain('a-dir')
      }, 'readDirNames-unsorted-')
    })

    it('should exclude files, only return directories', async () => {
      await runWithTempDir(async tmpDir => {
        const dir1 = path.join(tmpDir, 'dir1')
        await fs.mkdir(dir1)

        const file1 = path.join(tmpDir, 'file1.txt')
        await fs.writeFile(file1, '', 'utf8')

        const result = await readDirNames(tmpDir)
        expect(result).toEqual(['dir1'])
      }, 'readDirNames-dirs-only-')
    })

    it('should exclude empty directories when includeEmpty is false', async () => {
      await runWithTempDir(async tmpDir => {
        const emptyDir = path.join(tmpDir, 'empty')
        await fs.mkdir(emptyDir)

        const nonEmptyDir = path.join(tmpDir, 'non-empty')
        await fs.mkdir(nonEmptyDir)
        await fs.writeFile(path.join(nonEmptyDir, 'file.txt'), '', 'utf8')

        const result = await readDirNames(tmpDir, { includeEmpty: false })
        expect(result).toEqual(['non-empty'])
      }, 'readDirNames-no-empty-')
    })

    it('should return empty array for non-existent directory', async () => {
      const result = await readDirNames('/nonexistent/path')
      expect(result).toEqual([])
    })

    it('should use ignore patterns with includeEmpty false', async () => {
      await runWithTempDir(async tmpDir => {
        const emptyDir = path.join(tmpDir, 'empty-dir')
        await fs.mkdir(emptyDir)

        const gitDir = path.join(emptyDir, '.git')
        await fs.mkdir(gitDir)

        const nonEmptyDir = path.join(tmpDir, 'non-empty-dir')
        await fs.mkdir(nonEmptyDir)
        await fs.writeFile(path.join(nonEmptyDir, 'file.txt'), '', 'utf8')

        // With ignore patterns and includeEmpty: false, directories containing only ignored files are excluded
        const result = await readDirNames(tmpDir, {
          ignore: ['.git'],
          includeEmpty: false,
        })
        expect(result).toContain('non-empty-dir')
        expect(result).not.toContain('empty-dir')
      }, 'readDirNames-ignore-')
    })
  })

  describe('readDirNamesSync', () => {
    it('should read directory names', async () => {
      await runWithTempDir(async tmpDir => {
        const dir1 = path.join(tmpDir, 'dir1')
        const dir2 = path.join(tmpDir, 'dir2')
        await fs.mkdir(dir1)
        await fs.mkdir(dir2)

        const result = readDirNamesSync(tmpDir)
        expect(result).toEqual(['dir1', 'dir2'])
      }, 'readDirNamesSync-basic-')
    })

    it('should sort directory names by default', async () => {
      await runWithTempDir(async tmpDir => {
        const dirZ = path.join(tmpDir, 'z-dir')
        const dirA = path.join(tmpDir, 'a-dir')
        const dirM = path.join(tmpDir, 'm-dir')
        await fs.mkdir(dirZ)
        await fs.mkdir(dirA)
        await fs.mkdir(dirM)

        const result = readDirNamesSync(tmpDir)
        expect(result).toEqual(['a-dir', 'm-dir', 'z-dir'])
      }, 'readDirNamesSync-sorted-')
    })

    it('should exclude files, only return directories', async () => {
      await runWithTempDir(async tmpDir => {
        const dir1 = path.join(tmpDir, 'dir1')
        await fs.mkdir(dir1)

        const file1 = path.join(tmpDir, 'file1.txt')
        await fs.writeFile(file1, '', 'utf8')

        const result = readDirNamesSync(tmpDir)
        expect(result).toEqual(['dir1'])
      }, 'readDirNamesSync-dirs-only-')
    })

    it('should return empty array for non-existent directory', () => {
      const result = readDirNamesSync('/nonexistent/path')
      expect(result).toEqual([])
    })
  })

  describe('readFileBinary', () => {
    it('should read file as binary buffer', async () => {
      await runWithTempDir(async tmpDir => {
        const testFile = path.join(tmpDir, 'binary.dat')
        const testData = Buffer.from([0x00, 0x01, 0x02, 0x03])
        await fs.writeFile(testFile, testData)

        const result = await readFileBinary(testFile)
        expect(Buffer.isBuffer(result)).toBe(true)
        expect(result).toEqual(testData)
      }, 'readFileBinary-basic-')
    })

    it('should throw for non-existent files', async () => {
      await expect(readFileBinary('/nonexistent/file.dat')).rejects.toThrow()
    })
  })

  describe('readFileBinarySync', () => {
    it('should read file as binary buffer', async () => {
      await runWithTempDir(async tmpDir => {
        const testFile = path.join(tmpDir, 'binary.dat')
        const testData = Buffer.from([0x00, 0x01, 0x02, 0x03])
        await fs.writeFile(testFile, testData)

        const result = readFileBinarySync(testFile)
        expect(Buffer.isBuffer(result)).toBe(true)
        expect(result).toEqual(testData)
      }, 'readFileBinarySync-basic-')
    })

    it('should throw for non-existent files', () => {
      expect(() => readFileBinarySync('/nonexistent/file.dat')).toThrow()
    })
  })

  describe('readFileUtf8', () => {
    it('should read file as UTF-8 string', async () => {
      await runWithTempDir(async tmpDir => {
        const testFile = path.join(tmpDir, 'text.txt')
        const testContent = 'Hello, World!'
        await fs.writeFile(testFile, testContent, 'utf8')

        const result = await readFileUtf8(testFile)
        expect(result).toBe(testContent)
      }, 'readFileUtf8-basic-')
    })

    it('should handle unicode content', async () => {
      await runWithTempDir(async tmpDir => {
        const testFile = path.join(tmpDir, 'unicode.txt')
        const testContent = 'Hello, 世界! 🌍'
        await fs.writeFile(testFile, testContent, 'utf8')

        const result = await readFileUtf8(testFile)
        expect(result).toBe(testContent)
      }, 'readFileUtf8-unicode-')
    })

    it('should throw for non-existent files', async () => {
      await expect(readFileUtf8('/nonexistent/file.txt')).rejects.toThrow()
    })
  })

  describe('readFileUtf8Sync', () => {
    it('should read file as UTF-8 string', async () => {
      await runWithTempDir(async tmpDir => {
        const testFile = path.join(tmpDir, 'text.txt')
        const testContent = 'Hello, World!'
        await fs.writeFile(testFile, testContent, 'utf8')

        const result = readFileUtf8Sync(testFile)
        expect(result).toBe(testContent)
      }, 'readFileUtf8Sync-basic-')
    })

    it('should handle unicode content', async () => {
      await runWithTempDir(async tmpDir => {
        const testFile = path.join(tmpDir, 'unicode.txt')
        const testContent = 'Hello, 世界! 🌍'
        await fs.writeFile(testFile, testContent, 'utf8')

        const result = readFileUtf8Sync(testFile)
        expect(result).toBe(testContent)
      }, 'readFileUtf8Sync-unicode-')
    })

    it('should throw for non-existent files', () => {
      expect(() => readFileUtf8Sync('/nonexistent/file.txt')).toThrow()
    })
  })

  describe('readJson', () => {
    it('should read and parse JSON file', async () => {
      await runWithTempDir(async tmpDir => {
        const testFile = path.join(tmpDir, 'data.json')
        const testData = { foo: 'bar', count: 42 }
        await fs.writeFile(testFile, JSON.stringify(testData), 'utf8')

        const result = await readJson(testFile)
        expect(result).toEqual(testData)
      }, 'readJson-basic-')
    })

    it('should handle nested JSON objects', async () => {
      await runWithTempDir(async tmpDir => {
        const testFile = path.join(tmpDir, 'nested.json')
        const testData = {
          level1: {
            level2: {
              level3: 'deep',
            },
          },
        }
        await fs.writeFile(testFile, JSON.stringify(testData), 'utf8')

        const result = await readJson(testFile)
        expect(result).toEqual(testData)
      }, 'readJson-nested-')
    })

    it('should throw by default for non-existent files', async () => {
      await expect(readJson('/nonexistent/file.json')).rejects.toThrow()
    })

    it('should return undefined when throws is false and file does not exist', async () => {
      const result = await readJson('/nonexistent/file.json', { throws: false })
      expect(result).toBeUndefined()
    })

    it('should throw by default for invalid JSON', async () => {
      await runWithTempDir(async tmpDir => {
        const testFile = path.join(tmpDir, 'invalid.json')
        await fs.writeFile(testFile, 'not valid json', 'utf8')

        await expect(readJson(testFile)).rejects.toThrow()
      }, 'readJson-invalid-')
    })

    it('should return undefined when throws is false and JSON is invalid', async () => {
      await runWithTempDir(async tmpDir => {
        const testFile = path.join(tmpDir, 'invalid.json')
        await fs.writeFile(testFile, 'not valid json', 'utf8')

        const result = await readJson(testFile, { throws: false })
        expect(result).toBeUndefined()
      }, 'readJson-invalid-no-throw-')
    })

    it('should use custom reviver function', async () => {
      await runWithTempDir(async tmpDir => {
        const testFile = path.join(tmpDir, 'data.json')
        const testData = { date: '2024-01-01T00:00:00.000Z' }
        await fs.writeFile(testFile, JSON.stringify(testData), 'utf8')

        const result = (await readJson(testFile, {
          reviver: (key, value) => {
            if (key === 'date' && typeof value === 'string') {
              return new Date(value)
            }
            return value
          },
        })) as unknown as { date: Date }

        expect(result.date).toBeInstanceOf(Date)
      }, 'readJson-reviver-')
    })
  })

  describe('readJsonSync', () => {
    it('should read and parse JSON file', async () => {
      await runWithTempDir(async tmpDir => {
        const testFile = path.join(tmpDir, 'data.json')
        const testData = { foo: 'bar', count: 42 }
        await fs.writeFile(testFile, JSON.stringify(testData), 'utf8')

        const result = readJsonSync(testFile)
        expect(result).toEqual(testData)
      }, 'readJsonSync-basic-')
    })

    it('should handle nested JSON objects', async () => {
      await runWithTempDir(async tmpDir => {
        const testFile = path.join(tmpDir, 'nested.json')
        const testData = {
          level1: {
            level2: {
              level3: 'deep',
            },
          },
        }
        await fs.writeFile(testFile, JSON.stringify(testData), 'utf8')

        const result = readJsonSync(testFile)
        expect(result).toEqual(testData)
      }, 'readJsonSync-nested-')
    })

    it('should throw by default for non-existent files', () => {
      expect(() => readJsonSync('/nonexistent/file.json')).toThrow()
    })

    it('should return undefined when throws is false and file does not exist', () => {
      const result = readJsonSync('/nonexistent/file.json', { throws: false })
      expect(result).toBeUndefined()
    })

    it('should throw by default for invalid JSON', async () => {
      await runWithTempDir(async tmpDir => {
        const testFile = path.join(tmpDir, 'invalid.json')
        await fs.writeFile(testFile, 'not valid json', 'utf8')

        expect(() => readJsonSync(testFile)).toThrow()
      }, 'readJsonSync-invalid-')
    })

    it('should return undefined when throws is false and JSON is invalid', async () => {
      await runWithTempDir(async tmpDir => {
        const testFile = path.join(tmpDir, 'invalid.json')
        await fs.writeFile(testFile, 'not valid json', 'utf8')

        const result = readJsonSync(testFile, { throws: false })
        expect(result).toBeUndefined()
      }, 'readJsonSync-invalid-no-throw-')
    })
  })

  describe('safeDelete', () => {
    it('should delete files in temp directory', async () => {
      await runWithTempDir(async tmpDir => {
        const testFile = path.join(tmpDir, 'delete-me.txt')
        await fs.writeFile(testFile, '', 'utf8')

        await safeDelete(testFile)

        const exists = await fs
          .access(testFile)
          .then(() => true)
          .catch(() => false)
        expect(exists).toBe(false)
      }, 'safeDelete-file-')
    })

    it('should delete directories recursively in temp directory', async () => {
      await runWithTempDir(async tmpDir => {
        const testDir = path.join(tmpDir, 'delete-dir')
        await fs.mkdir(testDir, { recursive: true })
        await fs.writeFile(path.join(testDir, 'file.txt'), '', 'utf8')

        await safeDelete(testDir)

        const exists = await fs
          .access(testDir)
          .then(() => true)
          .catch(() => false)
        expect(exists).toBe(false)
      }, 'safeDelete-dir-')
    })

    it('should delete multiple files', async () => {
      await runWithTempDir(async tmpDir => {
        const file1 = path.join(tmpDir, 'file1.txt')
        const file2 = path.join(tmpDir, 'file2.txt')
        await fs.writeFile(file1, '', 'utf8')
        await fs.writeFile(file2, '', 'utf8')

        await safeDelete([file1, file2])

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
      }, 'safeDelete-multiple-')
    })

    it('should not throw for non-existent files', async () => {
      await expect(safeDelete('/nonexistent/file.txt')).resolves.toBeUndefined()
    })

    it('should respect force option', async () => {
      await runWithTempDir(async tmpDir => {
        const testFile = path.join(tmpDir, 'file.txt')
        await fs.writeFile(testFile, '', 'utf8')

        await safeDelete(testFile, { force: true })

        const exists = await fs
          .access(testFile)
          .then(() => true)
          .catch(() => false)
        expect(exists).toBe(false)
      }, 'safeDelete-force-')
    })
  })

  describe('safeDeleteSync', () => {
    it('should delete files in temp directory', async () => {
      await runWithTempDir(async tmpDir => {
        const testFile = path.join(tmpDir, 'delete-me.txt')
        await fs.writeFile(testFile, '', 'utf8')

        safeDeleteSync(testFile)

        const exists = await fs
          .access(testFile)
          .then(() => true)
          .catch(() => false)
        expect(exists).toBe(false)
      }, 'safeDeleteSync-file-')
    })

    it('should delete directories recursively in temp directory', async () => {
      await runWithTempDir(async tmpDir => {
        const testDir = path.join(tmpDir, 'delete-dir')
        await fs.mkdir(testDir, { recursive: true })
        await fs.writeFile(path.join(testDir, 'file.txt'), '', 'utf8')

        safeDeleteSync(testDir)

        const exists = await fs
          .access(testDir)
          .then(() => true)
          .catch(() => false)
        expect(exists).toBe(false)
      }, 'safeDeleteSync-dir-')
    })

    it('should delete multiple files', async () => {
      await runWithTempDir(async tmpDir => {
        const file1 = path.join(tmpDir, 'file1.txt')
        const file2 = path.join(tmpDir, 'file2.txt')
        await fs.writeFile(file1, '', 'utf8')
        await fs.writeFile(file2, '', 'utf8')

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
      }, 'safeDeleteSync-multiple-')
    })

    it('should not throw for non-existent files', () => {
      expect(() => safeDeleteSync('/nonexistent/file.txt')).not.toThrow()
    })
  })

  describe('safeReadFile', () => {
    it('should read existing file', async () => {
      await runWithTempDir(async tmpDir => {
        const testFile = path.join(tmpDir, 'test.txt')
        const testContent = 'test content'
        await fs.writeFile(testFile, testContent, 'utf8')

        const result = await safeReadFile(testFile, { encoding: 'utf8' })
        expect(result).toBe(testContent)
      }, 'safeReadFile-exists-')
    })

    it('should return undefined for non-existent files', async () => {
      const result = await safeReadFile('/nonexistent/file.txt')
      expect(result).toBeUndefined()
    })

    it('should read as buffer when no encoding specified', async () => {
      await runWithTempDir(async tmpDir => {
        const testFile = path.join(tmpDir, 'binary.dat')
        const testData = Buffer.from([0x01, 0x02, 0x03])
        await fs.writeFile(testFile, testData)

        const result = await safeReadFile(testFile)
        expect(Buffer.isBuffer(result)).toBe(true)
      }, 'safeReadFile-buffer-')
    })
  })

  describe('safeReadFileSync', () => {
    it('should read existing file', async () => {
      await runWithTempDir(async tmpDir => {
        const testFile = path.join(tmpDir, 'test.txt')
        const testContent = 'test content'
        await fs.writeFile(testFile, testContent, 'utf8')

        const result = safeReadFileSync(testFile, { encoding: 'utf8' })
        expect(result).toBe(testContent)
      }, 'safeReadFileSync-exists-')
    })

    it('should return undefined for non-existent files', () => {
      const result = safeReadFileSync('/nonexistent/file.txt')
      expect(result).toBeUndefined()
    })

    it('should read as buffer when no encoding specified', async () => {
      await runWithTempDir(async tmpDir => {
        const testFile = path.join(tmpDir, 'binary.dat')
        const testData = Buffer.from([0x01, 0x02, 0x03])
        await fs.writeFile(testFile, testData)

        const result = safeReadFileSync(testFile)
        expect(Buffer.isBuffer(result)).toBe(true)
      }, 'safeReadFileSync-buffer-')
    })
  })

  describe('safeStats', () => {
    it('should return stats for existing files', async () => {
      await runWithTempDir(async tmpDir => {
        const testFile = path.join(tmpDir, 'test.txt')
        await fs.writeFile(testFile, '', 'utf8')

        const result = await safeStats(testFile)
        expect(result).toBeDefined()
        expect(result?.isFile()).toBe(true)
      }, 'safeStats-file-')
    })

    it('should return stats for directories', async () => {
      await runWithTempDir(async tmpDir => {
        const result = await safeStats(tmpDir)
        expect(result).toBeDefined()
        expect(result?.isDirectory()).toBe(true)
      }, 'safeStats-dir-')
    })

    it('should return undefined for non-existent paths', async () => {
      const result = await safeStats('/nonexistent/path')
      expect(result).toBeUndefined()
    })
  })

  describe('safeStatsSync', () => {
    it('should return stats for existing files', async () => {
      await runWithTempDir(async tmpDir => {
        const testFile = path.join(tmpDir, 'test.txt')
        await fs.writeFile(testFile, '', 'utf8')

        const result = safeStatsSync(testFile)
        expect(result).toBeDefined()
        expect(result?.isFile()).toBe(true)
      }, 'safeStatsSync-file-')
    })

    it('should return stats for directories', async () => {
      await runWithTempDir(async tmpDir => {
        const result = safeStatsSync(tmpDir)
        expect(result).toBeDefined()
        expect(result?.isDirectory()).toBe(true)
      }, 'safeStatsSync-dir-')
    })

    it('should return undefined for non-existent paths', () => {
      const result = safeStatsSync('/nonexistent/path')
      expect(result).toBeUndefined()
    })
  })

  describe('uniqueSync', () => {
    it('should return same path if file does not exist', async () => {
      await runWithTempDir(async tmpDir => {
        const testFile = path.join(tmpDir, 'unique.txt')

        const result = uniqueSync(testFile)
        expect(result).toContain('unique.txt')
      }, 'uniqueSync-new-')
    })

    it('should add number suffix if file exists', async () => {
      await runWithTempDir(async tmpDir => {
        const testFile = path.join(tmpDir, 'exists.txt')
        await fs.writeFile(testFile, '', 'utf8')

        const result = uniqueSync(testFile)
        expect(result).toContain('exists-1.txt')
      }, 'uniqueSync-exists-')
    })

    it('should increment counter for multiple existing files', async () => {
      await runWithTempDir(async tmpDir => {
        const testFile = path.join(tmpDir, 'file.txt')
        await fs.writeFile(testFile, '', 'utf8')

        const file1 = path.join(tmpDir, 'file-1.txt')
        await fs.writeFile(file1, '', 'utf8')

        const result = uniqueSync(testFile)
        expect(result).toContain('file-2.txt')
      }, 'uniqueSync-increment-')
    })

    it('should preserve file extension', async () => {
      await runWithTempDir(async tmpDir => {
        const testFile = path.join(tmpDir, 'data.json')
        await fs.writeFile(testFile, '', 'utf8')

        const result = uniqueSync(testFile)
        expect(result).toContain('data-1.json')
      }, 'uniqueSync-extension-')
    })

    it('should handle files without extension', async () => {
      await runWithTempDir(async tmpDir => {
        const testFile = path.join(tmpDir, 'README')
        await fs.writeFile(testFile, '', 'utf8')

        const result = uniqueSync(testFile)
        expect(result).toContain('README-1')
      }, 'uniqueSync-no-ext-')
    })
  })

  describe('writeJson', () => {
    it('should write JSON to file', async () => {
      await runWithTempDir(async tmpDir => {
        const testFile = path.join(tmpDir, 'output.json')
        const testData = { foo: 'bar', count: 42 }

        await writeJson(testFile, testData)

        const content = await fs.readFile(testFile, 'utf8')
        const parsed = JSON.parse(content)
        expect(parsed).toEqual(testData)
      }, 'writeJson-basic-')
    })

    it('should format JSON with default spacing', async () => {
      await runWithTempDir(async tmpDir => {
        const testFile = path.join(tmpDir, 'formatted.json')
        const testData = { foo: 'bar' }

        await writeJson(testFile, testData)

        const content = await fs.readFile(testFile, 'utf8')
        expect(content).toContain('  ')
        expect(content).toContain('\n')
      }, 'writeJson-formatted-')
    })

    it('should use custom spacing', async () => {
      await runWithTempDir(async tmpDir => {
        const testFile = path.join(tmpDir, 'custom-spacing.json')
        const testData = { foo: 'bar' }

        await writeJson(testFile, testData, { spaces: 4 })

        const content = await fs.readFile(testFile, 'utf8')
        expect(content).toContain('    ')
      }, 'writeJson-custom-spacing-')
    })

    it('should use custom EOL', async () => {
      await runWithTempDir(async tmpDir => {
        const testFile = path.join(tmpDir, 'custom-eol.json')
        const testData = { foo: 'bar' }

        await writeJson(testFile, testData, { EOL: '\r\n' })

        const content = await fs.readFile(testFile, 'utf8')
        expect(content).toContain('\r\n')
      }, 'writeJson-eol-')
    })

    it('should add final EOL by default', async () => {
      await runWithTempDir(async tmpDir => {
        const testFile = path.join(tmpDir, 'final-eol.json')
        const testData = { foo: 'bar' }

        await writeJson(testFile, testData)

        const content = await fs.readFile(testFile, 'utf8')
        expect(content.endsWith('\n')).toBe(true)
      }, 'writeJson-final-eol-')
    })

    it('should omit final EOL when finalEOL is false', async () => {
      await runWithTempDir(async tmpDir => {
        const testFile = path.join(tmpDir, 'no-final-eol.json')
        const testData = { foo: 'bar' }

        await writeJson(testFile, testData, { finalEOL: false })

        const content = await fs.readFile(testFile, 'utf8')
        expect(content.endsWith('\n')).toBe(false)
      }, 'writeJson-no-final-eol-')
    })

    it('should use custom replacer function', async () => {
      await runWithTempDir(async tmpDir => {
        const testFile = path.join(tmpDir, 'replacer.json')
        const testData = { foo: 'bar', secret: 'hidden' }

        await writeJson(testFile, testData, {
          replacer: (key, value) => {
            if (key === 'secret') {
              return undefined
            }
            return value
          },
        })

        const content = await fs.readFile(testFile, 'utf8')
        const parsed = JSON.parse(content)
        expect(parsed.secret).toBeUndefined()
        expect(parsed.foo).toBe('bar')
      }, 'writeJson-replacer-')
    })
  })

  describe('writeJsonSync', () => {
    it('should write JSON to file', async () => {
      await runWithTempDir(async tmpDir => {
        const testFile = path.join(tmpDir, 'output.json')
        const testData = { foo: 'bar', count: 42 }

        writeJsonSync(testFile, testData)

        const content = await fs.readFile(testFile, 'utf8')
        const parsed = JSON.parse(content)
        expect(parsed).toEqual(testData)
      }, 'writeJsonSync-basic-')
    })

    it('should format JSON with default spacing', async () => {
      await runWithTempDir(async tmpDir => {
        const testFile = path.join(tmpDir, 'formatted.json')
        const testData = { foo: 'bar' }

        writeJsonSync(testFile, testData)

        const content = await fs.readFile(testFile, 'utf8')
        expect(content).toContain('  ')
        expect(content).toContain('\n')
      }, 'writeJsonSync-formatted-')
    })

    it('should use custom spacing', async () => {
      await runWithTempDir(async tmpDir => {
        const testFile = path.join(tmpDir, 'custom-spacing.json')
        const testData = { foo: 'bar' }

        writeJsonSync(testFile, testData, { spaces: 4 })

        const content = await fs.readFile(testFile, 'utf8')
        expect(content).toContain('    ')
      }, 'writeJsonSync-custom-spacing-')
    })

    it('should add final EOL by default', async () => {
      await runWithTempDir(async tmpDir => {
        const testFile = path.join(tmpDir, 'final-eol.json')
        const testData = { foo: 'bar' }

        writeJsonSync(testFile, testData)

        const content = await fs.readFile(testFile, 'utf8')
        expect(content.endsWith('\n')).toBe(true)
      }, 'writeJsonSync-final-eol-')
    })

    it('should omit final EOL when finalEOL is false', async () => {
      await runWithTempDir(async tmpDir => {
        const testFile = path.join(tmpDir, 'no-final-eol.json')
        const testData = { foo: 'bar' }

        writeJsonSync(testFile, testData, { finalEOL: false })

        const content = await fs.readFile(testFile, 'utf8')
        expect(content.endsWith('\n')).toBe(false)
      }, 'writeJsonSync-no-final-eol-')
    })
  })

  describe('validateFiles', () => {
    it('should return all files as valid when all exist and are readable', async () => {
      await runWithTempDir(async tmpDir => {
        const file1 = path.join(tmpDir, 'package.json')
        const file2 = path.join(tmpDir, 'tsconfig.json')
        await fs.writeFile(file1, '{}', 'utf8')
        await fs.writeFile(file2, '{}', 'utf8')

        const { invalidPaths, validPaths } = validateFiles([file1, file2])

        expect(validPaths).toHaveLength(2)
        expect(validPaths).toContain(file1)
        expect(validPaths).toContain(file2)
        expect(invalidPaths).toHaveLength(0)
      }, 'validateFiles-all-valid-')
    })

    it('should return non-existent files as invalid', async () => {
      await runWithTempDir(async tmpDir => {
        const existingFile = path.join(tmpDir, 'exists.json')
        const nonExistentFile = path.join(tmpDir, 'does-not-exist.json')
        await fs.writeFile(existingFile, '{}', 'utf8')

        const { invalidPaths, validPaths } = validateFiles([
          existingFile,
          nonExistentFile,
        ])

        expect(validPaths).toHaveLength(1)
        expect(validPaths).toContain(existingFile)
        expect(invalidPaths).toHaveLength(1)
        expect(invalidPaths).toContain(nonExistentFile)
      }, 'validateFiles-non-existent-')
    })

    it('should return all files as invalid when none exist', async () => {
      await runWithTempDir(async tmpDir => {
        const file1 = path.join(tmpDir, 'missing1.json')
        const file2 = path.join(tmpDir, 'missing2.json')

        const { invalidPaths, validPaths } = validateFiles([file1, file2])

        expect(validPaths).toHaveLength(0)
        expect(invalidPaths).toHaveLength(2)
        expect(invalidPaths).toContain(file1)
        expect(invalidPaths).toContain(file2)
      }, 'validateFiles-all-invalid-')
    })

    it('should handle empty file array', () => {
      const { invalidPaths, validPaths } = validateFiles([])

      expect(validPaths).toHaveLength(0)
      expect(invalidPaths).toHaveLength(0)
    })

    it('should work with readonly arrays', async () => {
      await runWithTempDir(async tmpDir => {
        const file1 = path.join(tmpDir, 'test.json')
        await fs.writeFile(file1, '{}', 'utf8')

        const readonlyArray: readonly string[] = [file1] as const
        const { invalidPaths, validPaths } = validateFiles(readonlyArray)

        expect(validPaths).toHaveLength(1)
        expect(validPaths).toContain(file1)
        expect(invalidPaths).toHaveLength(0)
      }, 'validateFiles-readonly-')
    })

    it('should handle mixed valid and invalid files', async () => {
      await runWithTempDir(async tmpDir => {
        const valid1 = path.join(tmpDir, 'valid1.json')
        const valid2 = path.join(tmpDir, 'valid2.json')
        const invalid1 = path.join(tmpDir, 'invalid1.json')
        const invalid2 = path.join(tmpDir, 'invalid2.json')

        await fs.writeFile(valid1, '{}', 'utf8')
        await fs.writeFile(valid2, '{}', 'utf8')

        const { invalidPaths, validPaths } = validateFiles([
          valid1,
          invalid1,
          valid2,
          invalid2,
        ])

        expect(validPaths).toHaveLength(2)
        expect(validPaths).toContain(valid1)
        expect(validPaths).toContain(valid2)
        expect(invalidPaths).toHaveLength(2)
        expect(invalidPaths).toContain(invalid1)
        expect(invalidPaths).toContain(invalid2)
      }, 'validateFiles-mixed-')
    })

    it('should preserve file order in results', async () => {
      await runWithTempDir(async tmpDir => {
        const file1 = path.join(tmpDir, 'a.json')
        const file2 = path.join(tmpDir, 'b.json')
        const file3 = path.join(tmpDir, 'c.json')
        await fs.writeFile(file1, '{}', 'utf8')
        await fs.writeFile(file2, '{}', 'utf8')
        await fs.writeFile(file3, '{}', 'utf8')

        const { validPaths } = validateFiles([file3, file1, file2])

        expect(validPaths[0]).toBe(file3)
        expect(validPaths[1]).toBe(file1)
        expect(validPaths[2]).toBe(file2)
      }, 'validateFiles-order-')
    })
  })

  describe('safeMkdir', () => {
    it('should create a single directory', async () => {
      await runWithTempDir(async tmpDir => {
        const newDir = path.join(tmpDir, 'test-dir')
        await safeMkdir(newDir)

        const stats = await fs.stat(newDir)
        expect(stats.isDirectory()).toBe(true)
      }, 'safeMkdir-single-')
    })

    it('should create nested directories by default (recursive: true)', async () => {
      await runWithTempDir(async tmpDir => {
        const nestedDir = path.join(tmpDir, 'level1', 'level2', 'level3')
        await safeMkdir(nestedDir)

        const stats = await fs.stat(nestedDir)
        expect(stats.isDirectory()).toBe(true)
      }, 'safeMkdir-nested-')
    })

    it('should not throw when directory already exists', async () => {
      await runWithTempDir(async tmpDir => {
        const newDir = path.join(tmpDir, 'existing')
        await fs.mkdir(newDir)

        await expect(safeMkdir(newDir)).resolves.toBeUndefined()

        const stats = await fs.stat(newDir)
        expect(stats.isDirectory()).toBe(true)
      }, 'safeMkdir-exists-')
    })

    it('should respect recursive: false option', async () => {
      await runWithTempDir(async tmpDir => {
        const nestedDir = path.join(tmpDir, 'level1', 'level2')

        await expect(
          safeMkdir(nestedDir, { recursive: false }),
        ).rejects.toThrow()
      }, 'safeMkdir-no-recursive-')
    })

    it('should create directory with custom mode', async () => {
      await runWithTempDir(async tmpDir => {
        const newDir = path.join(tmpDir, 'custom-mode')
        await safeMkdir(newDir, { mode: 0o755 })

        const stats = await fs.stat(newDir)
        expect(stats.isDirectory()).toBe(true)
      }, 'safeMkdir-mode-')
    })

    it('should throw on permission denied', async () => {
      // Test skipped on Windows as permission handling differs
      if (process.platform === 'win32') {
        return
      }

      await runWithTempDir(async tmpDir => {
        const readonlyDir = path.join(tmpDir, 'readonly')
        await fs.mkdir(readonlyDir, { mode: 0o444 })

        const newDir = path.join(readonlyDir, 'should-fail')
        await expect(safeMkdir(newDir)).rejects.toThrow()
      }, 'safeMkdir-permission-')
    })
  })

  describe('safeMkdirSync', () => {
    it('should create a single directory', async () => {
      await runWithTempDir(async tmpDir => {
        const newDir = path.join(tmpDir, 'test-dir')
        safeMkdirSync(newDir)

        const stats = await fs.stat(newDir)
        expect(stats.isDirectory()).toBe(true)
      }, 'safeMkdirSync-single-')
    })

    it('should create nested directories by default (recursive: true)', async () => {
      await runWithTempDir(async tmpDir => {
        const nestedDir = path.join(tmpDir, 'level1', 'level2', 'level3')
        safeMkdirSync(nestedDir)

        const stats = await fs.stat(nestedDir)
        expect(stats.isDirectory()).toBe(true)
      }, 'safeMkdirSync-nested-')
    })

    it('should not throw when directory already exists', async () => {
      await runWithTempDir(async tmpDir => {
        const newDir = path.join(tmpDir, 'existing')
        await fs.mkdir(newDir)

        expect(() => safeMkdirSync(newDir)).not.toThrow()

        const stats = await fs.stat(newDir)
        expect(stats.isDirectory()).toBe(true)
      }, 'safeMkdirSync-exists-')
    })

    it('should respect recursive: false option', async () => {
      await runWithTempDir(async tmpDir => {
        const nestedDir = path.join(tmpDir, 'level1', 'level2')

        expect(() => safeMkdirSync(nestedDir, { recursive: false })).toThrow()
      }, 'safeMkdirSync-no-recursive-')
    })

    it('should create directory with custom mode', async () => {
      await runWithTempDir(async tmpDir => {
        const newDir = path.join(tmpDir, 'custom-mode')
        safeMkdirSync(newDir, { mode: 0o755 })

        const stats = await fs.stat(newDir)
        expect(stats.isDirectory()).toBe(true)
      }, 'safeMkdirSync-mode-')
    })

    it('should throw on permission denied', async () => {
      // Test skipped on Windows as permission handling differs
      if (process.platform === 'win32') {
        return
      }

      await runWithTempDir(async tmpDir => {
        const readonlyDir = path.join(tmpDir, 'readonly')
        await fs.mkdir(readonlyDir, { mode: 0o444 })

        const newDir = path.join(readonlyDir, 'should-fail')
        expect(() => safeMkdirSync(newDir)).toThrow()
      }, 'safeMkdirSync-permission-')
    })
  })
})
