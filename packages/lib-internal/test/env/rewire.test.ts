/**
 * @fileoverview Unit tests for environment variable rewiring system.
 *
 * Tests the rewire module that enables test-time environment variable overrides:
 * - setEnv() / clearEnv() - override env vars without modifying process.env
 * - resetEnv() - clear all overrides (use in afterEach)
 * - hasOverride() - check if an env var has a test override
 * Allows isolated env var testing without polluting global process.env state.
 * Critical for reliable, parallel test execution without env var conflicts.
 */

import { getCI } from '@socketsecurity/lib/env/ci'
import { getHome } from '@socketsecurity/lib/env/home'
import { getSocketDebug } from '@socketsecurity/lib/env/socket'
import {
  clearEnv,
  hasOverride,
  resetEnv,
  setEnv,
} from '@socketsecurity/lib/env/rewire'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

describe('env rewiring', () => {
  // Clean up after each test to avoid state leakage
  afterEach(() => {
    resetEnv()
  })

  describe('setEnv() and clearEnv()', () => {
    it('should override environment variable', () => {
      // Set override
      setEnv('HOME', '/custom/home')

      expect(getHome()).toBe('/custom/home')
      expect(hasOverride('HOME')).toBe(true)
    })

    it('should clear override and return to real value', () => {
      const originalHome = process.env.HOME

      setEnv('HOME', '/custom/home')
      expect(getHome()).toBe('/custom/home')

      clearEnv('HOME')
      expect(getHome()).toBe(originalHome)
      expect(hasOverride('HOME')).toBe(false)
    })

    it('should override boolean env vars', () => {
      // Override CI to true
      setEnv('CI', '1')
      expect(getCI()).toBe(true)

      // Override CI to false
      setEnv('CI', '')
      expect(getCI()).toBe(false)
    })

    it('should allow undefined overrides', () => {
      setEnv('SOCKET_DEBUG', undefined)
      expect(getSocketDebug()).toBeUndefined()
      expect(hasOverride('SOCKET_DEBUG')).toBe(true)
    })
  })

  describe('resetEnv()', () => {
    it('should clear all overrides', () => {
      setEnv('HOME', '/custom/home')
      setEnv('CI', '1')
      setEnv('SOCKET_DEBUG', 'test')

      expect(hasOverride('HOME')).toBe(true)
      expect(hasOverride('CI')).toBe(true)
      expect(hasOverride('SOCKET_DEBUG')).toBe(true)

      resetEnv()

      expect(hasOverride('HOME')).toBe(false)
      expect(hasOverride('CI')).toBe(false)
      expect(hasOverride('SOCKET_DEBUG')).toBe(false)
    })
  })

  describe.sequential('isolated test scenarios', () => {
    beforeEach(() => {
      resetEnv()
    })

    it('test 1: should run with CI=true', () => {
      setEnv('CI', 'true')
      expect(getCI()).toBe(true)
    })

    it('test 2: should run with CI=false', () => {
      setEnv('CI', 'false')
      expect(getCI()).toBe(false)
    })

    it('test 3: should not be affected by previous tests', () => {
      // This test should see the real CI value, not overrides from previous tests
      expect(hasOverride('CI')).toBe(false)
    })
  })

  describe('real-world usage patterns', () => {
    it('should simulate CI environment for testing', () => {
      // Test code behavior in CI
      setEnv('CI', '1')
      setEnv('GITHUB_REPOSITORY', 'owner/repo')

      expect(getCI()).toBe(true)
      // Test code that behaves differently in CI...
    })

    it('should test with custom home directory', () => {
      setEnv('HOME', '/tmp/test-home')

      expect(getHome()).toBe('/tmp/test-home')
      // Test code that uses home directory...
    })

    it('should test debug mode behavior', () => {
      setEnv('SOCKET_DEBUG', 'socket:*')

      expect(getSocketDebug()).toBe('socket:*')
      // Test debug logging behavior...
    })
  })

  describe('multiple simultaneous overrides', () => {
    it('should handle multiple overrides independently', () => {
      setEnv('HOME', '/custom/home')
      setEnv('CI', '1')
      setEnv('SOCKET_DEBUG', 'test')

      expect(getHome()).toBe('/custom/home')
      expect(getCI()).toBe(true)
      expect(getSocketDebug()).toBe('test')

      // Clear one override
      clearEnv('CI')

      // Others remain
      expect(getHome()).toBe('/custom/home')
      expect(getSocketDebug()).toBe('test')
      // CI returns to real value
      expect(hasOverride('CI')).toBe(false)
    })
  })
})
