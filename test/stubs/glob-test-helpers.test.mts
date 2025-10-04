import { describe, expect, it } from 'vitest'

import { isGlobMatch } from './glob-test-helpers.mts'

describe('glob utilities', () => {
  describe('isGlobMatch', () => {
    it('matches exact paths', () => {
      expect(isGlobMatch('test.js', ['test.js'])).toBe(true)
      expect(isGlobMatch('src/index.ts', ['src/index.ts'])).toBe(true)
      expect(isGlobMatch('package.json', ['package.json'])).toBe(true)
    })

    it('matches with wildcards', () => {
      expect(isGlobMatch('test.js', ['*.js'])).toBe(true)
      expect(isGlobMatch('src/index.ts', ['src/*.ts'])).toBe(true)
      expect(isGlobMatch('lib/utils.mjs', ['lib/*.mjs'])).toBe(true)
    })

    it('matches with double wildcards', () => {
      expect(isGlobMatch('src/deep/nested/file.ts', ['src/**/*.ts'])).toBe(true)
      expect(isGlobMatch('test/unit/spec.test.js', ['**/*.test.js'])).toBe(true)
      expect(isGlobMatch('node_modules/pkg/index.js', ['**/index.js'])).toBe(
        true,
      )
    })

    it('matches with brace expansion', () => {
      expect(isGlobMatch('file.ts', ['*.{js,ts}'])).toBe(true)
      expect(isGlobMatch('file.js', ['*.{js,ts}'])).toBe(true)
      expect(isGlobMatch('file.css', ['*.{js,ts}'])).toBe(false)
    })

    it('matches multiple patterns', () => {
      const patterns = ['*.js', '*.ts', '*.mjs']
      expect(isGlobMatch('test.js', patterns)).toBe(true)
      expect(isGlobMatch('index.ts', patterns)).toBe(true)
      expect(isGlobMatch('lib.mjs', patterns)).toBe(true)
      expect(isGlobMatch('style.css', patterns)).toBe(false)
    })

    it('handles negation patterns', () => {
      // Note: micromatch.isMatch doesn't handle negation the way you might expect.
      // It returns true if the file matches ANY of the patterns.
      // For proper negation handling, use the globWithGitIgnore function.
      expect(isGlobMatch('test.js', ['*.js'])).toBe(true)
      expect(isGlobMatch('index.js', ['*.js'])).toBe(true)
      // Negation patterns are processed differently by ignore library.
      expect(isGlobMatch('test.js', ['!test.js'])).toBe(false)
    })

    it('matches directories', () => {
      expect(isGlobMatch('src/', ['src/'])).toBe(true)
      expect(isGlobMatch('src', ['src/'])).toBe(false)
      expect(isGlobMatch('src/lib/', ['src/**/'])).toBe(true)
    })

    it('returns false for no patterns', () => {
      expect(isGlobMatch('test.js', [])).toBe(false)
    })

    it('handles special characters in paths', () => {
      expect(isGlobMatch('[test].js', ['\\[test\\].js'])).toBe(true)
      expect(isGlobMatch('file(1).txt', ['file\\(1\\).txt'])).toBe(true)
    })

    it('is case sensitive by default', () => {
      expect(isGlobMatch('Test.js', ['test.js'])).toBe(false)
      expect(isGlobMatch('TEST.JS', ['test.js'])).toBe(false)
    })

    it('matches dotfiles with explicit patterns', () => {
      expect(isGlobMatch('.gitignore', ['.gitignore'])).toBe(true)
      expect(isGlobMatch('.env', ['.*'])).toBe(true)
      expect(isGlobMatch('.config/file.js', ['.config/*.js'])).toBe(true)
    })

    it('handles absolute paths', () => {
      expect(isGlobMatch('/home/user/file.js', ['/**/*.js'])).toBe(true)
      expect(isGlobMatch('/etc/config', ['/etc/*'])).toBe(true)
    })

    it('matches parent directory patterns', () => {
      expect(isGlobMatch('../file.js', ['../*.js'])).toBe(true)
      expect(isGlobMatch('../../lib/index.ts', ['../../**/*.ts'])).toBe(true)
    })
  })
})
