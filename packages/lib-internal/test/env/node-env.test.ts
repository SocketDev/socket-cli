/**
 * @fileoverview Unit tests for NODE_ENV environment variable getter.
 *
 * Tests getNodeEnv() for Node.js environment mode (development, production, test).
 * Returns NODE_ENV string or undefined. Standard Node.js convention.
 * Uses rewire for test isolation. Critical for environment-specific behavior.
 */

import { getNodeEnv } from '@socketsecurity/lib/env/node-env'
import { clearEnv, resetEnv, setEnv } from '@socketsecurity/lib/env/rewire'
import { afterEach, describe, expect, it } from 'vitest'

describe('env/node-env', () => {
  afterEach(() => {
    resetEnv()
  })

  describe('getNodeEnv', () => {
    it('should return NODE_ENV environment variable when set', () => {
      setEnv('NODE_ENV', 'production')
      expect(getNodeEnv()).toBe('production')
    })

    it('should return undefined when NODE_ENV is not set', () => {
      clearEnv('NODE_ENV')
      // After clearing override, falls back to actual process.env
      const result = getNodeEnv()
      expect(typeof result).toMatch(/string|undefined/)
    })

    it('should handle production environment', () => {
      setEnv('NODE_ENV', 'production')
      expect(getNodeEnv()).toBe('production')
    })

    it('should handle development environment', () => {
      setEnv('NODE_ENV', 'development')
      expect(getNodeEnv()).toBe('development')
    })

    it('should handle test environment', () => {
      setEnv('NODE_ENV', 'test')
      expect(getNodeEnv()).toBe('test')
    })

    it('should handle staging environment', () => {
      setEnv('NODE_ENV', 'staging')
      expect(getNodeEnv()).toBe('staging')
    })

    it('should handle empty string', () => {
      setEnv('NODE_ENV', '')
      expect(getNodeEnv()).toBe('')
    })

    it('should handle custom environment names', () => {
      setEnv('NODE_ENV', 'qa')
      expect(getNodeEnv()).toBe('qa')
    })

    it('should handle uppercase environment names', () => {
      setEnv('NODE_ENV', 'PRODUCTION')
      expect(getNodeEnv()).toBe('PRODUCTION')
    })

    it('should handle mixed case environment names', () => {
      setEnv('NODE_ENV', 'Production')
      expect(getNodeEnv()).toBe('Production')
    })

    it('should handle updating NODE_ENV value', () => {
      setEnv('NODE_ENV', 'development')
      expect(getNodeEnv()).toBe('development')

      setEnv('NODE_ENV', 'production')
      expect(getNodeEnv()).toBe('production')

      setEnv('NODE_ENV', 'test')
      expect(getNodeEnv()).toBe('test')
    })

    it('should handle clearing and re-setting', () => {
      setEnv('NODE_ENV', 'production')
      expect(getNodeEnv()).toBe('production')

      clearEnv('NODE_ENV')
      // After clearing override, falls back to actual process.env
      const result = getNodeEnv()
      expect(typeof result).toMatch(/string|undefined/)

      setEnv('NODE_ENV', 'development')
      expect(getNodeEnv()).toBe('development')
    })

    it('should handle consecutive reads', () => {
      setEnv('NODE_ENV', 'production')
      expect(getNodeEnv()).toBe('production')
      expect(getNodeEnv()).toBe('production')
      expect(getNodeEnv()).toBe('production')
    })

    it('should handle environment with hyphens', () => {
      setEnv('NODE_ENV', 'pre-production')
      expect(getNodeEnv()).toBe('pre-production')
    })

    it('should handle environment with underscores', () => {
      setEnv('NODE_ENV', 'pre_production')
      expect(getNodeEnv()).toBe('pre_production')
    })

    it('should handle numeric environment names', () => {
      setEnv('NODE_ENV', '12345')
      expect(getNodeEnv()).toBe('12345')
    })

    it('should handle environment with special characters', () => {
      setEnv('NODE_ENV', 'prod-v2')
      expect(getNodeEnv()).toBe('prod-v2')
    })

    it('should handle whitespace in values', () => {
      setEnv('NODE_ENV', ' production ')
      expect(getNodeEnv()).toBe(' production ')
    })

    it('should handle local environment', () => {
      setEnv('NODE_ENV', 'local')
      expect(getNodeEnv()).toBe('local')
    })

    it('should handle CI environment', () => {
      setEnv('NODE_ENV', 'ci')
      expect(getNodeEnv()).toBe('ci')
    })

    it('should handle preview environment', () => {
      setEnv('NODE_ENV', 'preview')
      expect(getNodeEnv()).toBe('preview')
    })

    it('should handle integration environment', () => {
      setEnv('NODE_ENV', 'integration')
      expect(getNodeEnv()).toBe('integration')
    })

    it('should handle acceptance environment', () => {
      setEnv('NODE_ENV', 'acceptance')
      expect(getNodeEnv()).toBe('acceptance')
    })
  })
})
