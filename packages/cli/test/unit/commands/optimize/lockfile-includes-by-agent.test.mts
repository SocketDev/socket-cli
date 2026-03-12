/**
 * Unit tests for lockfile-includes-by-agent.
 *
 * Purpose:
 * Tests the functions that check if a package name exists in different lockfile formats.
 *
 * Test Coverage:
 * - npmLockSrcIncludes
 * - pnpmLockSrcIncludes
 * - yarnLockSrcIncludes
 * - bunLockSrcIncludes
 * - vltLockSrcIncludes
 * - lockSrcIncludes
 *
 * Related Files:
 * - commands/optimize/lockfile-includes-by-agent.mts (implementation)
 */

import { describe, expect, it } from 'vitest'

import {
  bunLockSrcIncludes,
  lockSrcIncludes,
  npmLockSrcIncludes,
  pnpmLockSrcIncludes,
  vltLockSrcIncludes,
  yarnLockSrcIncludes,
} from '../../../../src/commands/optimize/lockfile-includes-by-agent.mts'

import type { EnvDetails } from '../../../../src/utils/ecosystem/environment.mjs'

describe('lockfile-includes-by-agent', () => {
  describe('npmLockSrcIncludes', () => {
    it('returns true when package name exists in npm lockfile', () => {
      const lockSrc = `{
        "name": "test-project",
        "packages": {
          "node_modules/lodash": {
            "version": "4.17.21"
          }
        },
        "lodash": {
          "version": "4.17.21"
        }
      }`
      expect(npmLockSrcIncludes(lockSrc, 'lodash')).toBe(true)
    })

    it('returns false when package name does not exist', () => {
      const lockSrc = `{
        "name": "test-project",
        "packages": {}
      }`
      expect(npmLockSrcIncludes(lockSrc, 'lodash')).toBe(false)
    })

    it('handles scoped packages', () => {
      const lockSrc = `{
        "@babel/core": {
          "version": "7.0.0"
        }
      }`
      expect(npmLockSrcIncludes(lockSrc, '@babel/core')).toBe(true)
    })

    it('does not match package name as substring of another package', () => {
      const lockSrc = `{
        "react-dom": {
          "version": "18.0.0"
        }
      }`
      expect(npmLockSrcIncludes(lockSrc, 'react')).toBe(false)
    })

    it('returns false for empty lockSrc', () => {
      expect(npmLockSrcIncludes('', 'lodash')).toBe(false)
    })

    it('returns false for empty package name', () => {
      const lockSrc = `{ "lodash": { "version": "4.17.21" } }`
      expect(npmLockSrcIncludes(lockSrc, '')).toBe(false)
    })
  })

  describe('pnpmLockSrcIncludes', () => {
    it('returns true for quoted package name', () => {
      // pnpm v9 format with quoted package name.
      const lockSrc = `
packages:

  'lodash':
    resolution: {integrity: sha512-...}
      `
      expect(pnpmLockSrcIncludes(lockSrc, 'lodash')).toBe(true)
    })

    it('returns true for unquoted package name with colon', () => {
      const lockSrc = `
packages:
  lodash:
    version: 4.17.21
      `
      expect(pnpmLockSrcIncludes(lockSrc, 'lodash')).toBe(true)
    })

    it('returns true for package name with @ version', () => {
      const lockSrc = `
packages:
  lodash@4.17.21:
    resolution: {integrity: sha512-...}
      `
      expect(pnpmLockSrcIncludes(lockSrc, 'lodash')).toBe(true)
    })

    it('returns true for v6 lockfile format with leading slash', () => {
      const lockSrc = `
packages:
  /lodash@4.17.21:
    resolution: {integrity: sha512-...}
      `
      expect(pnpmLockSrcIncludes(lockSrc, 'lodash')).toBe(true)
    })

    it('returns false when package does not exist', () => {
      const lockSrc = `
packages:
  express@4.18.0:
    resolution: {integrity: sha512-...}
      `
      expect(pnpmLockSrcIncludes(lockSrc, 'lodash')).toBe(false)
    })

    it('handles scoped packages', () => {
      // Scoped packages in pnpm lockfile use the format: /@scope/name@version
      const lockSrc = `
packages:
  /@babel/core@7.0.0:
    resolution: {integrity: sha512-...}
      `
      expect(pnpmLockSrcIncludes(lockSrc, '@babel/core')).toBe(true)
    })

    it('handles package names with dots (regex special chars)', () => {
      const lockSrc = `
packages:
  lodash.debounce@4.0.8:
    resolution: {integrity: sha512-...}
      `
      expect(pnpmLockSrcIncludes(lockSrc, 'lodash.debounce')).toBe(true)
    })

    it('returns false for empty lockSrc', () => {
      expect(pnpmLockSrcIncludes('', 'lodash')).toBe(false)
    })
  })

  describe('yarnLockSrcIncludes', () => {
    it('returns true for quoted package name with @', () => {
      const lockSrc = `
"lodash@^4.17.0":
  version "4.17.21"
  resolved "https://registry.yarnpkg.com/lodash/-/lodash-4.17.21.tgz"
      `
      expect(yarnLockSrcIncludes(lockSrc, 'lodash')).toBe(true)
    })

    it('returns true for unquoted package name', () => {
      const lockSrc = `
lodash@^4.17.0:
  version "4.17.21"
      `
      expect(yarnLockSrcIncludes(lockSrc, 'lodash')).toBe(true)
    })

    it('returns true for multiple dependencies on same line', () => {
      const lockSrc = `
"lodash@^4.17.0", "lodash@^4.17.21":
  version "4.17.21"
      `
      expect(yarnLockSrcIncludes(lockSrc, 'lodash')).toBe(true)
    })

    it('returns false when package does not exist', () => {
      const lockSrc = `
"express@^4.18.0":
  version "4.18.2"
      `
      expect(yarnLockSrcIncludes(lockSrc, 'lodash')).toBe(false)
    })

    it('handles scoped packages', () => {
      const lockSrc = `
"@babel/core@^7.0.0":
  version "7.21.0"
      `
      expect(yarnLockSrcIncludes(lockSrc, '@babel/core')).toBe(true)
    })

    it('does not match partial package names', () => {
      const lockSrc = `
"lodash-es@^4.17.0":
  version "4.17.21"
      `
      expect(yarnLockSrcIncludes(lockSrc, 'lodash')).toBe(false)
    })

    it('returns false for empty lockSrc', () => {
      expect(yarnLockSrcIncludes('', 'lodash')).toBe(false)
    })
  })

  describe('bunLockSrcIncludes', () => {
    it('uses npm format for .lock extension', () => {
      const lockSrc = `{
        "lodash": {
          "version": "4.17.21"
        }
      }`
      expect(bunLockSrcIncludes(lockSrc, 'lodash', 'bun.lock')).toBe(true)
    })

    it('uses yarn format for .lockb extension', () => {
      const lockSrc = `
lodash@^4.17.0:
  version "4.17.21"
      `
      expect(bunLockSrcIncludes(lockSrc, 'lodash', 'bun.lockb')).toBe(true)
    })

    it('defaults to yarn format when no lockName provided', () => {
      const lockSrc = `
lodash@^4.17.0:
  version "4.17.21"
      `
      expect(bunLockSrcIncludes(lockSrc, 'lodash')).toBe(true)
    })
  })

  describe('vltLockSrcIncludes', () => {
    it('returns true when package name exists', () => {
      const lockSrc = `{
        "packages": {
          "lodash": "4.17.21"
        }
      }`
      expect(vltLockSrcIncludes(lockSrc, 'lodash')).toBe(true)
    })

    it('returns false when package does not exist', () => {
      const lockSrc = `{
        "packages": {
          "express": "4.18.0"
        }
      }`
      expect(vltLockSrcIncludes(lockSrc, 'lodash')).toBe(false)
    })
  })

  describe('lockSrcIncludes', () => {
    const createEnvDetails = (agent: string): EnvDetails =>
      ({ agent }) as unknown as EnvDetails

    it('uses npm format for npm agent', () => {
      const lockSrc = `{ "lodash": { "version": "4.17.21" } }`
      expect(lockSrcIncludes(createEnvDetails('npm'), lockSrc, 'lodash')).toBe(true)
    })

    it('uses pnpm format for pnpm agent', () => {
      const lockSrc = `
packages:
  lodash@4.17.21:
    resolution: {integrity: sha512-...}
      `
      expect(lockSrcIncludes(createEnvDetails('pnpm'), lockSrc, 'lodash')).toBe(true)
    })

    it('uses yarn format for yarn/berry agent', () => {
      const lockSrc = `
lodash@^4.17.0:
  version "4.17.21"
      `
      expect(lockSrcIncludes(createEnvDetails('yarn/berry'), lockSrc, 'lodash')).toBe(true)
    })

    it('uses yarn format for yarn/classic agent', () => {
      const lockSrc = `
lodash@^4.17.0:
  version "4.17.21"
      `
      expect(lockSrcIncludes(createEnvDetails('yarn/classic'), lockSrc, 'lodash')).toBe(true)
    })

    it('uses bun format for bun agent', () => {
      const lockSrc = `
lodash@^4.17.0:
  version "4.17.21"
      `
      expect(lockSrcIncludes(createEnvDetails('bun'), lockSrc, 'lodash', 'bun.lockb')).toBe(true)
    })

    it('uses vlt format for vlt agent', () => {
      const lockSrc = `{ "lodash": "4.17.21" }`
      expect(lockSrcIncludes(createEnvDetails('vlt'), lockSrc, 'lodash')).toBe(true)
    })

    it('defaults to npm format for unknown agent', () => {
      const lockSrc = `{ "lodash": { "version": "4.17.21" } }`
      expect(lockSrcIncludes(createEnvDetails('unknown'), lockSrc, 'lodash')).toBe(true)
    })
  })
})
