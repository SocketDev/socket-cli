/**
 * @fileoverview Unit tests for NPM environment variable getters.
 *
 * Tests npm-specific environment variable accessors:
 * - getNpmConfigRegistry() - npm registry URL (npm_config_registry)
 * - getNpmConfigUserAgent() - npm user agent string
 * - getNpmLifecycleEvent() - current lifecycle hook (preinstall, install, etc.)
 * - getNpmRegistry() - registry URL
 * - getNpmToken() - npm authentication token
 * Uses rewire for test isolation. Critical for npm integration and package publishing.
 */

import {
  getNpmConfigRegistry,
  getNpmConfigUserAgent,
  getNpmLifecycleEvent,
  getNpmRegistry,
  getNpmToken,
} from '@socketsecurity/lib/env/npm'
import { resetEnv, setEnv } from '@socketsecurity/lib/env/rewire'
import { afterEach, describe, expect, it } from 'vitest'

describe('npm env', () => {
  afterEach(() => {
    resetEnv()
  })

  describe('getNpmConfigRegistry', () => {
    it('should return registry URL when set', () => {
      setEnv('npm_config_registry', 'https://registry.npmjs.org/')
      expect(getNpmConfigRegistry()).toBe('https://registry.npmjs.org/')
    })

    it('should return undefined when not set', () => {
      setEnv('npm_config_registry', undefined)
      expect(getNpmConfigRegistry()).toBeUndefined()
    })
  })

  describe('getNpmConfigUserAgent', () => {
    it('should return user agent for npm', () => {
      setEnv('npm_config_user_agent', 'npm/8.19.2 node/v18.12.0 darwin arm64')
      expect(getNpmConfigUserAgent()).toBe(
        'npm/8.19.2 node/v18.12.0 darwin arm64',
      )
    })

    it('should return user agent for pnpm', () => {
      setEnv(
        'npm_config_user_agent',
        'pnpm/7.14.0 npm/? node/v18.12.0 darwin arm64',
      )
      expect(getNpmConfigUserAgent()).toBe(
        'pnpm/7.14.0 npm/? node/v18.12.0 darwin arm64',
      )
    })

    it('should return user agent for yarn', () => {
      setEnv(
        'npm_config_user_agent',
        'yarn/1.22.19 npm/? node/v18.12.0 darwin arm64',
      )
      expect(getNpmConfigUserAgent()).toBe(
        'yarn/1.22.19 npm/? node/v18.12.0 darwin arm64',
      )
    })

    it('should return undefined when not set', () => {
      setEnv('npm_config_user_agent', undefined)
      expect(getNpmConfigUserAgent()).toBeUndefined()
    })
  })

  describe('getNpmLifecycleEvent', () => {
    it('should return lifecycle event when set', () => {
      setEnv('npm_lifecycle_event', 'test')
      expect(getNpmLifecycleEvent()).toBe('test')
    })

    it('should return lifecycle event for postinstall', () => {
      setEnv('npm_lifecycle_event', 'postinstall')
      expect(getNpmLifecycleEvent()).toBe('postinstall')
    })

    it('should return undefined when not set', () => {
      setEnv('npm_lifecycle_event', undefined)
      expect(getNpmLifecycleEvent()).toBeUndefined()
    })
  })

  describe('getNpmRegistry', () => {
    it('should return registry URL when set', () => {
      setEnv('NPM_REGISTRY', 'https://registry.npmjs.org')
      expect(getNpmRegistry()).toBe('https://registry.npmjs.org')
    })

    it('should return undefined when not set', () => {
      setEnv('NPM_REGISTRY', undefined)
      expect(getNpmRegistry()).toBeUndefined()
    })
  })

  describe('getNpmToken', () => {
    it('should return NPM token when set', () => {
      setEnv('NPM_TOKEN', 'npm_test_token_123')
      expect(getNpmToken()).toBe('npm_test_token_123')
    })

    it('should return undefined when not set', () => {
      setEnv('NPM_TOKEN', undefined)
      expect(getNpmToken()).toBeUndefined()
    })
  })
})
