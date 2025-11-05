/**
 * @fileoverview Unit tests for file paths, directory names, extensions, and glob patterns.
 *
 * Tests file path constants and patterns:
 * - Common paths: node_modules, package.json, LICENSE files
 * - Glob patterns: LICENSE_GLOB, gitignore patterns, recursive globs
 * - File extensions: .js, .ts, .json, .md
 * Frozen constants for file discovery and filtering.
 */

import { describe, expect, it } from 'vitest'

import {
  CACHE_DIR,
  CACHE_TTL_DIR,
  CHANGELOG_MD,
  DOT_GIT_DIR,
  DOT_GITHUB,
  DOT_PACKAGE_LOCK_JSON,
  DOT_SOCKET_DIR,
  ESLINT_CONFIG_JS,
  EXT_CJS,
  EXT_CMD,
  EXT_CTS,
  EXT_DTS,
  EXT_JS,
  EXT_JSON,
  EXT_LOCK,
  EXT_LOCKB,
  EXT_MD,
  EXT_MJS,
  EXT_MTS,
  EXT_PS1,
  EXT_YAML,
  EXT_YML,
  EXTENSIONS,
  EXTENSIONS_JSON,
  GITIGNORE,
  LICENSE,
  LICENSE_GLOB,
  LICENSE_GLOB_RECURSIVE,
  LICENSE_MD,
  LICENSE_ORIGINAL,
  LICENSE_ORIGINAL_GLOB,
  LICENSE_ORIGINAL_GLOB_RECURSIVE,
  MANIFEST_JSON,
  NODE_MODULES,
  NODE_MODULES_GLOB_RECURSIVE,
  PACKAGE_JSON,
  README_GLOB,
  README_GLOB_RECURSIVE,
  README_MD,
  ROLLUP_EXTERNAL_SUFFIX,
  SLASH_NODE_MODULES_SLASH,
  TSCONFIG_JSON,
} from '@socketsecurity/lib/constants/paths'

describe('constants/paths', () => {
  describe('file names', () => {
    it('should export PACKAGE_JSON', () => {
      expect(PACKAGE_JSON).toBe('package.json')
    })

    it('should export TSCONFIG_JSON', () => {
      expect(TSCONFIG_JSON).toBe('tsconfig.json')
    })

    it('should export LICENSE', () => {
      expect(LICENSE).toBe('LICENSE')
    })

    it('should export LICENSE_MD', () => {
      expect(LICENSE_MD).toBe('LICENSE.md')
    })

    it('should export LICENSE_ORIGINAL', () => {
      expect(LICENSE_ORIGINAL).toBe('LICENSE.original')
    })

    it('should export README_MD', () => {
      expect(README_MD).toBe('README.md')
    })

    it('should export CHANGELOG_MD', () => {
      expect(CHANGELOG_MD).toBe('CHANGELOG.md')
    })

    it('should export MANIFEST_JSON', () => {
      expect(MANIFEST_JSON).toBe('manifest.json')
    })

    it('should export EXTENSIONS_JSON', () => {
      expect(EXTENSIONS_JSON).toBe('extensions.json')
    })

    it('should export ESLINT_CONFIG_JS', () => {
      expect(ESLINT_CONFIG_JS).toBe('eslint.config.js')
    })

    it('should export GITIGNORE', () => {
      expect(GITIGNORE).toBe('.gitignore')
    })

    it('should export DOT_PACKAGE_LOCK_JSON', () => {
      expect(DOT_PACKAGE_LOCK_JSON).toBe('.package-lock.json')
    })

    it('should have consistent JSON extension usage', () => {
      expect(PACKAGE_JSON.endsWith('.json')).toBe(true)
      expect(TSCONFIG_JSON.endsWith('.json')).toBe(true)
      expect(MANIFEST_JSON.endsWith('.json')).toBe(true)
      expect(EXTENSIONS_JSON.endsWith('.json')).toBe(true)
      expect(DOT_PACKAGE_LOCK_JSON.endsWith('.json')).toBe(true)
    })

    it('should have consistent markdown extension usage', () => {
      expect(LICENSE_MD.endsWith('.md')).toBe(true)
      expect(README_MD.endsWith('.md')).toBe(true)
      expect(CHANGELOG_MD.endsWith('.md')).toBe(true)
    })
  })

  describe('directory names', () => {
    it('should export NODE_MODULES', () => {
      expect(NODE_MODULES).toBe('node_modules')
    })

    it('should export DOT_GIT_DIR', () => {
      expect(DOT_GIT_DIR).toBe('.git')
    })

    it('should export DOT_GITHUB', () => {
      expect(DOT_GITHUB).toBe('.github')
    })

    it('should export DOT_SOCKET_DIR', () => {
      expect(DOT_SOCKET_DIR).toBe('.socket')
    })

    it('should export CACHE_DIR', () => {
      expect(CACHE_DIR).toBe('cache')
    })

    it('should export CACHE_TTL_DIR', () => {
      expect(CACHE_TTL_DIR).toBe('ttl')
    })

    it('should have dot prefix for hidden directories', () => {
      expect(DOT_GIT_DIR.startsWith('.')).toBe(true)
      expect(DOT_GITHUB.startsWith('.')).toBe(true)
      expect(DOT_SOCKET_DIR.startsWith('.')).toBe(true)
    })
  })

  describe('path patterns', () => {
    it('should export NODE_MODULES_GLOB_RECURSIVE', () => {
      expect(NODE_MODULES_GLOB_RECURSIVE).toBe('**/node_modules')
    })

    it('should export SLASH_NODE_MODULES_SLASH', () => {
      expect(SLASH_NODE_MODULES_SLASH).toBe('/node_modules/')
    })

    it('should have glob pattern format', () => {
      expect(NODE_MODULES_GLOB_RECURSIVE.startsWith('**/')).toBe(true)
    })

    it('should have slash delimiters', () => {
      expect(SLASH_NODE_MODULES_SLASH.startsWith('/')).toBe(true)
      expect(SLASH_NODE_MODULES_SLASH.endsWith('/')).toBe(true)
    })
  })

  describe('file extensions', () => {
    it('should export EXT_CJS', () => {
      expect(EXT_CJS).toBe('.cjs')
    })

    it('should export EXT_CMD', () => {
      expect(EXT_CMD).toBe('.cmd')
    })

    it('should export EXT_CTS', () => {
      expect(EXT_CTS).toBe('.cts')
    })

    it('should export EXT_DTS', () => {
      expect(EXT_DTS).toBe('.d.ts')
    })

    it('should export EXT_JS', () => {
      expect(EXT_JS).toBe('.js')
    })

    it('should export EXT_JSON', () => {
      expect(EXT_JSON).toBe('.json')
    })

    it('should export EXT_LOCK', () => {
      expect(EXT_LOCK).toBe('.lock')
    })

    it('should export EXT_LOCKB', () => {
      expect(EXT_LOCKB).toBe('.lockb')
    })

    it('should export EXT_MD', () => {
      expect(EXT_MD).toBe('.md')
    })

    it('should export EXT_MJS', () => {
      expect(EXT_MJS).toBe('.mjs')
    })

    it('should export EXT_MTS', () => {
      expect(EXT_MTS).toBe('.mts')
    })

    it('should export EXT_PS1', () => {
      expect(EXT_PS1).toBe('.ps1')
    })

    it('should export EXT_YAML', () => {
      expect(EXT_YAML).toBe('.yaml')
    })

    it('should export EXT_YML', () => {
      expect(EXT_YML).toBe('.yml')
    })

    it('should all start with dot', () => {
      const extensions = [
        EXT_CJS,
        EXT_CMD,
        EXT_CTS,
        EXT_DTS,
        EXT_JS,
        EXT_JSON,
        EXT_LOCK,
        EXT_LOCKB,
        EXT_MD,
        EXT_MJS,
        EXT_MTS,
        EXT_PS1,
        EXT_YAML,
        EXT_YML,
      ]
      for (const ext of extensions) {
        expect(ext.startsWith('.')).toBe(true)
      }
    })

    it('should have unique values', () => {
      const extensions = [
        EXT_CJS,
        EXT_CMD,
        EXT_CTS,
        EXT_DTS,
        EXT_JS,
        EXT_JSON,
        EXT_LOCK,
        EXT_LOCKB,
        EXT_MD,
        EXT_MJS,
        EXT_MTS,
        EXT_PS1,
        EXT_YAML,
        EXT_YML,
      ]
      const unique = [...new Set(extensions)]
      expect(unique.length).toBe(extensions.length)
    })
  })

  describe('glob patterns', () => {
    it('should export LICENSE_GLOB', () => {
      expect(LICENSE_GLOB).toBe('LICEN[CS]E{[.-]*,}')
    })

    it('should export LICENSE_GLOB_RECURSIVE', () => {
      expect(LICENSE_GLOB_RECURSIVE).toBe('**/LICEN[CS]E{[.-]*,}')
    })

    it('should export LICENSE_ORIGINAL_GLOB', () => {
      expect(LICENSE_ORIGINAL_GLOB).toBe('*.original{.*,}')
    })

    it('should export LICENSE_ORIGINAL_GLOB_RECURSIVE', () => {
      expect(LICENSE_ORIGINAL_GLOB_RECURSIVE).toBe('**/*.original{.*,}')
    })

    it('should export README_GLOB', () => {
      expect(README_GLOB).toBe('README{.*,}')
    })

    it('should export README_GLOB_RECURSIVE', () => {
      expect(README_GLOB_RECURSIVE).toBe('**/README{.*,}')
    })

    it('should have recursive variants', () => {
      expect(LICENSE_GLOB_RECURSIVE.startsWith('**/')).toBe(true)
      expect(LICENSE_ORIGINAL_GLOB_RECURSIVE.startsWith('**/')).toBe(true)
      expect(README_GLOB_RECURSIVE.startsWith('**/')).toBe(true)
    })

    it('should use glob brace expansion', () => {
      expect(LICENSE_GLOB).toContain('{')
      expect(LICENSE_GLOB).toContain('}')
      expect(LICENSE_ORIGINAL_GLOB).toContain('{')
      expect(README_GLOB).toContain('{')
    })

    it('should use glob character classes', () => {
      expect(LICENSE_GLOB).toContain('[')
      expect(LICENSE_GLOB).toContain(']')
    })
  })

  describe('miscellaneous constants', () => {
    it('should export EXTENSIONS', () => {
      expect(EXTENSIONS).toBe('extensions')
    })

    it('should export ROLLUP_EXTERNAL_SUFFIX', () => {
      expect(ROLLUP_EXTERNAL_SUFFIX).toBe('__rollup_external')
    })

    it('should be strings', () => {
      expect(typeof EXTENSIONS).toBe('string')
      expect(typeof ROLLUP_EXTERNAL_SUFFIX).toBe('string')
    })
  })

  describe('constant relationships', () => {
    it('should have LICENSE_MD contain LICENSE', () => {
      expect(LICENSE_MD).toContain(LICENSE)
    })

    it('should have LICENSE_ORIGINAL contain LICENSE', () => {
      expect(LICENSE_ORIGINAL).toContain(LICENSE)
    })

    it('should have EXTENSIONS_JSON contain EXTENSIONS', () => {
      expect(EXTENSIONS_JSON).toContain(EXTENSIONS)
    })

    it('should have consistent cache directory naming', () => {
      expect(typeof CACHE_DIR).toBe('string')
      expect(typeof CACHE_TTL_DIR).toBe('string')
    })
  })

  describe('real-world usage', () => {
    it('should support file name matching', () => {
      const filename = 'package.json'
      expect(filename).toBe(PACKAGE_JSON)
    })

    it('should support extension detection', () => {
      const filename = 'example.ts'
      const hasDTsExt = filename.replace(/\.ts$/, EXT_DTS)
      expect(hasDTsExt).toBe('example.d.ts')
    })

    it('should support directory detection', () => {
      const path = '/project/node_modules/package'
      expect(path.includes(NODE_MODULES)).toBe(true)
      expect(path.includes(SLASH_NODE_MODULES_SLASH)).toBe(true)
    })

    it('should support glob pattern usage', () => {
      const pattern = LICENSE_GLOB_RECURSIVE
      expect(pattern.startsWith('**/')).toBe(true)
    })
  })

  describe('constant immutability', () => {
    it('should not allow reassignment', () => {
      expect(() => {
        // @ts-expect-error - testing immutability
        PACKAGE_JSON = 'other.json'
      }).toThrow()
    })
  })
})
