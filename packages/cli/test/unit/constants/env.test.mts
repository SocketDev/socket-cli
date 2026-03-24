/**
 * Unit tests for environment constants module.
 *
 * Purpose:
 * Tests environment variable re-exports and the ENV proxy behavior.
 *
 * Test Coverage:
 * - Environment variable re-exports
 * - ENV proxy behavior in VITEST mode
 * - processEnv export
 * - Build metadata getters
 *
 * Related Files:
 * - src/constants/env.mts (implementation)
 */

import process from 'node:process'

import { describe, expect, it } from 'vitest'

import {
  CI,
  ENV,
  getCdxgenVersion,
  getCliHomepage,
  getCliName,
  getCliVersion,
  getCliVersionHash,
  getCoanaVersion,
  getPyCliVersion,
  getPythonBuildTag,
  getPythonVersion,
  getSocketPatchVersion,
  getSynpVersion,
  HOME,
  isPublishedBuild,
  isSentryBuild,
  processEnv,
  SOCKET_CLI_DEBUG,
  VITEST,
} from '../../../src/constants/env.mts'

describe('constants/env', () => {
  describe('environment variable re-exports', () => {
    it('exports CI', () => {
      // CI should be defined (boolean or undefined).
      expect(typeof CI === 'boolean' || CI === undefined).toBe(true)
    })

    it('exports HOME', () => {
      // HOME should be a string or undefined.
      expect(typeof HOME === 'string' || HOME === undefined).toBe(true)
    })

    it('exports VITEST', () => {
      // VITEST should be true in test environment.
      expect(VITEST).toBe(true)
    })

    it('exports SOCKET_CLI_DEBUG', () => {
      // SOCKET_CLI_DEBUG should be a boolean or undefined.
      expect(
        typeof SOCKET_CLI_DEBUG === 'boolean' || SOCKET_CLI_DEBUG === undefined,
      ).toBe(true)
    })
  })

  describe('processEnv export', () => {
    it('exports process.env reference', () => {
      expect(processEnv).toBe(process.env)
    })

    it('allows reading environment variables', () => {
      // PATH should exist in process.env.
      expect(typeof processEnv['PATH']).toBe('string')
    })
  })

  describe('build metadata getters', () => {
    it('getCdxgenVersion returns a string', () => {
      const version = getCdxgenVersion()
      expect(typeof version).toBe('string')
    })

    it('getCliHomepage returns a string', () => {
      const homepage = getCliHomepage()
      expect(typeof homepage).toBe('string')
    })

    it('getCliName returns a string', () => {
      const name = getCliName()
      expect(typeof name).toBe('string')
      expect(name.length).toBeGreaterThan(0)
    })

    it('getCliVersion returns a string', () => {
      const version = getCliVersion()
      expect(typeof version).toBe('string')
    })

    it('getCliVersionHash returns a string', () => {
      const hash = getCliVersionHash()
      expect(typeof hash).toBe('string')
    })

    it('getCoanaVersion returns a string', () => {
      const version = getCoanaVersion()
      expect(typeof version).toBe('string')
    })

    it('getPyCliVersion returns a string', () => {
      const version = getPyCliVersion()
      expect(typeof version).toBe('string')
    })

    it('getPythonBuildTag returns a string', () => {
      const tag = getPythonBuildTag()
      expect(typeof tag).toBe('string')
    })

    it('getPythonVersion returns a string', () => {
      const version = getPythonVersion()
      expect(typeof version).toBe('string')
    })

    it('getSocketPatchVersion returns a string', () => {
      const version = getSocketPatchVersion()
      expect(typeof version).toBe('string')
    })

    it('getSynpVersion returns a string', () => {
      const version = getSynpVersion()
      expect(typeof version).toBe('string')
    })

    it('isPublishedBuild returns a boolean', () => {
      expect(typeof isPublishedBuild()).toBe('boolean')
    })

    it('isSentryBuild returns a boolean', () => {
      expect(typeof isSentryBuild()).toBe('boolean')
    })
  })

  describe('ENV proxy', () => {
    it('is an object', () => {
      expect(typeof ENV).toBe('object')
    })

    it('provides access to VITEST', () => {
      // In test env, VITEST comes from process.env and is a string 'true'.
      expect(ENV.VITEST).toBeTruthy()
    })

    it('allows reading env variables via get trap', () => {
      // In VITEST mode, the proxy should read from process.env.
      const pathValue = ENV['PATH' as keyof typeof ENV]
      expect(typeof pathValue).toBe('string')
    })

    it('allows checking property existence via has trap', () => {
      expect('VITEST' in ENV).toBe(true)
      expect('HOME' in ENV).toBe(true)
    })

    it('returns own keys via ownKeys trap', () => {
      const keys = Object.keys(ENV)
      expect(Array.isArray(keys)).toBe(true)
      expect(keys.length).toBeGreaterThan(0)
    })

    it('returns property descriptors via getOwnPropertyDescriptor trap', () => {
      const descriptor = Object.getOwnPropertyDescriptor(ENV, 'VITEST')
      expect(descriptor).toBeDefined()
      // In test env, VITEST comes from process.env and is a string 'true'.
      expect(descriptor?.value).toBeTruthy()
    })

    it('allows setting values in VITEST mode via set trap', () => {
      const testKey = 'TEST_ENV_VAR_FOR_TESTING'
      const originalValue = process.env[testKey]

      // Set value via ENV proxy.
      ;(ENV as any)[testKey] = 'test-value'

      // Verify it was set in process.env.
      expect(process.env[testKey]).toBe('test-value')

      // Clean up.
      if (originalValue === undefined) {
        delete process.env[testKey]
      } else {
        process.env[testKey] = originalValue
      }
    })

    it('includes INLINED_* properties from snapshot', () => {
      const keys = Object.keys(ENV)
      const inlinedKeys = keys.filter(k => k.startsWith('INLINED_'))
      // Should have some inlined keys from the build metadata.
      expect(inlinedKeys.length).toBeGreaterThan(0)
    })

    it('provides access to INLINED_NAME', () => {
      const name = ENV.INLINED_NAME
      expect(typeof name).toBe('string')
      expect(name.length).toBeGreaterThan(0)
    })

    it('provides access to INLINED_VERSION', () => {
      const version = ENV.INLINED_VERSION
      expect(typeof version).toBe('string')
    })
  })
})
