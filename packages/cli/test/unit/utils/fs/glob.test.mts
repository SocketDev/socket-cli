/**
 * Unit tests for glob utilities.
 *
 * Purpose:
 * Tests the glob pattern utilities for file matching.
 *
 * Test Coverage:
 * - getSupportedFilePatterns function
 * - filterBySupportedScanFiles function
 * - createSupportedFilesFilter function
 * - isReportSupportedFile function
 * - pathsToGlobPatterns function
 *
 * Related Files:
 * - utils/fs/glob.mts (implementation)
 */

import path from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock homePath.
vi.mock('../../../../src/constants/paths.mts', async importOriginal => {
  const actual = await importOriginal()
  return {
    ...actual,
    homePath: '/Users/testuser',
  }
})

// Mock isDirSync.
const mockIsDirSync = vi.hoisted(() => vi.fn())
vi.mock('@socketsecurity/lib/fs', () => ({
  isDirSync: mockIsDirSync,
  safeReadFile: vi.fn(),
}))

import {
  createSupportedFilesFilter,
  filterBySupportedScanFiles,
  getSupportedFilePatterns,
  isReportSupportedFile,
  pathsToGlobPatterns,
} from '../../../../src/utils/fs/glob.mts'

import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

// Mock supported files data.
const mockSupportedFiles: SocketSdkSuccessResult<'getReportSupportedFiles'>['data'] =
  {
    npm: {
      'package.json': { pattern: 'package.json' },
      'package-lock.json': { pattern: 'package-lock.json' },
    },
    python: {
      'requirements.txt': { pattern: 'requirements.txt' },
      'setup.py': { pattern: 'setup.py' },
    },
  }

describe('utils/fs/glob', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsDirSync.mockReturnValue(false)
  })

  describe('getSupportedFilePatterns', () => {
    it('returns glob patterns for all supported files', () => {
      const patterns = getSupportedFilePatterns(mockSupportedFiles)

      expect(patterns).toContain('**/package.json')
      expect(patterns).toContain('**/package-lock.json')
      expect(patterns).toContain('**/requirements.txt')
      expect(patterns).toContain('**/setup.py')
    })

    it('handles empty supported files', () => {
      const patterns = getSupportedFilePatterns({})

      expect(patterns).toEqual([])
    })

    it('handles undefined ecosystem', () => {
      const patterns = getSupportedFilePatterns({
        npm: undefined as any,
        python: {
          'requirements.txt': { pattern: 'requirements.txt' },
        },
      })

      expect(patterns).toContain('**/requirements.txt')
      expect(patterns).toHaveLength(1)
    })
  })

  describe('filterBySupportedScanFiles', () => {
    it('filters files to only supported ones', () => {
      const filepaths = [
        '/project/package.json',
        '/project/src/index.js',
        '/project/requirements.txt',
        '/project/README.md',
      ]

      const result = filterBySupportedScanFiles(filepaths, mockSupportedFiles)

      expect(result).toContain('/project/package.json')
      expect(result).toContain('/project/requirements.txt')
      expect(result).not.toContain('/project/src/index.js')
      expect(result).not.toContain('/project/README.md')
    })

    it('returns empty array when no files match', () => {
      const filepaths = ['/project/index.js', '/project/style.css']

      const result = filterBySupportedScanFiles(filepaths, mockSupportedFiles)

      expect(result).toEqual([])
    })

    it('handles empty filepath array', () => {
      const result = filterBySupportedScanFiles([], mockSupportedFiles)

      expect(result).toEqual([])
    })
  })

  describe('createSupportedFilesFilter', () => {
    it('creates a filter function', () => {
      const filter = createSupportedFilesFilter(mockSupportedFiles)

      expect(typeof filter).toBe('function')
    })

    it('filter returns true for supported files', () => {
      const filter = createSupportedFilesFilter(mockSupportedFiles)

      expect(filter('/project/package.json')).toBe(true)
      expect(filter('/project/requirements.txt')).toBe(true)
    })

    it('filter returns false for unsupported files', () => {
      const filter = createSupportedFilesFilter(mockSupportedFiles)

      expect(filter('/project/index.js')).toBe(false)
      expect(filter('/project/README.md')).toBe(false)
    })
  })

  describe('isReportSupportedFile', () => {
    it('returns true for supported files', () => {
      expect(
        isReportSupportedFile('/project/package.json', mockSupportedFiles),
      ).toBe(true)
      expect(
        isReportSupportedFile('/project/requirements.txt', mockSupportedFiles),
      ).toBe(true)
    })

    it('returns false for unsupported files', () => {
      expect(
        isReportSupportedFile('/project/index.js', mockSupportedFiles),
      ).toBe(false)
      expect(
        isReportSupportedFile('/project/README.md', mockSupportedFiles),
      ).toBe(false)
    })

    it('works with nested paths', () => {
      expect(
        isReportSupportedFile(
          '/project/subdir/nested/package.json',
          mockSupportedFiles,
        ),
      ).toBe(true)
    })
  })

  describe('pathsToGlobPatterns', () => {
    it('converts current directory to wildcard pattern', () => {
      const result = pathsToGlobPatterns(['.'])
      expect(result).toContain('**/*')
    })

    it('converts ./ to wildcard pattern', () => {
      const result = pathsToGlobPatterns(['./'])
      expect(result).toContain('**/*')
    })

    it('expands tilde to home directory', () => {
      const result = pathsToGlobPatterns(['~/project'])
      expect(result[0]).toContain('/Users/testuser')
    })

    it('expands lone tilde to home directory', () => {
      const result = pathsToGlobPatterns(['~'])
      expect(result[0]).toBe('/Users/testuser')
    })

    it('adds recursive glob for directories', () => {
      mockIsDirSync.mockReturnValue(true)
      const result = pathsToGlobPatterns(['/some/directory'])
      expect(result[0]).toBe('/some/directory/**/*')
    })

    it('keeps file paths as is', () => {
      mockIsDirSync.mockReturnValue(false)
      const result = pathsToGlobPatterns(['/some/file.txt'])
      expect(result[0]).toBe('/some/file.txt')
    })

    it('keeps relative paths as is when not directories', () => {
      mockIsDirSync.mockReturnValue(false)
      const result = pathsToGlobPatterns(['relative/path'], '/cwd')
      // Returns resolvedPath (not absolutePath) for non-directory files.
      expect(result[0]).toBe('relative/path')
    })

    it('handles multiple paths', () => {
      mockIsDirSync.mockReturnValue(false)
      const result = pathsToGlobPatterns(['.', '/absolute/path', '~/home/path'])
      expect(result).toHaveLength(3)
    })
  })
})
