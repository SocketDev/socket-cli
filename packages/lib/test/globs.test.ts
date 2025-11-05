/**
 * @fileoverview Unit tests for glob pattern matching utilities.
 *
 * Tests glob pattern matching and file filtering using picomatch and fast-glob:
 * - defaultIgnore array with npm-packlist patterns (.git, node_modules, .env, etc.)
 * - getGlobMatcher() creates cached matchers for glob patterns with picomatch
 * - globStreamLicenses() streams license file paths matching LICENSE* patterns
 * - Supports negative patterns (!*.test.js), multiple patterns, case-insensitive matching
 * - Options: dot files, ignore patterns, recursive depth, base name matching
 * - Matcher caching to avoid recompiling identical patterns
 * - defaultIgnore is frozen (immutable) to prevent accidental modifications
 * Tests validate pattern matching, exclusions, options handling, and edge cases.
 * Used by Socket tools for file discovery and npm package analysis.
 */

import {
  defaultIgnore,
  getGlobMatcher,
  globStreamLicenses,
} from '@socketsecurity/lib/globs'
import { describe, expect, it } from 'vitest'

describe('globs', () => {
  describe('defaultIgnore', () => {
    it('should be an array', () => {
      expect(Array.isArray(defaultIgnore)).toBe(true)
    })

    it('should contain common ignore patterns', () => {
      expect(defaultIgnore).toContain('**/.git')
      expect(defaultIgnore).toContain('**/.npmrc')
      expect(defaultIgnore).toContain('**/node_modules')
      expect(defaultIgnore).toContain('**/.DS_Store')
    })

    it('should include npm-packlist defaults', () => {
      expect(defaultIgnore).toContain('**/.gitignore')
      expect(defaultIgnore).toContain('**/.svn')
      expect(defaultIgnore).toContain('**/CVS')
      expect(defaultIgnore).toContain('**/npm-debug.log')
    })

    it('should include additional common ignores', () => {
      expect(defaultIgnore).toContain('**/.env')
      expect(defaultIgnore).toContain('**/.eslintcache')
      expect(defaultIgnore).toContain('**/.vscode')
      expect(defaultIgnore).toContain('**/Thumbs.db')
    })

    it('should be frozen', () => {
      expect(Object.isFrozen(defaultIgnore)).toBe(true)
    })

    it('should not be modifiable', () => {
      const originalLength = defaultIgnore.length
      expect(() => {
        ;(defaultIgnore as any).push('new-pattern')
      }).toThrow()
      expect(defaultIgnore.length).toBe(originalLength)
    })

    it('should have reasonable length', () => {
      expect(defaultIgnore.length).toBeGreaterThan(10)
      expect(defaultIgnore.length).toBeLessThan(100)
    })

    it('should contain glob patterns', () => {
      for (const pattern of defaultIgnore) {
        expect(typeof pattern).toBe('string')
        expect(pattern.length).toBeGreaterThan(0)
      }
    })
  })

  describe('getGlobMatcher', () => {
    it('should create matcher for single pattern', () => {
      const matcher = getGlobMatcher('*.js')
      expect(typeof matcher).toBe('function')
    })

    it('should match simple patterns', () => {
      const matcher = getGlobMatcher('*.js')
      expect(matcher('test.js')).toBe(true)
      expect(matcher('test.ts')).toBe(false)
    })

    it('should handle array of patterns', () => {
      const matcher = getGlobMatcher(['*.js', '*.ts'])
      expect(matcher('test.js')).toBe(true)
      expect(matcher('test.ts')).toBe(true)
      expect(matcher('test.css')).toBe(false)
    })

    it('should handle negative patterns', () => {
      const matcher = getGlobMatcher(['*.js', '!*.test.js'])
      expect(matcher('app.js')).toBe(true)
      expect(matcher('app.test.js')).toBe(false)
    })

    it('should cache matchers', () => {
      const matcher1 = getGlobMatcher('*.js')
      const matcher2 = getGlobMatcher('*.js')
      expect(matcher1).toBe(matcher2)
    })

    it('should create different matchers for different patterns', () => {
      const matcher1 = getGlobMatcher('*.js')
      const matcher2 = getGlobMatcher('*.ts')
      expect(matcher1).not.toBe(matcher2)
    })

    it('should handle options', () => {
      const matcher = getGlobMatcher('*.JS', { nocase: true })
      expect(matcher('test.js')).toBe(true)
      expect(matcher('test.JS')).toBe(true)
    })

    it('should handle dot option', () => {
      const matcher = getGlobMatcher('.*', { dot: true })
      expect(typeof matcher).toBe('function')
    })

    it('should handle ignore option in negation', () => {
      const matcher = getGlobMatcher('*.js', { ignore: ['*.test.js'] })
      expect(typeof matcher).toBe('function')
    })

    it('should handle glob patterns', () => {
      const matcher = getGlobMatcher('**/*.js')
      expect(matcher('src/app.js')).toBe(true)
      expect(matcher('src/utils/helper.js')).toBe(true)
      expect(matcher('src/app.ts')).toBe(false)
    })

    it('should handle multiple negative patterns', () => {
      const matcher = getGlobMatcher(['*.js', '!*.test.js', '!*.spec.js'])
      expect(matcher('app.js')).toBe(true)
      expect(matcher('app.test.js')).toBe(false)
      expect(matcher('app.spec.js')).toBe(false)
    })

    it('should be case insensitive by default', () => {
      const matcher = getGlobMatcher('*.js')
      expect(matcher('TEST.JS')).toBe(true)
      expect(matcher('test.js')).toBe(true)
    })

    it('should handle empty pattern array', () => {
      const matcher = getGlobMatcher([])
      expect(typeof matcher).toBe('function')
    })

    it('should handle complex patterns', () => {
      const matcher = getGlobMatcher('src/**/*.{js,ts}')
      expect(matcher('src/app.js')).toBe(true)
      expect(matcher('src/utils/helper.ts')).toBe(true)
      expect(matcher('test/app.js')).toBe(false)
    })

    it('should cache with different options separately', () => {
      const matcher1 = getGlobMatcher('*.js', { dot: true })
      const matcher2 = getGlobMatcher('*.js', { dot: false })
      expect(matcher1).not.toBe(matcher2)
    })

    it('should handle patterns with special characters', () => {
      const matcher = getGlobMatcher('test-*.js')
      expect(matcher('test-foo.js')).toBe(true)
      expect(matcher('test.js')).toBe(false)
    })

    it('should handle directory patterns', () => {
      const matcher = getGlobMatcher('src/**')
      expect(matcher('src/app.js')).toBe(true)
      expect(matcher('src/utils/helper.js')).toBe(true)
    })
  })

  describe('globStreamLicenses', () => {
    it('should return a readable stream', () => {
      const stream = globStreamLicenses(process.cwd())
      expect(stream).toBeDefined()
      expect(typeof stream.on).toBe('function')
      expect(typeof stream.pipe).toBe('function')
    })

    it('should accept dirname parameter', () => {
      expect(() => globStreamLicenses('.')).not.toThrow()
      expect(() => globStreamLicenses('./src')).not.toThrow()
    })

    it('should accept options parameter', () => {
      expect(() => globStreamLicenses('.', {})).not.toThrow()
      expect(() => globStreamLicenses('.', { recursive: true })).not.toThrow()
    })

    it('should handle ignoreOriginals option', () => {
      const stream = globStreamLicenses('.', { ignoreOriginals: true })
      expect(stream).toBeDefined()
    })

    it('should handle recursive option', () => {
      const stream = globStreamLicenses('.', { recursive: false })
      expect(stream).toBeDefined()
    })

    it('should handle custom ignore patterns', () => {
      const stream = globStreamLicenses('.', { ignore: ['**/node_modules/**'] })
      expect(stream).toBeDefined()
    })

    it('should handle absolute option', () => {
      const stream = globStreamLicenses('.', { absolute: false })
      expect(stream).toBeDefined()
    })

    it('should handle dot option', () => {
      const stream = globStreamLicenses('.', { dot: true })
      expect(stream).toBeDefined()
    })

    it('should handle deep option', () => {
      const stream = globStreamLicenses('.', { deep: 3 })
      expect(stream).toBeDefined()
    })

    it('should handle cwd option', () => {
      const stream = globStreamLicenses('.', { cwd: process.cwd() })
      expect(stream).toBeDefined()
    })

    it('should handle multiple options together', () => {
      const stream = globStreamLicenses('.', {
        recursive: true,
        ignoreOriginals: true,
        dot: true,
        absolute: true,
      })
      expect(stream).toBeDefined()
    })

    it('should be a function', () => {
      expect(typeof globStreamLicenses).toBe('function')
    })

    it('should handle empty options', () => {
      const stream = globStreamLicenses('.')
      expect(stream).toBeDefined()
      expect(typeof stream.on).toBe('function')
    })
  })

  describe('integration', () => {
    it('should have consistent behavior across calls', () => {
      const matcher1 = getGlobMatcher('*.js')
      const matcher2 = getGlobMatcher('*.js')
      const testPath = 'test.js'

      expect(matcher1(testPath)).toBe(matcher2(testPath))
    })

    it('should handle real-world patterns', () => {
      const matcher = getGlobMatcher([
        '**/*.js',
        '!**/node_modules/**',
        '!**/dist/**',
      ])
      expect(matcher('src/app.js')).toBe(true)
      expect(matcher('node_modules/pkg/index.js')).toBe(false)
      expect(matcher('dist/bundle.js')).toBe(false)
    })
  })
})
