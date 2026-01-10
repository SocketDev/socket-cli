import { existsSync, readdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import mockFs from 'mock-fs'
import { afterEach, describe, expect, it } from 'vitest'

import { normalizePath } from '@socketsecurity/registry/lib/path'

import { NODE_MODULES } from '../constants.mjs'
import {
  createSupportedFilesFilter,
  globWithGitIgnore,
  pathsToGlobPatterns,
} from './glob.mts'

import type FileSystem from 'mock-fs/lib/filesystem'

// Filter functions defined at module scope to satisfy linting rules.
function filterJsonFiles(filepath: string): boolean {
  return filepath.endsWith('.json')
}

function filterTsFiles(filepath: string): boolean {
  return filepath.endsWith('.ts')
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const rootNmPath = path.join(__dirname, '../..', NODE_MODULES)
const mockFixturePath = normalizePath(path.join(__dirname, 'glob-mock'))
const mockNmPath = normalizePath(rootNmPath)

// Remove broken symlinks in node_modules before loading to prevent mock-fs errors.
function cleanupBrokenSymlinks(dirPath: string): void {
  try {
    if (!existsSync(dirPath)) {
      return
    }
    const entries = readdirSync(dirPath, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name)
      try {
        if (entry.isSymbolicLink() && !existsSync(fullPath)) {
          // Symlink exists but target does not, remove it.
          rmSync(fullPath, { force: true })
        } else if (entry.isDirectory()) {
          // Recursively check subdirectories.
          cleanupBrokenSymlinks(fullPath)
        }
      } catch {
        // Ignore errors for individual entries.
      }
    }
  } catch {
    // If we cannot read the directory, skip cleanup.
  }
}

// Clean up broken symlinks before loading node_modules.
cleanupBrokenSymlinks(rootNmPath)

// Load node_modules with error handling for any remaining issues.
const mockedNmCallback = (() => {
  try {
    return mockFs.load(rootNmPath)
  } catch (e) {
    // If loading fails due to broken symlinks or missing files, return empty mock.
    console.warn(
      `Warning: Failed to load node_modules for mock-fs: ${e instanceof Error ? e.message : String(e)}`,
    )
    return {}
  }
})()

function mockTestFs(config: FileSystem.DirectoryItems) {
  return mockFs({
    ...config,
    [mockNmPath]: mockedNmCallback,
  })
}

describe('glob utilities', () => {
  afterEach(() => {
    mockFs.restore()
  })

  describe('globWithGitIgnore()', () => {
    it('should find files matching glob patterns', async () => {
      mockTestFs({
        [`${mockFixturePath}/package.json`]: '{}',
        [`${mockFixturePath}/src/index.ts`]: '',
      })

      const results = await globWithGitIgnore(['**/*.json'], {
        cwd: mockFixturePath,
      })

      expect(results.map(normalizePath)).toEqual([
        `${mockFixturePath}/package.json`,
      ])
    })

    it('should respect .gitignore files', async () => {
      mockTestFs({
        [`${mockFixturePath}/.gitignore`]: 'ignored/**',
        [`${mockFixturePath}/package.json`]: '{}',
        [`${mockFixturePath}/ignored/package.json`]: '{}',
        [`${mockFixturePath}/included/package.json`]: '{}',
      })

      const results = await globWithGitIgnore(['**/*.json'], {
        cwd: mockFixturePath,
      })

      expect(results.map(normalizePath).sort()).toEqual([
        `${mockFixturePath}/included/package.json`,
        `${mockFixturePath}/package.json`,
      ])
    })

    it('should handle negated patterns in .gitignore', async () => {
      mockTestFs({
        [`${mockFixturePath}/.gitignore`]: 'ignored/**\n!ignored/keep.json',
        [`${mockFixturePath}/package.json`]: '{}',
        [`${mockFixturePath}/ignored/excluded.json`]: '{}',
        [`${mockFixturePath}/ignored/keep.json`]: '{}',
      })

      const results = await globWithGitIgnore(['**/*.json'], {
        cwd: mockFixturePath,
      })

      // The negated pattern should allow keep.json to be included.
      expect(results.map(normalizePath).sort()).toEqual([
        `${mockFixturePath}/ignored/keep.json`,
        `${mockFixturePath}/package.json`,
      ])
    })

    it('should apply filter function during streaming to reduce memory', async () => {
      // Create a mock filesystem with many files.
      const files: FileSystem.DirectoryItems = {}
      const fileCount = 100
      for (let i = 0; i < fileCount; i += 1) {
        files[`${mockFixturePath}/file${i}.txt`] = 'content'
        files[`${mockFixturePath}/file${i}.json`] = '{}'
      }
      // Add a gitignore with negated pattern to trigger the streaming path.
      files[`${mockFixturePath}/.gitignore`] = 'temp/\n!temp/keep.json'
      mockTestFs(files)

      const results = await globWithGitIgnore(['**/*'], {
        cwd: mockFixturePath,
        filter: filterJsonFiles,
      })

      // Should only include .json files (100 files).
      expect(results).toHaveLength(fileCount)
      for (const result of results) {
        expect(result.endsWith('.json')).toBe(true)
      }
    })

    it('should apply filter without negated patterns', async () => {
      mockTestFs({
        [`${mockFixturePath}/package.json`]: '{}',
        [`${mockFixturePath}/src/index.ts`]: '',
        [`${mockFixturePath}/src/utils.ts`]: '',
        [`${mockFixturePath}/readme.md`]: '',
      })

      const results = await globWithGitIgnore(['**/*'], {
        cwd: mockFixturePath,
        filter: filterTsFiles,
      })

      expect(results.map(normalizePath).sort()).toEqual([
        `${mockFixturePath}/src/index.ts`,
        `${mockFixturePath}/src/utils.ts`,
      ])
    })

    it('should combine filter with negated gitignore patterns', async () => {
      mockTestFs({
        [`${mockFixturePath}/.gitignore`]: 'build/**\n!build/manifest.json',
        [`${mockFixturePath}/package.json`]: '{}',
        [`${mockFixturePath}/src/index.ts`]: '',
        [`${mockFixturePath}/build/output.js`]: '',
        [`${mockFixturePath}/build/manifest.json`]: '{}',
      })

      const results = await globWithGitIgnore(['**/*'], {
        cwd: mockFixturePath,
        filter: filterJsonFiles,
      })

      // Should include package.json and the negated build/manifest.json, but not build/output.js.
      expect(results.map(normalizePath).sort()).toEqual([
        `${mockFixturePath}/build/manifest.json`,
        `${mockFixturePath}/package.json`,
      ])
    })
  })

  describe('createSupportedFilesFilter()', () => {
    it('should create a filter function matching supported file patterns', () => {
      const supportedFiles = {
        npm: {
          packagejson: { pattern: 'package.json' },
          packagelockjson: { pattern: 'package-lock.json' },
        },
      }

      const filter = createSupportedFilesFilter(supportedFiles)

      expect(filter('/path/to/package.json')).toBe(true)
      expect(filter('/path/to/package-lock.json')).toBe(true)
      expect(filter('/path/to/random.txt')).toBe(false)
      expect(filter('/path/to/nested/package.json')).toBe(true)
    })
  })

  describe('pathsToGlobPatterns()', () => {
    it('should convert "." to "**/*"', () => {
      expect(pathsToGlobPatterns(['.'])).toEqual(['**/*'])
      expect(pathsToGlobPatterns(['./'])).toEqual(['**/*'])
    })

    it('should append "/**/*" to directory paths', () => {
      mockTestFs({
        [`${mockFixturePath}/subdir`]: {
          'file.txt': '',
        },
      })

      // The function checks if path is a directory using isDirSync.
      const result = pathsToGlobPatterns(['subdir'], mockFixturePath)
      expect(result).toEqual(['subdir/**/*'])
    })

    it('should keep file paths unchanged', () => {
      mockTestFs({
        [`${mockFixturePath}/file.txt`]: '',
      })

      const result = pathsToGlobPatterns(['file.txt'], mockFixturePath)
      expect(result).toEqual(['file.txt'])
    })
  })
})
