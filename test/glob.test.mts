import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  createSupportedFilesFilter,
  filterBySupportedScanFiles,
  globWithGitIgnore,
  isReportSupportedFile,
} from '../src/utils/glob.mts'

import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

// Filter function for tests - defined at module scope to satisfy linting.
function packageJsonFilter(p: string): boolean {
  return p.endsWith('package.json')
}

describe('glob', () => {
  const mockSupportedFiles: SocketSdkSuccessResult<'getReportSupportedFiles'>['data'] =
    {
      npm: {
        'package.json': { pattern: 'package.json' },
        'poetry.lock': { pattern: 'poetry.lock' },
      },
    }

  describe('filterBySupportedScanFiles', () => {
    it('should match files in dot directories', () => {
      const filepaths = [
        '.mcp-servers/neo4j/poetry.lock',
        '.hidden/package.json',
        'regular/poetry.lock',
        'node_modules/package.json',
      ]

      const result = filterBySupportedScanFiles(filepaths, mockSupportedFiles)

      expect(result).toEqual([
        '.mcp-servers/neo4j/poetry.lock',
        '.hidden/package.json',
        'regular/poetry.lock',
        'node_modules/package.json',
      ])
    })

    it('should filter out non-matching files', () => {
      const filepaths = [
        '.mcp-servers/neo4j/poetry.lock',
        '.hidden/random.txt',
        'package.json',
        'src/index.ts',
      ]

      const result = filterBySupportedScanFiles(filepaths, mockSupportedFiles)

      expect(result).toEqual(['.mcp-servers/neo4j/poetry.lock', 'package.json'])
    })
  })

  describe('isReportSupportedFile', () => {
    it('should return true for files in dot directories', () => {
      expect(
        isReportSupportedFile(
          '.mcp-servers/neo4j/poetry.lock',
          mockSupportedFiles,
        ),
      ).toBe(true)
      expect(
        isReportSupportedFile('.hidden/package.json', mockSupportedFiles),
      ).toBe(true)
    })

    it('should return true for regular files', () => {
      expect(
        isReportSupportedFile('regular/poetry.lock', mockSupportedFiles),
      ).toBe(true)
      expect(isReportSupportedFile('package.json', mockSupportedFiles)).toBe(
        true,
      )
    })

    it('should return false for non-matching files', () => {
      expect(
        isReportSupportedFile('.hidden/random.txt', mockSupportedFiles),
      ).toBe(false)
      expect(isReportSupportedFile('src/index.ts', mockSupportedFiles)).toBe(
        false,
      )
    })
  })

  describe('createSupportedFilesFilter', () => {
    it('should create a filter function that matches supported files', () => {
      const filter = createSupportedFilesFilter(mockSupportedFiles)

      expect(filter('package.json')).toBe(true)
      expect(filter('poetry.lock')).toBe(true)
      expect(filter('nested/package.json')).toBe(true)
      expect(filter('.hidden/poetry.lock')).toBe(true)
    })

    it('should create a filter function that rejects unsupported files', () => {
      const filter = createSupportedFilesFilter(mockSupportedFiles)

      expect(filter('index.ts')).toBe(false)
      expect(filter('random.txt')).toBe(false)
      expect(filter('src/main.js')).toBe(false)
    })
  })

  describe('globWithGitIgnore', () => {
    const testDir = path.join(process.cwd(), '.test-glob-fixture')

    beforeAll(async () => {
      // Create test directory structure.
      await mkdir(testDir, { recursive: true })
      await mkdir(path.join(testDir, 'pkg1'), { recursive: true })
      await mkdir(path.join(testDir, 'pkg2'), { recursive: true })
      await mkdir(path.join(testDir, 'ignored'), { recursive: true })

      // Create test files.
      await writeFile(path.join(testDir, 'package.json'), '{}')
      await writeFile(path.join(testDir, 'pkg1', 'package.json'), '{}')
      await writeFile(path.join(testDir, 'pkg1', 'index.ts'), '')
      await writeFile(path.join(testDir, 'pkg2', 'package.json'), '{}')
      await writeFile(path.join(testDir, 'pkg2', 'index.ts'), '')
      await writeFile(path.join(testDir, 'ignored', 'package.json'), '{}')
      await writeFile(path.join(testDir, 'random.txt'), '')

      // Create .gitignore with negated pattern.
      await writeFile(
        path.join(testDir, '.gitignore'),
        'ignored/\n!ignored/package.json\n',
      )
    })

    afterAll(async () => {
      // Cleanup test directory.
      await rm(testDir, { recursive: true, force: true })
    })

    it('should apply filter during streaming to reduce memory', async () => {
      const result = await globWithGitIgnore(['**/*'], {
        cwd: testDir,
        filter: packageJsonFilter,
      })

      // Should only return package.json files.
      expect(result.every(p => p.endsWith('package.json'))).toBe(true)
      // Should have found multiple package.json files.
      expect(result.length).toBeGreaterThanOrEqual(3)
    })

    it('should handle negated gitignore patterns', async () => {
      const result = await globWithGitIgnore(['**/*'], {
        cwd: testDir,
      })

      const relativePaths = result.map(p => path.relative(testDir, p))

      // The ignored directory should be excluded.
      expect(relativePaths.some(p => p.startsWith('ignored/'))).toBe(false)
    })

    it('should combine filter with negated patterns', async () => {
      const result = await globWithGitIgnore(['**/*'], {
        cwd: testDir,
        filter: packageJsonFilter,
      })

      const relativePaths = result.map(p => path.relative(testDir, p))

      // Should only return package.json files.
      expect(relativePaths.every(p => p.endsWith('package.json'))).toBe(true)
      // Should NOT include ignored/package.json because the directory is ignored.
      expect(relativePaths).not.toContain('ignored/package.json')
    })

    it('should work without filter (backwards compatibility)', async () => {
      const result = await globWithGitIgnore(['**/*.txt'], {
        cwd: testDir,
      })

      expect(result.length).toBeGreaterThanOrEqual(1)
      expect(result.every(p => p.endsWith('.txt'))).toBe(true)
    })
  })
})
