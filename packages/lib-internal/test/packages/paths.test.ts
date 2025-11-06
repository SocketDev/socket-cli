/**
 * @fileoverview Unit tests for package.json path resolution utilities.
 *
 * Tests path resolution utilities for package.json files:
 * - resolvePackageJsonPath() converts directories to package.json paths
 * - resolvePackageJsonDirname() extracts directory from package.json paths
 * - Normalization and cross-platform path handling
 * - Support for scoped packages, node_modules, and monorepo workspaces
 * Used by Socket tools for package.json file discovery and path manipulation.
 */

import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  resolvePackageJsonDirname,
  resolvePackageJsonPath,
} from '@socketsecurity/lib/packages/paths'

describe('packages/paths', () => {
  describe('resolvePackageJsonDirname', () => {
    it('should export resolvePackageJsonDirname function', () => {
      expect(typeof resolvePackageJsonDirname).toBe('function')
    })

    it('should extract directory from package.json path', () => {
      const result = resolvePackageJsonDirname('/path/to/project/package.json')
      expect(result).toBe('/path/to/project')
    })

    it('should return directory as-is if not ending with package.json', () => {
      const result = resolvePackageJsonDirname('/path/to/project')
      expect(result).toBe('/path/to/project')
    })

    it('should handle root directory package.json', () => {
      const result = resolvePackageJsonDirname('/package.json')
      expect(result).toBe('/')
    })

    it('should handle nested package.json paths', () => {
      const result = resolvePackageJsonDirname(
        '/path/to/deep/nested/project/package.json',
      )
      expect(result).toBe('/path/to/deep/nested/project')
    })

    it('should handle current directory package.json', () => {
      const result = resolvePackageJsonDirname('./package.json')
      expect(result).toBe('.')
    })

    it('should handle parent directory package.json', () => {
      const result = resolvePackageJsonDirname('../package.json')
      expect(result).toBe('..')
    })

    it('should handle paths without package.json', () => {
      const result = resolvePackageJsonDirname('/path/to/some/directory')
      expect(result).toBe('/path/to/some/directory')
    })

    it('should handle paths with package.json in the middle', () => {
      const result = resolvePackageJsonDirname('/path/package.json/other')
      expect(result).toBe('/path/package.json/other')
    })

    it('should be case-sensitive for package.json', () => {
      const result = resolvePackageJsonDirname('/path/to/Package.json')
      expect(result).toBe('/path/to/Package.json')
    })

    it('should handle Windows-style paths', () => {
      const result = resolvePackageJsonDirname('C:\\path\\to\\project\\package.json')
      // Normalize for cross-platform comparison
      const expected = path.dirname('C:\\path\\to\\project\\package.json')
      expect(result).toBe(expected.replace(/\\/g, '/'))
    })

    it('should handle empty string', () => {
      const result = resolvePackageJsonDirname('')
      // Empty string is normalized to '.' (current directory)
      expect(result).toBe('.')
    })

    it('should normalize paths', () => {
      const result = resolvePackageJsonDirname('/path/to/../project/package.json')
      expect(result).toBe('/path/project')
    })

    it('should handle paths with trailing slashes', () => {
      const result = resolvePackageJsonDirname('/path/to/project/')
      expect(result).toBe('/path/to/project')
    })

    it('should handle single directory name', () => {
      const result = resolvePackageJsonDirname('project')
      expect(result).toBe('project')
    })

    it('should handle paths with spaces', () => {
      const result = resolvePackageJsonDirname('/path/to/my project/package.json')
      expect(result).toBe('/path/to/my project')
    })

    it('should handle paths with special characters', () => {
      const result = resolvePackageJsonDirname('/path/@scope/pkg/package.json')
      expect(result).toBe('/path/@scope/pkg')
    })

    it('should handle paths ending with /package.json', () => {
      const result = resolvePackageJsonDirname('node_modules/lodash/package.json')
      expect(result).toBe('node_modules/lodash')
    })
  })

  describe('resolvePackageJsonPath', () => {
    it('should export resolvePackageJsonPath function', () => {
      expect(typeof resolvePackageJsonPath).toBe('function')
    })

    it('should return path as-is if already ends with package.json', () => {
      const result = resolvePackageJsonPath('/path/to/project/package.json')
      expect(result).toBe('/path/to/project/package.json')
    })

    it('should append package.json to directory path', () => {
      const result = resolvePackageJsonPath('/path/to/project')
      expect(result).toBe('/path/to/project/package.json')
    })

    it('should handle root directory', () => {
      const result = resolvePackageJsonPath('/')
      expect(result).toBe('/package.json')
    })

    it('should handle current directory', () => {
      const result = resolvePackageJsonPath('.')
      // normalizePath normalizes '.' to remove './' prefix
      expect(result).toBe('package.json')
    })

    it('should handle parent directory', () => {
      const result = resolvePackageJsonPath('..')
      expect(result).toBe('../package.json')
    })

    it('should handle nested directories', () => {
      const result = resolvePackageJsonPath('/path/to/deep/nested/project')
      expect(result).toBe('/path/to/deep/nested/project/package.json')
    })

    it('should handle relative paths', () => {
      const result = resolvePackageJsonPath('./some/path')
      // normalizePath normalizes paths to remove './' prefix
      expect(result).toBe('some/path/package.json')
    })

    it('should handle Windows-style paths', () => {
      const result = resolvePackageJsonPath('C:\\path\\to\\project')
      // Normalize for cross-platform comparison
      const expected = path.join('C:\\path\\to\\project', 'package.json')
      expect(result).toBe(expected.replace(/\\/g, '/'))
    })

    it('should handle paths with trailing slashes', () => {
      const result = resolvePackageJsonPath('/path/to/project/')
      expect(result).toBe('/path/to/project/package.json')
    })

    it('should handle empty string', () => {
      const result = resolvePackageJsonPath('')
      // path.join('', 'package.json') returns 'package.json'
      expect(result).toBe('package.json')
    })

    it('should handle single directory name', () => {
      const result = resolvePackageJsonPath('project')
      expect(result).toBe('project/package.json')
    })

    it('should handle paths with spaces', () => {
      const result = resolvePackageJsonPath('/path/to/my project')
      expect(result).toBe('/path/to/my project/package.json')
    })

    it('should handle paths with special characters', () => {
      const result = resolvePackageJsonPath('/path/@scope/pkg')
      expect(result).toBe('/path/@scope/pkg/package.json')
    })

    it('should handle node_modules paths', () => {
      const result = resolvePackageJsonPath('node_modules/lodash')
      expect(result).toBe('node_modules/lodash/package.json')
    })

    it('should normalize paths', () => {
      const result = resolvePackageJsonPath('/path/to/../project')
      expect(result).toBe('/path/project/package.json')
    })

    it('should handle paths with package.json in the middle', () => {
      const result = resolvePackageJsonPath('/path/package.json/other')
      expect(result).toBe('/path/package.json/other/package.json')
    })

    it('should be case-sensitive for package.json', () => {
      const result = resolvePackageJsonPath('/path/to/Package.json')
      expect(result).toBe('/path/to/Package.json/package.json')
    })

    it('should handle scoped package paths', () => {
      const result = resolvePackageJsonPath('node_modules/@babel/core')
      expect(result).toBe('node_modules/@babel/core/package.json')
    })
  })

  describe('integration', () => {
    it('should work together to resolve and extract paths', () => {
      const dir = '/path/to/project'
      const pkgJsonPath = resolvePackageJsonPath(dir)
      expect(pkgJsonPath).toBe('/path/to/project/package.json')

      const extractedDir = resolvePackageJsonDirname(pkgJsonPath)
      expect(extractedDir).toBe(dir)
    })

    it('should handle round-trip with nested paths', () => {
      const dir = '/path/to/deep/nested/project'
      const pkgJsonPath = resolvePackageJsonPath(dir)
      const extractedDir = resolvePackageJsonDirname(pkgJsonPath)
      expect(extractedDir).toBe(dir)
    })

    it('should handle idempotent calls', () => {
      const path1 = '/path/to/project/package.json'
      const path2 = resolvePackageJsonPath(path1)
      expect(path2).toBe(path1)

      const dir1 = '/path/to/project'
      const dir2 = resolvePackageJsonDirname(dir1)
      expect(dir2).toBe(dir1)
    })

    it('should handle conversion from directory to path and back', () => {
      const originalDir = 'node_modules/@types/node'
      const pkgJsonPath = resolvePackageJsonPath(originalDir)
      expect(pkgJsonPath).toBe('node_modules/@types/node/package.json')

      const extractedDir = resolvePackageJsonDirname(pkgJsonPath)
      expect(extractedDir).toBe(originalDir)
    })

    it('should handle root directory conversions', () => {
      const rootDir = '/'
      const pkgJsonPath = resolvePackageJsonPath(rootDir)
      expect(pkgJsonPath).toBe('/package.json')

      const extractedDir = resolvePackageJsonDirname(pkgJsonPath)
      expect(extractedDir).toBe(rootDir)
    })

    it('should handle relative path conversions', () => {
      const relativeDir = './project'
      const pkgJsonPath = resolvePackageJsonPath(relativeDir)
      // normalizePath removes './' prefix
      expect(pkgJsonPath).toBe('project/package.json')

      const extractedDir = resolvePackageJsonDirname(pkgJsonPath)
      // normalizePath normalizes to 'project' (without './' prefix)
      expect(extractedDir).toBe('project')
    })
  })

  describe('edge cases', () => {
    it('should handle multiple slashes', () => {
      const result1 = resolvePackageJsonDirname('/path//to///project/package.json')
      expect(result1).toBe('/path/to/project')

      const result2 = resolvePackageJsonPath('/path//to///project')
      expect(result2).toBe('/path/to/project/package.json')
    })

    it('should handle dot segments in paths', () => {
      const result1 = resolvePackageJsonDirname('/path/./to/./project/package.json')
      expect(result1).toBe('/path/to/project')

      const result2 = resolvePackageJsonPath('/path/./to/./project')
      expect(result2).toBe('/path/to/project/package.json')
    })

    it('should handle parent directory references', () => {
      const result1 = resolvePackageJsonDirname('/path/to/../project/package.json')
      expect(result1).toBe('/path/project')

      const result2 = resolvePackageJsonPath('/path/to/../project')
      expect(result2).toBe('/path/project/package.json')
    })

    it('should handle very long paths', () => {
      const longPath = '/' + 'a/'.repeat(100) + 'package.json'
      const result1 = resolvePackageJsonDirname(longPath)
      expect(result1.endsWith('a')).toBe(true)

      const longDir = '/' + 'b/'.repeat(100) + 'dir'
      const result2 = resolvePackageJsonPath(longDir)
      expect(result2.endsWith('/dir/package.json')).toBe(true)
    })

    it('should handle paths with Unicode characters', () => {
      const result1 = resolvePackageJsonDirname('/path/to/项目/package.json')
      expect(result1).toBe('/path/to/项目')

      const result2 = resolvePackageJsonPath('/path/to/项目')
      expect(result2).toBe('/path/to/项目/package.json')
    })

    it('should handle paths with dots in directory names', () => {
      const result1 = resolvePackageJsonDirname('/path/to/my.project/package.json')
      expect(result1).toBe('/path/to/my.project')

      const result2 = resolvePackageJsonPath('/path/to/my.project')
      expect(result2).toBe('/path/to/my.project/package.json')
    })

    it('should handle package.json as a directory name', () => {
      const result1 = resolvePackageJsonDirname('/path/package.json/subdir')
      expect(result1).toBe('/path/package.json/subdir')

      const result2 = resolvePackageJsonPath('/path/package.json/subdir')
      expect(result2).toBe('/path/package.json/subdir/package.json')
    })
  })

  describe('real-world usage', () => {
    it('should resolve typical project structure paths', () => {
      const projectDir = '/home/user/projects/my-app'
      const pkgJsonPath = resolvePackageJsonPath(projectDir)
      expect(pkgJsonPath).toBe('/home/user/projects/my-app/package.json')

      const dir = resolvePackageJsonDirname(pkgJsonPath)
      expect(dir).toBe(projectDir)
    })

    it('should resolve node_modules package paths', () => {
      const lodashDir = 'node_modules/lodash'
      const pkgJsonPath = resolvePackageJsonPath(lodashDir)
      expect(pkgJsonPath).toBe('node_modules/lodash/package.json')

      const dir = resolvePackageJsonDirname(pkgJsonPath)
      expect(dir).toBe(lodashDir)
    })

    it('should resolve scoped package paths', () => {
      const scopedDir = 'node_modules/@babel/core'
      const pkgJsonPath = resolvePackageJsonPath(scopedDir)
      expect(pkgJsonPath).toBe('node_modules/@babel/core/package.json')

      const dir = resolvePackageJsonDirname(pkgJsonPath)
      expect(dir).toBe(scopedDir)
    })

    it('should resolve monorepo workspace paths', () => {
      const workspaceDir = '/path/to/monorepo/packages/my-package'
      const pkgJsonPath = resolvePackageJsonPath(workspaceDir)
      expect(pkgJsonPath).toBe(
        '/path/to/monorepo/packages/my-package/package.json',
      )

      const dir = resolvePackageJsonDirname(pkgJsonPath)
      expect(dir).toBe(workspaceDir)
    })

    it('should handle nested node_modules', () => {
      const nestedDir = 'node_modules/pkg-a/node_modules/pkg-b'
      const pkgJsonPath = resolvePackageJsonPath(nestedDir)
      expect(pkgJsonPath).toBe(
        'node_modules/pkg-a/node_modules/pkg-b/package.json',
      )

      const dir = resolvePackageJsonDirname(pkgJsonPath)
      expect(dir).toBe(nestedDir)
    })

    it('should handle Socket registry packages', () => {
      const socketDir = 'node_modules/@socketregistry/lodash'
      const pkgJsonPath = resolvePackageJsonPath(socketDir)
      expect(pkgJsonPath).toBe('node_modules/@socketregistry/lodash/package.json')

      const dir = resolvePackageJsonDirname(pkgJsonPath)
      expect(dir).toBe(socketDir)
    })
  })
})
