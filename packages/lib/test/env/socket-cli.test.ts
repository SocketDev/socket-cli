/**
 * @fileoverview Unit tests for Socket CLI environment variable getters.
 *
 * Tests getSocketCli() for Socket CLI detection and configuration.
 * Returns SOCKET_CLI value or undefined. Used to detect CLI environment.
 * Uses rewire for test isolation. Critical for CLI vs programmatic API behavior.
 */

import {
  getSocketCliAcceptRisks,
  getSocketCliApiBaseUrl,
  getSocketCliApiProxy,
  getSocketCliApiTimeout,
  getSocketCliApiToken,
  getSocketCliConfig,
  getSocketCliFix,
  getSocketCliGithubToken,
  getSocketCliNoApiToken,
  getSocketCliOptimize,
  getSocketCliOrgSlug,
  getSocketCliViewAllRisks,
} from '@socketsecurity/lib/env/socket-cli'
import { resetEnv, setEnv } from '@socketsecurity/lib/env/rewire'
import { afterEach, describe, expect, it } from 'vitest'

describe('socket-cli env', () => {
  afterEach(() => {
    resetEnv()
  })

  describe('getSocketCliAcceptRisks', () => {
    it('should return true when set to truthy value', () => {
      setEnv('SOCKET_CLI_ACCEPT_RISKS', '1')
      expect(getSocketCliAcceptRisks()).toBe(true)

      setEnv('SOCKET_CLI_ACCEPT_RISKS', 'true')
      expect(getSocketCliAcceptRisks()).toBe(true)
    })

    it('should return false when unset or falsy', () => {
      setEnv('SOCKET_CLI_ACCEPT_RISKS', '')
      expect(getSocketCliAcceptRisks()).toBe(false)

      setEnv('SOCKET_CLI_ACCEPT_RISKS', undefined)
      expect(getSocketCliAcceptRisks()).toBe(false)
    })
  })

  describe('getSocketCliApiBaseUrl', () => {
    it('should return URL when set', () => {
      setEnv('SOCKET_CLI_API_BASE_URL', 'https://api.socket.dev')
      expect(getSocketCliApiBaseUrl()).toBe('https://api.socket.dev')
    })

    it('should return undefined when not set', () => {
      setEnv('SOCKET_CLI_API_BASE_URL', undefined)
      expect(getSocketCliApiBaseUrl()).toBeUndefined()
    })
  })

  describe('getSocketCliApiProxy', () => {
    it('should return proxy URL when set', () => {
      setEnv('SOCKET_CLI_API_PROXY', 'http://proxy.example.com:8080')
      expect(getSocketCliApiProxy()).toBe('http://proxy.example.com:8080')
    })

    it('should return undefined when not set', () => {
      setEnv('SOCKET_CLI_API_PROXY', undefined)
      expect(getSocketCliApiProxy()).toBeUndefined()
    })
  })

  describe('getSocketCliApiTimeout', () => {
    it('should return timeout number when set', () => {
      setEnv('SOCKET_CLI_API_TIMEOUT', '30000')
      expect(getSocketCliApiTimeout()).toBe(30_000)
    })

    it('should return 0 when not set', () => {
      setEnv('SOCKET_CLI_API_TIMEOUT', undefined)
      expect(getSocketCliApiTimeout()).toBe(0)
    })

    it('should handle invalid numbers', () => {
      setEnv('SOCKET_CLI_API_TIMEOUT', 'invalid')
      expect(getSocketCliApiTimeout()).toBe(0)
    })
  })

  describe('getSocketCliApiToken', () => {
    it('should return token when set', () => {
      setEnv('SOCKET_CLI_API_TOKEN', 'test-token-123')
      expect(getSocketCliApiToken()).toBe('test-token-123')
    })

    it('should return undefined when not set', () => {
      setEnv('SOCKET_CLI_API_TOKEN', undefined)
      expect(getSocketCliApiToken()).toBeUndefined()
    })
  })

  describe('getSocketCliConfig', () => {
    it('should return config path when set', () => {
      setEnv('SOCKET_CLI_CONFIG', '/path/to/config.json')
      expect(getSocketCliConfig()).toBe('/path/to/config.json')
    })

    it('should return undefined when not set', () => {
      setEnv('SOCKET_CLI_CONFIG', undefined)
      expect(getSocketCliConfig()).toBeUndefined()
    })
  })

  describe('getSocketCliFix', () => {
    it('should return fix mode when set', () => {
      setEnv('SOCKET_CLI_FIX', 'auto')
      expect(getSocketCliFix()).toBe('auto')
    })

    it('should return undefined when not set', () => {
      setEnv('SOCKET_CLI_FIX', undefined)
      expect(getSocketCliFix()).toBeUndefined()
    })
  })

  describe('getSocketCliGithubToken', () => {
    it('should return GitHub token when set', () => {
      setEnv('SOCKET_CLI_GITHUB_TOKEN', 'ghp_test123')
      expect(getSocketCliGithubToken()).toBe('ghp_test123')
    })

    it('should return undefined when not set', () => {
      setEnv('SOCKET_CLI_GITHUB_TOKEN', undefined)
      expect(getSocketCliGithubToken()).toBeUndefined()
    })
  })

  describe('getSocketCliNoApiToken', () => {
    it('should return true when set to truthy value', () => {
      setEnv('SOCKET_CLI_NO_API_TOKEN', '1')
      expect(getSocketCliNoApiToken()).toBe(true)
    })

    it('should return false when unset or falsy', () => {
      setEnv('SOCKET_CLI_NO_API_TOKEN', '')
      expect(getSocketCliNoApiToken()).toBe(false)
    })
  })

  describe('getSocketCliOptimize', () => {
    it('should return true when set to truthy value', () => {
      setEnv('SOCKET_CLI_OPTIMIZE', '1')
      expect(getSocketCliOptimize()).toBe(true)
    })

    it('should return false when unset or falsy', () => {
      setEnv('SOCKET_CLI_OPTIMIZE', '')
      expect(getSocketCliOptimize()).toBe(false)
    })
  })

  describe('getSocketCliOrgSlug', () => {
    it('should return org slug when set', () => {
      setEnv('SOCKET_CLI_ORG_SLUG', 'my-org')
      expect(getSocketCliOrgSlug()).toBe('my-org')
    })

    it('should return undefined when not set', () => {
      setEnv('SOCKET_CLI_ORG_SLUG', undefined)
      expect(getSocketCliOrgSlug()).toBeUndefined()
    })
  })

  describe('getSocketCliViewAllRisks', () => {
    it('should return true when set to truthy value', () => {
      setEnv('SOCKET_CLI_VIEW_ALL_RISKS', '1')
      expect(getSocketCliViewAllRisks()).toBe(true)
    })

    it('should return false when unset or falsy', () => {
      setEnv('SOCKET_CLI_VIEW_ALL_RISKS', '')
      expect(getSocketCliViewAllRisks()).toBe(false)
    })
  })
})
