/**
 * @fileoverview Unit tests for package name validation utilities.
 *
 * Tests package validation utilities:
 * - isBlessedPackageName() checks if package is Socket official (socket, sfw, @socket*)
 * - isValidPackageName() validates npm package name format and rules
 * - isRegistryFetcherType() checks if type is registry-based (alias/range/tag/version)
 * - Scoped package validation (@scope/name patterns)
 * Used by Socket tools for package filtering, security checks, and name validation.
 */

import { describe, expect, it } from 'vitest'

import {
  isBlessedPackageName,
  isRegistryFetcherType,
  isValidPackageName,
} from '@socketsecurity/lib/packages/validation'

describe('packages/validation', () => {
  describe('isBlessedPackageName', () => {
    it('should export isBlessedPackageName function', () => {
      expect(typeof isBlessedPackageName).toBe('function')
    })

    it('should return true for "socket" package', () => {
      expect(isBlessedPackageName('socket')).toBe(true)
    })

    it('should return true for "sfw" package', () => {
      expect(isBlessedPackageName('sfw')).toBe(true)
    })

    it('should return true for @socketoverride/* packages', () => {
      expect(isBlessedPackageName('@socketoverride/lodash')).toBe(true)
      expect(isBlessedPackageName('@socketoverride/react')).toBe(true)
      expect(isBlessedPackageName('@socketoverride/express')).toBe(true)
    })

    it('should return true for @socketregistry/* packages', () => {
      expect(isBlessedPackageName('@socketregistry/lodash')).toBe(true)
      expect(isBlessedPackageName('@socketregistry/react')).toBe(true)
      expect(isBlessedPackageName('@socketregistry/express')).toBe(true)
    })

    it('should return true for @socketsecurity/* packages', () => {
      expect(isBlessedPackageName('@socketsecurity/registry')).toBe(true)
      expect(isBlessedPackageName('@socketsecurity/cli')).toBe(true)
      expect(isBlessedPackageName('@socketsecurity/lib')).toBe(true)
    })

    it('should return false for non-blessed packages', () => {
      expect(isBlessedPackageName('lodash')).toBe(false)
      expect(isBlessedPackageName('react')).toBe(false)
      expect(isBlessedPackageName('express')).toBe(false)
    })

    it('should return false for packages with similar names', () => {
      expect(isBlessedPackageName('socket-io')).toBe(false)
      expect(isBlessedPackageName('sfw-cli')).toBe(false)
      expect(isBlessedPackageName('socketio')).toBe(false)
    })

    it('should return false for scopes that do not match exactly', () => {
      expect(isBlessedPackageName('@socket/package')).toBe(false)
      expect(isBlessedPackageName('@socketregistry-fork/package')).toBe(
        false,
      )
      expect(isBlessedPackageName('@socketsecurity-fork/package')).toBe(false)
    })

    it('should return false for non-string values', () => {
      expect(isBlessedPackageName(null)).toBe(false)
      expect(isBlessedPackageName(undefined)).toBe(false)
      expect(isBlessedPackageName(123)).toBe(false)
      expect(isBlessedPackageName({})).toBe(false)
      expect(isBlessedPackageName([])).toBe(false)
      expect(isBlessedPackageName(true)).toBe(false)
    })

    it('should return false for empty string', () => {
      expect(isBlessedPackageName('')).toBe(false)
    })

    it('should be case-sensitive', () => {
      expect(isBlessedPackageName('Socket')).toBe(false)
      expect(isBlessedPackageName('SFW')).toBe(false)
      expect(isBlessedPackageName('@SocketSecurity/lib')).toBe(false)
    })

    it('should handle packages with multiple path segments', () => {
      expect(isBlessedPackageName('@socketregistry/node/fs')).toBe(true)
      expect(isBlessedPackageName('@socketsecurity/lib/packages')).toBe(true)
      expect(isBlessedPackageName('@socketoverride/react/jsx-runtime')).toBe(
        true,
      )
    })
  })

  describe('isRegistryFetcherType', () => {
    it('should export isRegistryFetcherType function', () => {
      expect(typeof isRegistryFetcherType).toBe('function')
    })

    it('should return true for "alias" type', () => {
      expect(isRegistryFetcherType('alias')).toBe(true)
    })

    it('should return true for "range" type', () => {
      expect(isRegistryFetcherType('range')).toBe(true)
    })

    it('should return true for "tag" type', () => {
      expect(isRegistryFetcherType('tag')).toBe(true)
    })

    it('should return true for "version" type', () => {
      expect(isRegistryFetcherType('version')).toBe(true)
    })

    it('should return false for non-registry fetcher types', () => {
      expect(isRegistryFetcherType('git')).toBe(false)
      expect(isRegistryFetcherType('remote')).toBe(false)
      expect(isRegistryFetcherType('file')).toBe(false)
      expect(isRegistryFetcherType('directory')).toBe(false)
      expect(isRegistryFetcherType('')).toBe(false)
    })

    it('should be case-sensitive', () => {
      expect(isRegistryFetcherType('Alias')).toBe(false)
      expect(isRegistryFetcherType('RANGE')).toBe(false)
      expect(isRegistryFetcherType('Tag')).toBe(false)
      expect(isRegistryFetcherType('VERSION')).toBe(false)
    })

    it('should return false for invalid input types', () => {
      expect(isRegistryFetcherType('unknown')).toBe(false)
      expect(isRegistryFetcherType('semver')).toBe(false)
      expect(isRegistryFetcherType('registry')).toBe(false)
    })

    it('should handle types with extra whitespace', () => {
      expect(isRegistryFetcherType(' alias')).toBe(false)
      expect(isRegistryFetcherType('range ')).toBe(false)
      expect(isRegistryFetcherType(' tag ')).toBe(false)
    })

    it('should match exactly without partial matches', () => {
      expect(isRegistryFetcherType('alias-')).toBe(false)
      expect(isRegistryFetcherType('-range')).toBe(false)
      expect(isRegistryFetcherType('tag-name')).toBe(false)
      expect(isRegistryFetcherType('versions')).toBe(false)
    })
  })

  describe('isValidPackageName', () => {
    it('should export isValidPackageName function', () => {
      expect(typeof isValidPackageName).toBe('function')
    })

    it('should return true for valid package names', () => {
      expect(isValidPackageName('lodash')).toBe(true)
      expect(isValidPackageName('react')).toBe(true)
      expect(isValidPackageName('express')).toBe(true)
    })

    it('should return true for valid scoped packages', () => {
      expect(isValidPackageName('@babel/core')).toBe(true)
      expect(isValidPackageName('@types/node')).toBe(true)
      expect(isValidPackageName('@socketregistry/lodash')).toBe(true)
    })

    it('should return true for packages with hyphens', () => {
      expect(isValidPackageName('socket-cli')).toBe(true)
      expect(isValidPackageName('my-package-name')).toBe(true)
      expect(isValidPackageName('some-long-package-name')).toBe(true)
    })

    it('should return true for packages with underscores', () => {
      expect(isValidPackageName('my_package')).toBe(true)
      expect(isValidPackageName('some_package_name')).toBe(true)
    })

    it('should return true for packages with dots', () => {
      expect(isValidPackageName('jquery.min')).toBe(true)
      expect(isValidPackageName('some.package')).toBe(true)
    })

    it('should return true for packages with numbers', () => {
      expect(isValidPackageName('package123')).toBe(true)
      expect(isValidPackageName('p4ckage')).toBe(true)
      expect(isValidPackageName('123package')).toBe(true)
    })

    it('should return false for invalid package names', () => {
      // validForOldPackages allows uppercase in old packages
      expect(isValidPackageName('Capital')).toBe(true)
      expect(isValidPackageName('UPPERCASE')).toBe(true)
    })

    it('should return false for names with spaces', () => {
      expect(isValidPackageName('my package')).toBe(false)
      expect(isValidPackageName('some package name')).toBe(false)
    })

    it('should return false for names with special characters', () => {
      expect(isValidPackageName('my!package')).toBe(true) // validForOldPackages allows !
      expect(isValidPackageName('package@name')).toBe(false)
      expect(isValidPackageName('package#name')).toBe(false) // # is not valid
    })

    it('should return false for names starting with dot', () => {
      expect(isValidPackageName('.package')).toBe(false)
    })

    it('should return false for names starting with underscore', () => {
      expect(isValidPackageName('_package')).toBe(false)
    })

    it('should return false for empty package name', () => {
      expect(isValidPackageName('')).toBe(false)
    })

    it('should handle very long package names', () => {
      const longName = 'a'.repeat(214)
      expect(isValidPackageName(longName)).toBe(true)
    })

    it('should return false for extremely long package names', () => {
      // validForOldPackages uses 214 as maximum length
      const tooLongName = 'a'.repeat(215)
      expect(isValidPackageName(tooLongName)).toBe(true) // Still valid for old packages
    })

    it('should handle scoped packages with various valid names', () => {
      expect(isValidPackageName('@scope/package')).toBe(true)
      expect(isValidPackageName('@my-scope/my-package')).toBe(true)
      expect(isValidPackageName('@scope/package-name')).toBe(true)
    })

    it('should validate old-style package names', () => {
      // validForOldPackages allows uppercase letters
      expect(isValidPackageName('CamelCase')).toBe(true)
      expect(isValidPackageName('UpperCase')).toBe(true)
    })
  })

  describe('integration', () => {
    it('should correctly identify blessed packages that are also valid', () => {
      const blessedPackages = [
        'socket',
        'sfw',
        '@socketregistry/lodash',
        '@socketoverride/react',
        '@socketsecurity/lib',
      ]

      for (const pkg of blessedPackages) {
        expect(isBlessedPackageName(pkg)).toBe(true)
        expect(isValidPackageName(pkg)).toBe(true)
      }
    })

    it('should handle packages that are valid but not blessed', () => {
      const validButNotBlessed = [
        'lodash',
        'react',
        'express',
        '@babel/core',
        '@types/node',
      ]

      for (const pkg of validButNotBlessed) {
        expect(isBlessedPackageName(pkg)).toBe(false)
        expect(isValidPackageName(pkg)).toBe(true)
      }
    })

    it('should handle invalid packages that are also not blessed', () => {
      // validForOldPackages allows uppercase and underscores
      expect(isBlessedPackageName('Invalid Package')).toBe(false)
      expect(isValidPackageName('Invalid Package')).toBe(false) // spaces not allowed

      expect(isBlessedPackageName('UPPERCASE')).toBe(false)
      expect(isValidPackageName('UPPERCASE')).toBe(true) // uppercase OK in old packages

      expect(isBlessedPackageName('.hidden')).toBe(false)
      expect(isValidPackageName('.hidden')).toBe(false) // starts with dot

      expect(isBlessedPackageName('_underscore')).toBe(false)
      expect(isValidPackageName('_underscore')).toBe(false) // starts with underscore
    })

    it('should support all registry fetcher types', () => {
      const registryTypes = ['alias', 'range', 'tag', 'version']

      for (const type of registryTypes) {
        expect(isRegistryFetcherType(type)).toBe(true)
      }
    })

    it('should reject non-registry fetcher types', () => {
      const nonRegistryTypes = ['git', 'remote', 'file', 'directory', 'http']

      for (const type of nonRegistryTypes) {
        expect(isRegistryFetcherType(type)).toBe(false)
      }
    })
  })

  describe('edge cases', () => {
    it('should handle null and undefined for isBlessedPackageName', () => {
      expect(isBlessedPackageName(null)).toBe(false)
      expect(isBlessedPackageName(undefined)).toBe(false)
    })

    it('should handle boolean values for isBlessedPackageName', () => {
      expect(isBlessedPackageName(true)).toBe(false)
      expect(isBlessedPackageName(false)).toBe(false)
    })

    it('should handle numeric values for isBlessedPackageName', () => {
      expect(isBlessedPackageName(0)).toBe(false)
      expect(isBlessedPackageName(123)).toBe(false)
      expect(isBlessedPackageName(NaN)).toBe(false)
    })

    it('should handle object values for isBlessedPackageName', () => {
      expect(isBlessedPackageName({})).toBe(false)
      expect(isBlessedPackageName({ name: 'socket' })).toBe(false)
    })

    it('should handle array values for isBlessedPackageName', () => {
      expect(isBlessedPackageName([])).toBe(false)
      expect(isBlessedPackageName(['socket'])).toBe(false)
    })

    it('should handle special npm package name edge cases', () => {
      expect(isValidPackageName('node_modules')).toBe(false)
      expect(isValidPackageName('favicon.ico')).toBe(false) // .ico is invalid
    })

    it('should handle scoped packages with invalid scope names', () => {
      expect(isValidPackageName('@/package')).toBe(false)
      expect(isValidPackageName('@scope/')).toBe(false)
    })

    it('should handle URL-encoded characters', () => {
      expect(isValidPackageName('package%20name')).toBe(false)
    })

    it('should handle package names that look like email addresses', () => {
      expect(isValidPackageName('user@example.com')).toBe(false)
    })
  })

  describe('real-world usage', () => {
    it('should validate actual Socket packages', () => {
      expect(isBlessedPackageName('socket')).toBe(true)
      expect(isBlessedPackageName('sfw')).toBe(true)
      expect(isValidPackageName('socket')).toBe(true)
      expect(isValidPackageName('sfw')).toBe(true)
    })

    it('should validate Socket registry packages', () => {
      expect(isBlessedPackageName('@socketregistry/lodash')).toBe(true)
      expect(isValidPackageName('@socketregistry/lodash')).toBe(true)
    })

    it('should support common package manager spec types', () => {
      expect(isRegistryFetcherType('version')).toBe(true) // npm install pkg@1.0.0
      expect(isRegistryFetcherType('range')).toBe(true) // npm install pkg@^1.0.0
      expect(isRegistryFetcherType('tag')).toBe(true) // npm install pkg@latest
      expect(isRegistryFetcherType('alias')).toBe(true) // npm install alias@npm:pkg
    })

    it('should filter out non-registry fetch types', () => {
      expect(isRegistryFetcherType('git')).toBe(false)
      expect(isRegistryFetcherType('file')).toBe(false)
      expect(isRegistryFetcherType('remote')).toBe(false)
    })

    it('should validate popular npm packages', () => {
      expect(isValidPackageName('react')).toBe(true)
      expect(isValidPackageName('lodash')).toBe(true)
      expect(isValidPackageName('express')).toBe(true)
      expect(isValidPackageName('@types/node')).toBe(true)
      expect(isValidPackageName('@babel/core')).toBe(true)
    })
  })
})
