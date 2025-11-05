/**
 * @fileoverview Unit tests for path manipulation utilities.
 *
 * Tests cross-platform path manipulation and validation:
 * - isNodeModules() detects node_modules in paths (Unix and Windows separators)
 * - isAbsolute() checks for absolute paths (handles both / and C:\ styles)
 * - isRelative() validates relative paths
 * - isPath() validates path-like strings
 * - normalizePath() converts Windows backslashes to forward slashes
 * - pathLikeToString() converts PathLike to string
 * - relativeResolve() resolves paths relative to base directories
 * - splitPath() splits paths into components
 * - trimLeadingDotSlash() removes ./ prefix
 * Tests extensively validate Windows vs Unix path handling, edge cases (empty paths, dots),
 * and proper separation of path segments. Critical for cross-platform file operations.
 */

import {
  isAbsolute,
  isNodeModules,
  isPath,
  isRelative,
  normalizePath,
  pathLikeToString,
  relativeResolve,
  splitPath,
  trimLeadingDotSlash,
} from '@socketsecurity/lib/path'
import { describe, expect, it } from 'vitest'

describe('path utilities', () => {
  describe('isNodeModules', () => {
    it('should detect node_modules in path', () => {
      expect(isNodeModules('/project/node_modules/package')).toBe(true)
      expect(isNodeModules('node_modules/package/index.js')).toBe(true)
      expect(isNodeModules('/a/b/node_modules/c/d')).toBe(true)
      expect(isNodeModules('node_modules')).toBe(true)
    })

    it('should detect node_modules with Windows separators', () => {
      expect(isNodeModules('C:\\project\\node_modules\\package')).toBe(true)
      expect(isNodeModules('node_modules\\package\\index.js')).toBe(true)
    })

    it('should handle node_modules at start of path', () => {
      expect(isNodeModules('node_modules/package')).toBe(true)
      expect(isNodeModules('node_modules')).toBe(true)
    })

    it('should handle node_modules at end of path', () => {
      expect(isNodeModules('/path/to/node_modules')).toBe(true)
      expect(isNodeModules('src/node_modules')).toBe(true)
    })

    it('should not match partial node_modules names', () => {
      expect(isNodeModules('/src/my_node_modules_backup')).toBe(false)
      expect(isNodeModules('/project/node_modules_old/file')).toBe(false)
      expect(isNodeModules('/old_node_modules/file')).toBe(false)
      expect(isNodeModules('notnode_modules')).toBe(false)
    })

    it('should not detect node_modules in regular paths', () => {
      expect(isNodeModules('/project/src/index.js')).toBe(false)
      expect(isNodeModules('/home/user/file.txt')).toBe(false)
      expect(isNodeModules('src/lib/util.js')).toBe(false)
    })

    it('should handle Buffer input', () => {
      expect(isNodeModules(Buffer.from('node_modules/pkg'))).toBe(true)
      expect(isNodeModules(Buffer.from('/src/file.js'))).toBe(false)
    })

    it('should handle URL input', () => {
      expect(isNodeModules(new URL('file:///project/node_modules/pkg'))).toBe(
        true,
      )
      expect(isNodeModules(new URL('file:///project/src/file.js'))).toBe(false)
    })

    it('should handle empty paths', () => {
      expect(isNodeModules('')).toBe(false)
    })
  })

  describe('isAbsolute', () => {
    describe('POSIX paths', () => {
      it('should detect POSIX absolute paths', () => {
        expect(isAbsolute('/home/user')).toBe(true)
        expect(isAbsolute('/usr/bin/node')).toBe(true)
        expect(isAbsolute('/')).toBe(true)
        expect(isAbsolute('/a')).toBe(true)
      })

      it('should detect POSIX relative paths', () => {
        expect(isAbsolute('relative/path')).toBe(false)
        expect(isAbsolute('./relative')).toBe(false)
        expect(isAbsolute('../parent')).toBe(false)
        expect(isAbsolute('.')).toBe(false)
        expect(isAbsolute('..')).toBe(false)
      })
    })

    describe('Windows paths', () => {
      it('should detect Windows drive letter absolute paths', () => {
        // Only on Windows platform
        if (process.platform === 'win32') {
          expect(isAbsolute('C:\\Windows')).toBe(true)
          expect(isAbsolute('D:/data')).toBe(true)
          expect(isAbsolute('c:\\Program Files')).toBe(true)
          expect(isAbsolute('Z:\\path')).toBe(true)
          expect(isAbsolute('a:/file')).toBe(true)
        }
      })

      it('should detect backslash as absolute', () => {
        expect(isAbsolute('\\Windows')).toBe(true)
        expect(isAbsolute('\\')).toBe(true)
      })

      it('should detect UNC paths', () => {
        expect(isAbsolute('\\\\server\\share')).toBe(true)
        expect(isAbsolute('\\\\server\\share\\file')).toBe(true)
        expect(isAbsolute('\\\\?\\C:\\path')).toBe(true)
        expect(isAbsolute('\\\\.\\device')).toBe(true)
      })

      it('should reject relative Windows paths', () => {
        expect(isAbsolute('relative\\path')).toBe(false)
        expect(isAbsolute('.\\relative')).toBe(false)
        expect(isAbsolute('..\\parent')).toBe(false)
      })

      it('should reject paths with colon but no separator', () => {
        expect(isAbsolute('C:')).toBe(false)
        expect(isAbsolute('D:file')).toBe(false)
      })

      it('should reject paths with colon in wrong position', () => {
        expect(isAbsolute(':C\\path')).toBe(false)
        expect(isAbsolute('1C:\\path')).toBe(false)
      })
    })

    describe('Edge cases', () => {
      it('should handle empty path', () => {
        expect(isAbsolute('')).toBe(false)
      })

      it('should handle single character paths', () => {
        expect(isAbsolute('/')).toBe(true)
        expect(isAbsolute('\\')).toBe(true)
        expect(isAbsolute('a')).toBe(false)
        expect(isAbsolute('.')).toBe(false)
      })

      it('should handle two character paths', () => {
        expect(isAbsolute('//')).toBe(true)
        expect(isAbsolute('\\\\')).toBe(true)
        expect(isAbsolute('/a')).toBe(true)
        expect(isAbsolute('ab')).toBe(false)
        expect(isAbsolute('..')).toBe(false)
      })

      it('should handle Buffer input', () => {
        expect(isAbsolute(Buffer.from('/absolute'))).toBe(true)
        expect(isAbsolute(Buffer.from('relative'))).toBe(false)
      })

      it('should handle URL input', () => {
        expect(isAbsolute(new URL('file:///absolute/path'))).toBe(true)
      })
    })
  })

  describe('isPath', () => {
    describe('Valid paths', () => {
      it('should detect absolute paths', () => {
        expect(isPath('/absolute/path')).toBe(true)
        expect(isPath('/home/user')).toBe(true)
        expect(isPath('/')).toBe(true)
      })

      it('should detect relative paths with separators', () => {
        expect(isPath('./relative/path')).toBe(true)
        expect(isPath('../parent/dir')).toBe(true)
        expect(isPath('relative/path')).toBe(true)
        expect(isPath('a/b')).toBe(true)
      })

      it('should detect special relative paths', () => {
        expect(isPath('.')).toBe(true)
        expect(isPath('..')).toBe(true)
      })

      it('should detect paths starting with @ that have subpaths', () => {
        expect(isPath('@scope/name/subpath')).toBe(true)
        expect(isPath('@scope/name/file.js')).toBe(true)
        expect(isPath('@scope/name/a/b/c')).toBe(true)
        expect(isPath('@/path')).toBe(true)
      })

      it('should detect Windows paths', () => {
        if (process.platform === 'win32') {
          expect(isPath('C:\\Windows')).toBe(true)
          expect(isPath('D:/data')).toBe(true)
        }
        expect(isPath('path\\to\\file')).toBe(true)
      })

      it('should detect paths with backslashes', () => {
        expect(isPath('path\\file')).toBe(true)
        expect(isPath('folder\\subfolder\\file')).toBe(true)
      })
    })

    describe('Not paths', () => {
      it('should reject bare package names', () => {
        expect(isPath('lodash')).toBe(false)
        expect(isPath('react')).toBe(false)
        expect(isPath('express')).toBe(false)
      })

      it('should reject scoped package names without subpaths', () => {
        expect(isPath('@scope/package')).toBe(false)
        expect(isPath('@babel/core')).toBe(false)
        expect(isPath('@types/node')).toBe(false)
      })

      it('should reject URLs with protocols', () => {
        expect(isPath('http://example.com')).toBe(false)
        expect(isPath('https://example.com/path')).toBe(false)
        expect(isPath('file://path')).toBe(false)
        expect(isPath('git://github.com/repo')).toBe(false)
        expect(isPath('ftp://server.com')).toBe(false)
        expect(isPath('data:text/plain,hello')).toBe(false)
      })

      it('should reject empty string', () => {
        expect(isPath('')).toBe(false)
      })

      it('should allow Windows drive letters', () => {
        // Windows drive letters are 2 chars before colon, not URLs
        if (process.platform === 'win32') {
          expect(isPath('C:\\path')).toBe(true)
          expect(isPath('D:/path')).toBe(true)
        }
      })
    })

    describe('Edge cases', () => {
      it('should handle Buffer input', () => {
        expect(isPath(Buffer.from('./path'))).toBe(true)
        expect(isPath(Buffer.from('lodash'))).toBe(false)
      })

      it('should handle URL input', () => {
        expect(isPath(new URL('file:///path'))).toBe(true)
      })

      it('should handle protocol-like strings', () => {
        expect(isPath('scheme:value')).toBe(false)
        expect(isPath('http+ssh://url')).toBe(false)
        expect(isPath('git+https://url')).toBe(false)
      })

      it('should handle scoped packages with different slash counts', () => {
        expect(isPath('@scope')).toBe(false)
        expect(isPath('@scope/name')).toBe(false)
        expect(isPath('@scope/name/file')).toBe(true)
        expect(isPath('@scope/name/a/b')).toBe(true)
      })

      it('should handle mixed separators in scoped packages', () => {
        // @scope/name\file has backslash in parts[1], so it's detected as path
        expect(isPath('@scope/name\\file')).toBe(true)
        // @scope\name\file is only 1 part when split by '/', not detected as path
        expect(isPath('@scope\\name\\file')).toBe(false)
      })
    })
  })

  describe('isRelative', () => {
    it('should detect relative paths', () => {
      expect(isRelative('./src/index.js')).toBe(true)
      expect(isRelative('../lib/util.js')).toBe(true)
      expect(isRelative('src/file.js')).toBe(true)
      expect(isRelative('file.js')).toBe(true)
      expect(isRelative('.')).toBe(true)
      expect(isRelative('..')).toBe(true)
    })

    it('should detect empty string as relative', () => {
      expect(isRelative('')).toBe(true)
    })

    it('should detect absolute paths as not relative', () => {
      expect(isRelative('/home/user')).toBe(false)
      expect(isRelative('/')).toBe(false)
      expect(isRelative('\\Windows')).toBe(false)
      expect(isRelative('\\\\')).toBe(false)
    })

    it('should handle Windows drive paths', () => {
      if (process.platform === 'win32') {
        expect(isRelative('C:\\Windows')).toBe(false)
        expect(isRelative('D:/data')).toBe(false)
      }
    })

    it('should handle Buffer input', () => {
      expect(isRelative(Buffer.from('relative'))).toBe(true)
      expect(isRelative(Buffer.from('/absolute'))).toBe(false)
    })

    it('should handle URL input', () => {
      expect(isRelative(new URL('file:///absolute'))).toBe(false)
    })

    it('should handle non-string types', () => {
      // pathLikeToString returns '' for null/undefined, which is relative
      expect(isRelative(null as any)).toBe(true)
      expect(isRelative(undefined as any)).toBe(true)
    })
  })

  describe('normalizePath', () => {
    describe('Basic normalization', () => {
      it('should convert backslashes to forward slashes', () => {
        expect(normalizePath('foo\\bar\\baz')).toBe('foo/bar/baz')
        expect(normalizePath('C:\\Users\\John\\file.txt')).toBe(
          'C:/Users/John/file.txt',
        )
      })

      it('should collapse repeated slashes', () => {
        expect(normalizePath('foo//bar///baz')).toBe('foo/bar/baz')
        expect(normalizePath('foo\\\\bar\\\\\\baz')).toBe('foo/bar/baz')
        expect(normalizePath('///foo///bar///')).toBe('/foo/bar')
      })

      it('should resolve . segments', () => {
        expect(normalizePath('foo/./bar')).toBe('foo/bar')
        expect(normalizePath('./foo/./bar/./baz')).toBe('foo/bar/baz')
        expect(normalizePath('foo/.')).toBe('foo')
      })

      it('should resolve .. segments', () => {
        expect(normalizePath('foo/bar/../baz')).toBe('foo/baz')
        expect(normalizePath('foo/../bar')).toBe('bar')
        expect(normalizePath('foo/bar/baz/../..')).toBe('foo')
      })

      it('should preserve leading .. for relative paths', () => {
        expect(normalizePath('../foo')).toBe('../foo')
        expect(normalizePath('../../foo/bar')).toBe('../../foo/bar')
        expect(normalizePath('../..')).toBe('../..')
      })

      it('should handle .. that go beyond path start', () => {
        expect(normalizePath('foo/../..')).toBe('..')
        expect(normalizePath('foo/bar/../../..')).toBe('..')
        expect(normalizePath('../foo/../..')).toBe('../..')
      })
    })

    describe('Windows paths', () => {
      it('should normalize Windows paths', () => {
        expect(normalizePath('C:\\Windows\\System32')).toBe(
          'C:/Windows/System32',
        )
        expect(normalizePath('D:\\path\\to\\file.txt')).toBe(
          'D:/path/to/file.txt',
        )
      })

      it('should handle UNC paths', () => {
        expect(normalizePath('\\\\server\\share\\file')).toBe(
          '//server/share/file',
        )
        expect(normalizePath('\\\\server\\share\\path\\to\\file')).toBe(
          '//server/share/path/to/file',
        )
        expect(normalizePath('//server/share/file')).toBe('//server/share/file')
      })

      it('should handle Windows namespace prefixes', () => {
        expect(normalizePath('\\\\?\\C:\\path')).toBe('//?/C:/path')
        expect(normalizePath('\\\\.\\device')).toBe('//device')
      })

      it('should handle UNC with repeated slashes', () => {
        expect(normalizePath('\\\\\\server\\share')).toBe('/server/share')
        expect(normalizePath('////server/share')).toBe('/server/share')
      })

      it('should handle invalid UNC paths (no share)', () => {
        expect(normalizePath('\\\\server')).toBe('/server')
        expect(normalizePath('\\\\server\\')).toBe('/server')
      })

      it('should preserve UNC for valid server/share format', () => {
        expect(normalizePath('\\\\server\\share')).toBe('//server/share')
        expect(normalizePath('//server/share')).toBe('//server/share')
      })
    })

    describe('Edge cases', () => {
      it('should handle empty path', () => {
        expect(normalizePath('')).toBe('.')
      })

      it('should handle single dot', () => {
        expect(normalizePath('.')).toBe('.')
      })

      it('should handle double dot', () => {
        expect(normalizePath('..')).toBe('..')
      })

      it('should handle single slash', () => {
        expect(normalizePath('/')).toBe('/')
      })

      it('should handle single backslash', () => {
        expect(normalizePath('\\')).toBe('/')
      })

      it('should handle only dots and slashes', () => {
        expect(normalizePath('./.')).toBe('.')
        expect(normalizePath('./..')).toBe('..')
        expect(normalizePath('../.')).toBe('..')
      })

      it('should handle trailing slashes', () => {
        expect(normalizePath('foo/bar/')).toBe('foo/bar')
        expect(normalizePath('foo/bar///')).toBe('foo/bar')
      })

      it('should handle leading slashes', () => {
        expect(normalizePath('/foo/bar')).toBe('/foo/bar')
        expect(normalizePath('///foo/bar')).toBe('/foo/bar')
      })

      it('should handle Buffer input', () => {
        expect(normalizePath(Buffer.from('foo/./bar/../baz'))).toBe('foo/baz')
      })

      it('should handle URL input', () => {
        expect(normalizePath(new URL('file:///foo/bar'))).toBe('/foo/bar')
      })
    })

    describe('Complex scenarios', () => {
      it('should handle mixed . and .. segments', () => {
        expect(normalizePath('a/./b/../c/./d')).toBe('a/c/d')
        expect(normalizePath('./a/./b/../../c')).toBe('c')
      })

      it('should handle absolute paths with ..', () => {
        expect(normalizePath('/foo/bar/../baz')).toBe('/foo/baz')
        expect(normalizePath('/foo/../bar')).toBe('/bar')
        expect(normalizePath('/foo/bar/../../baz')).toBe('/baz')
      })

      it('should not go above root for absolute paths', () => {
        expect(normalizePath('/../foo')).toBe('/foo')
        expect(normalizePath('/../../foo')).toBe('/foo')
        expect(normalizePath('/..')).toBe('/')
      })

      it('should handle empty segments', () => {
        expect(normalizePath('a//b')).toBe('a/b')
        expect(normalizePath('a///b')).toBe('a/b')
        // //a//b// is treated as UNC path (starts with //)
        expect(normalizePath('//a//b//')).toBe('//a/b')
      })

      it('should handle consecutive .. segments', () => {
        expect(normalizePath('a/b/../../c')).toBe('c')
        expect(normalizePath('a/../b/../c')).toBe('c')
        expect(normalizePath('../../../foo')).toBe('../../../foo')
      })

      it('should handle .. with leading ..', () => {
        expect(normalizePath('../a/b/../c')).toBe('../a/c')
        expect(normalizePath('../../a/../b')).toBe('../../b')
      })
    })
  })

  describe('pathLikeToString', () => {
    describe('String input', () => {
      it('should return string as-is', () => {
        expect(pathLikeToString('/home/user')).toBe('/home/user')
        expect(pathLikeToString('relative/path')).toBe('relative/path')
        expect(pathLikeToString('')).toBe('')
      })
    })

    describe('Buffer input', () => {
      it('should decode Buffer as UTF-8', () => {
        expect(pathLikeToString(Buffer.from('/tmp/file'))).toBe('/tmp/file')
        expect(pathLikeToString(Buffer.from('hello.txt'))).toBe('hello.txt')
      })

      it('should handle UTF-8 characters in Buffer', () => {
        expect(pathLikeToString(Buffer.from('path/to/café'))).toBe(
          'path/to/café',
        )
        expect(pathLikeToString(Buffer.from('路径/文件'))).toBe('路径/文件')
      })
    })

    describe('URL input', () => {
      it('should convert file URLs', () => {
        expect(pathLikeToString(new URL('file:///home/user'))).toBe(
          '/home/user',
        )
        expect(pathLikeToString(new URL('file:///tmp/file.txt'))).toBe(
          '/tmp/file.txt',
        )
      })

      it('should handle percent-encoded URLs', () => {
        expect(pathLikeToString(new URL('file:///path%20with%20spaces'))).toBe(
          '/path with spaces',
        )
        expect(
          pathLikeToString(new URL('file:///special%2Fchars%3Ftest')),
        ).toBe('/special/chars?test')
      })

      it('should handle Windows file URLs', () => {
        if (process.platform === 'win32') {
          expect(
            normalizePath(pathLikeToString(new URL('file:///C:/Windows'))),
          ).toMatch(/^C:\//)
          expect(
            normalizePath(
              pathLikeToString(new URL('file:///D:/data/file.txt')),
            ),
          ).toMatch(/^D:\//)
        }
      })

      it('should handle malformed URLs with fallback', () => {
        // Create a URL that might cause fileURLToPath to fail
        try {
          const url = new URL('file:///path')
          const result = pathLikeToString(url)
          // Should return the pathname
          expect(typeof result).toBe('string')
        } catch {
          // URL construction failed, which is fine
        }
      })
    })

    describe('Null and undefined input', () => {
      it('should return empty string for null', () => {
        expect(pathLikeToString(null)).toBe('')
      })

      it('should return empty string for undefined', () => {
        expect(pathLikeToString(undefined)).toBe('')
      })
    })

    describe('Other input types', () => {
      it('should convert other types to string', () => {
        expect(pathLikeToString(123 as any)).toBe('123')
        expect(pathLikeToString(true as any)).toBe('true')
      })
    })
  })

  describe('splitPath', () => {
    describe('POSIX paths', () => {
      it('should split POSIX paths', () => {
        expect(splitPath('/home/user/file.txt')).toEqual([
          '',
          'home',
          'user',
          'file.txt',
        ])
        expect(splitPath('src/lib/util.js')).toEqual(['src', 'lib', 'util.js'])
      })
    })

    describe('Windows paths', () => {
      it('should split Windows paths', () => {
        expect(splitPath('C:\\Users\\John')).toEqual(['C:', 'Users', 'John'])
        expect(splitPath('folder\\file.txt')).toEqual(['folder', 'file.txt'])
      })

      it('should handle mixed separators', () => {
        expect(splitPath('path/to\\file')).toEqual(['path', 'to', 'file'])
        expect(splitPath('C:/Users\\John/file.txt')).toEqual([
          'C:',
          'Users',
          'John',
          'file.txt',
        ])
      })
    })

    describe('Edge cases', () => {
      it('should return empty array for empty path', () => {
        expect(splitPath('')).toEqual([])
      })

      it('should handle single slash', () => {
        expect(splitPath('/')).toEqual(['', ''])
      })

      it('should handle paths with consecutive separators', () => {
        expect(splitPath('/foo//bar/')).toEqual(['', 'foo', '', 'bar', ''])
        expect(splitPath('a\\\\b')).toEqual(['a', '', 'b'])
      })

      it('should handle paths with only separators', () => {
        expect(splitPath('///')).toEqual(['', '', '', ''])
        expect(splitPath('\\\\\\')).toEqual(['', '', '', ''])
      })

      it('should handle Buffer input', () => {
        expect(splitPath(Buffer.from('a/b/c'))).toEqual(['a', 'b', 'c'])
      })

      it('should handle URL input', () => {
        expect(splitPath(new URL('file:///a/b/c'))).toEqual(['', 'a', 'b', 'c'])
      })
    })
  })

  describe('trimLeadingDotSlash', () => {
    it('should remove leading ./ prefix', () => {
      expect(trimLeadingDotSlash('./src/index.js')).toBe('src/index.js')
      expect(trimLeadingDotSlash('./file.txt')).toBe('file.txt')
      expect(trimLeadingDotSlash('./a/b/c')).toBe('a/b/c')
    })

    it('should remove leading .\\ prefix', () => {
      expect(trimLeadingDotSlash('.\\src\\file.txt')).toBe('src\\file.txt')
      expect(trimLeadingDotSlash('.\\file.txt')).toBe('file.txt')
    })

    it('should preserve ../ prefix', () => {
      expect(trimLeadingDotSlash('../lib/util.js')).toBe('../lib/util.js')
      expect(trimLeadingDotSlash('../../file.txt')).toBe('../../file.txt')
    })

    it('should not change paths without ./ prefix', () => {
      expect(trimLeadingDotSlash('/absolute/path')).toBe('/absolute/path')
      expect(trimLeadingDotSlash('relative/path')).toBe('relative/path')
      expect(trimLeadingDotSlash('file.txt')).toBe('file.txt')
    })

    it('should not change single dot', () => {
      expect(trimLeadingDotSlash('.')).toBe('.')
    })

    it('should not change double dot', () => {
      expect(trimLeadingDotSlash('..')).toBe('..')
    })

    it('should handle Buffer input', () => {
      expect(trimLeadingDotSlash(Buffer.from('./file.txt'))).toBe('file.txt')
    })

    it('should handle URL input', () => {
      // file URLs typically don't have ./ prefix, but test the conversion
      expect(trimLeadingDotSlash(new URL('file:///path/file'))).toBe(
        '/path/file',
      )
    })

    it('should handle empty string', () => {
      expect(trimLeadingDotSlash('')).toBe('')
    })

    it('should only trim once', () => {
      // Function removes leading './' once, so './././file' becomes '././file'
      expect(trimLeadingDotSlash('./././file')).toBe('././file')
    })
  })

  describe('relativeResolve', () => {
    describe('Basic relative paths', () => {
      it('should calculate relative path between directories', () => {
        const result = relativeResolve('/foo/bar', '/foo/baz')
        expect(result).toBe('../baz')
      })

      it('should calculate relative path to parent', () => {
        const result = relativeResolve('/foo/bar/baz', '/foo')
        expect(result).toBe('../..')
      })

      it('should calculate relative path to child', () => {
        const result = relativeResolve('/foo', '/foo/bar')
        expect(result).toBe('bar')
      })

      it('should return empty string for same paths', () => {
        expect(relativeResolve('/foo/bar', '/foo/bar')).toBe('')
      })
    })

    describe('Root paths', () => {
      it('should handle root paths', () => {
        const result = relativeResolve('/', '/foo/bar')
        expect(result).toBe('foo/bar')
      })

      it('should handle path to root', () => {
        const result = relativeResolve('/foo/bar', '/')
        expect(result).toBe('../..')
      })
    })

    describe('Complex scenarios', () => {
      it('should handle paths with . and ..', () => {
        const result = relativeResolve('/foo/./bar', '/foo/baz')
        expect(result).toBe('../baz')
      })

      it('should normalize before calculating', () => {
        const result = relativeResolve('/foo/bar/../baz', '/foo/qux')
        expect(result).toBe('../qux')
      })

      it('should handle deeply nested paths', () => {
        const result = relativeResolve('/a/b/c/d/e', '/a/b/f/g')
        expect(result).toBe('../../../f/g')
      })
    })

    if (process.platform === 'win32') {
      describe('Windows paths', () => {
        it('should handle Windows paths', () => {
          const result = relativeResolve('C:\\foo\\bar', 'C:\\foo\\baz')
          expect(result).toBe('../baz')
        })

        it('should be case-insensitive on Windows', () => {
          const result = relativeResolve('C:\\Foo\\bar', 'C:\\foo\\baz')
          expect(result).toBe('../baz')
        })
      })
    }

    describe('Relative input paths', () => {
      it('should resolve relative inputs to absolute', () => {
        // These will be resolved against cwd, so result depends on cwd
        const result = relativeResolve('foo/bar', 'foo/baz')
        expect(result).toBe('../baz')
      })
    })
  })

  describe('Cross-platform compatibility', () => {
    it('should handle forward slashes on all platforms', () => {
      expect(normalizePath('a/b/c')).toBe('a/b/c')
      expect(isAbsolute('/a/b/c')).toBe(true)
      expect(splitPath('a/b/c')).toEqual(['a', 'b', 'c'])
    })

    it('should handle backslashes on all platforms', () => {
      expect(normalizePath('a\\b\\c')).toBe('a/b/c')
      expect(splitPath('a\\b\\c')).toEqual(['a', 'b', 'c'])
    })

    it('should produce consistent results', () => {
      const paths = ['a/b/c', 'a\\b\\c', 'a/b\\c', 'a\\b/c']
      const normalized = paths.map(p => normalizePath(p))
      expect(normalized.every(p => p === 'a/b/c')).toBe(true)
    })
  })

  describe('Integration tests', () => {
    it('should work with isPath and normalizePath together', () => {
      const path = './src/../lib/util.js'
      expect(isPath(path)).toBe(true)
      expect(normalizePath(path)).toBe('lib/util.js')
    })

    it('should work with isAbsolute and normalizePath together', () => {
      const path = '/foo/./bar/../baz'
      expect(isAbsolute(path)).toBe(true)
      expect(normalizePath(path)).toBe('/foo/baz')
    })

    it('should work with splitPath and normalizePath together', () => {
      const path = 'a//b/./c/../d'
      const normalized = normalizePath(path)
      const parts = splitPath(normalized)
      expect(parts).toEqual(['a', 'b', 'd'])
    })

    it('should work with pathLikeToString and all functions', () => {
      const buffer = Buffer.from('./path/to/file')
      expect(isPath(buffer)).toBe(true)
      expect(normalizePath(buffer)).toBe('path/to/file')
      // splitPath doesn't normalize, just splits raw path
      expect(splitPath(buffer)).toEqual(['.', 'path', 'to', 'file'])
    })
  })

  describe('Special characters and Unicode', () => {
    it('should handle paths with spaces', () => {
      expect(normalizePath('/path with spaces/file.txt')).toBe(
        '/path with spaces/file.txt',
      )
      expect(splitPath('path with spaces/file')).toEqual([
        'path with spaces',
        'file',
      ])
    })

    it('should handle paths with Unicode characters', () => {
      expect(normalizePath('/路径/文件.txt')).toBe('/路径/文件.txt')
      expect(normalizePath('/café/naïve.js')).toBe('/café/naïve.js')
    })

    it('should handle paths with special characters', () => {
      expect(normalizePath('/path/to/file[1].txt')).toBe('/path/to/file[1].txt')
      expect(normalizePath('/path/with-dash/and_underscore')).toBe(
        '/path/with-dash/and_underscore',
      )
    })
  })

  describe('Performance edge cases', () => {
    it('should handle very long paths', () => {
      const longPath = `${'a/'.repeat(100)}file.txt`
      expect(normalizePath(longPath)).toBe(longPath)
      expect(splitPath(longPath).length).toBe(101)
    })

    it('should handle paths with many .. segments', () => {
      const manyDotDots = `${'../'.repeat(10)}file.txt`
      const normalized = normalizePath(manyDotDots)
      expect(normalized.startsWith('../../../../../../../../../')).toBe(true)
    })

    it('should handle paths with many . segments', () => {
      const manyDots = 'a/./././././././././b'
      expect(normalizePath(manyDots)).toBe('a/b')
    })
  })
})
