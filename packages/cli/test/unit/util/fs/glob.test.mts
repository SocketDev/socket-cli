/**
 * Unit tests for glob utilities.
 *
 * Purpose: Tests the glob pattern utilities for file matching.
 *
 * Test Coverage: - getSupportedFilePatterns function -
 * filterBySupportedScanFiles function - createSupportedFilesFilter function -
 * isReportSupportedFile function - pathsToGlobPatterns function.
 *
 * Related Files: - util/fs/glob.mts (implementation)
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
vi.mock('@socketsecurity/lib-stable/fs/inspect', () => ({
  isDirSync: mockIsDirSync,
}))
vi.mock('@socketsecurity/lib-stable/fs/read-file', () => ({
  safeReadFile: vi.fn(),
}))

import {
  createSupportedFilesFilter,
  getSupportedFilePatterns,
  isReportSupportedFile,
  pathsToGlobPatterns,
} from '../../../../src/util/fs/glob.mts'

import type { SocketSdkSuccessResult } from '@socketsecurity/sdk-stable'

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

describe('util/fs/glob', () => {
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
        npm: undefined as unknown,
        python: {
          'requirements.txt': { pattern: 'requirements.txt' },
        },
      })

      expect(patterns).toContain('**/requirements.txt')
      expect(patterns).toHaveLength(1)
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

  describe('ignorePatternToMinimatch', () => {
    it('returns special-cased patterns verbatim with negation prefix preserved', async () => {
      const { ignorePatternToMinimatch } =
        await import('../../../../src/util/fs/glob.mts')
      expect(ignorePatternToMinimatch('')).toBe('')
      expect(ignorePatternToMinimatch('**')).toBe('**')
      expect(ignorePatternToMinimatch('/**')).toBe('/**')
      expect(ignorePatternToMinimatch('!**')).toBe('!**')
    })

    it('prepends **/ for patterns without slashes', async () => {
      const { ignorePatternToMinimatch } =
        await import('../../../../src/util/fs/glob.mts')
      expect(ignorePatternToMinimatch('node_modules')).toBe('**/node_modules')
    })

    it('strips leading slash and treats as project-rooted', async () => {
      const { ignorePatternToMinimatch } =
        await import('../../../../src/util/fs/glob.mts')
      expect(ignorePatternToMinimatch('/dist')).toBe('dist')
    })

    it('appends /* for patterns ending in /**', async () => {
      const { ignorePatternToMinimatch } =
        await import('../../../../src/util/fs/glob.mts')
      expect(ignorePatternToMinimatch('build/**')).toBe('build/**/*')
    })

    it('escapes brace + paren characters from gitignore-literal to minimatch-safe', async () => {
      const { ignorePatternToMinimatch } =
        await import('../../../../src/util/fs/glob.mts')
      // gitignore treats `{a,b}` as literal; minimatch treats it as expansion.
      // Escape so minimatch matches the literal string.
      expect(ignorePatternToMinimatch('src/{a,b}.js')).toContain('\\{')
      expect(ignorePatternToMinimatch('src/(group)')).toContain('\\(')
    })

    it('passes negation prefix through', async () => {
      const { ignorePatternToMinimatch } =
        await import('../../../../src/util/fs/glob.mts')
      expect(ignorePatternToMinimatch('!keep.txt')).toBe('!**/keep.txt')
    })
  })

  describe('workspacePatternToGlobPattern', () => {
    it('returns empty for empty input', async () => {
      const { workspacePatternToGlobPattern } =
        await import('../../../../src/util/fs/glob.mts')
      expect(workspacePatternToGlobPattern('')).toBe('')
    })

    it('appends /*/package.json for trailing-slash workspaces', async () => {
      const { workspacePatternToGlobPattern } =
        await import('../../../../src/util/fs/glob.mts')
      expect(workspacePatternToGlobPattern('packages/')).toBe(
        'packages//*/package.json',
      )
    })

    it('appends /*/**/package.json for /** workspaces', async () => {
      const { workspacePatternToGlobPattern } =
        await import('../../../../src/util/fs/glob.mts')
      expect(workspacePatternToGlobPattern('packages/**')).toBe(
        'packages/**/*/**/package.json',
      )
    })

    it('appends /package.json for plain workspaces', async () => {
      const { workspacePatternToGlobPattern } =
        await import('../../../../src/util/fs/glob.mts')
      expect(workspacePatternToGlobPattern('packages/cli')).toBe(
        'packages/cli/package.json',
      )
    })
  })

  describe('ignoreFileLinesToGlobPatterns', () => {
    it('skips blank and comment lines', async () => {
      const { ignoreFileLinesToGlobPatterns } =
        await import('../../../../src/util/fs/glob.mts')
      const result = ignoreFileLinesToGlobPatterns(
        ['', '# comment', 'node_modules', ''],
        '/repo/.gitignore',
        '/repo',
      )
      expect(result).toEqual(['**/node_modules'])
    })

    it('preserves negation patterns with relative path joined', async () => {
      const { ignoreFileLinesToGlobPatterns } =
        await import('../../../../src/util/fs/glob.mts')
      const result = ignoreFileLinesToGlobPatterns(
        ['!keep'],
        '/repo/sub/.gitignore',
        '/repo',
      )
      // Negation prefix preserved + path scoped to the .gitignore's directory.
      expect(result[0]?.startsWith('!')).toBe(true)
      expect(result[0]).toContain('keep')
    })
  })

  describe('ignoreFileToGlobPatterns', () => {
    it('splits on \\r?\\n and threads through ignoreFileLinesToGlobPatterns', async () => {
      const { ignoreFileToGlobPatterns } =
        await import('../../../../src/util/fs/glob.mts')
      const result = ignoreFileToGlobPatterns(
        '# comment\nnode_modules\r\ndist',
        '/repo/.gitignore',
        '/repo',
      )
      expect(result).toEqual(['**/node_modules', '**/dist'])
    })
  })

  describe('getWorkspaceGlobs', () => {
    it('reads pnpm-workspace.yaml packages list for PNPM agent (lines 49-56)', async () => {
      const { safeReadFile } = vi.mocked(await import('@socketsecurity/lib-stable/fs/read-file'))
      safeReadFile.mockResolvedValueOnce(
        'packages:\n  - "packages/*"\n  - "apps/*"\n',
      )
      const { getWorkspaceGlobs } =
        await import('../../../../src/util/fs/glob.mts')
      const result = await getWorkspaceGlobs('pnpm', '/repo')
      // Workspace patterns are converted to glob form ("packages/*" → "packages/*/").
      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThan(0)
    })

    it('returns empty array when pnpm-workspace.yaml is missing', async () => {
      const { safeReadFile } = vi.mocked(await import('@socketsecurity/lib-stable/fs/read-file'))
      safeReadFile.mockResolvedValueOnce(undefined as unknown)
      const { getWorkspaceGlobs } =
        await import('../../../../src/util/fs/glob.mts')
      const result = await getWorkspaceGlobs('pnpm', '/repo')
      expect(result).toEqual([])
    })

    it('returns empty array when pnpm-workspace.yaml is malformed', async () => {
      const { safeReadFile } = vi.mocked(await import('@socketsecurity/lib-stable/fs/read-file'))
      safeReadFile.mockResolvedValueOnce('this is not :::valid::: yaml{{{')
      const { getWorkspaceGlobs } =
        await import('../../../../src/util/fs/glob.mts')
      const result = await getWorkspaceGlobs('pnpm', '/repo')
      expect(result).toEqual([])
    })
  })

  describe('globWorkspace', () => {
    it('returns empty array when no workspace globs (line 299-300)', async () => {
      const { safeReadFile } = vi.mocked(await import('@socketsecurity/lib-stable/fs/read-file'))
      // pnpm-workspace.yaml missing → empty workspaceGlobs → early-return [].
      safeReadFile.mockResolvedValueOnce(undefined as unknown)
      const { globWorkspace } = await import('../../../../src/util/fs/glob.mts')
      const result = await globWorkspace('pnpm', '/nonexistent/repo')
      expect(result).toEqual([])
    })
  })
})
