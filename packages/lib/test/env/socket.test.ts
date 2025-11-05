/**
 * @fileoverview Unit tests for Socket environment variable getters.
 *
 * Tests Socket-specific environment variable accessors (SOCKET_* prefix):
 * - API config: getSocketApiBaseUrl(), getSocketApiToken(), getSocketApiProxy(), getSocketApiTimeout()
 * - Paths: getSocketHome(), getSocketCacacheDir(), getSocketDlxDirEnv(), getSocketConfig()
 * - Registry: getSocketNpmRegistry(), getSocketRegistryUrl()
 * - Behavior: getSocketDebug(), getSocketAcceptRisks(), getSocketViewAllRisks(), getSocketNoApiToken()
 * - Organization: getSocketOrgSlug()
 * Uses rewire for test isolation. Critical for Socket tool configuration.
 */

import {
  getSocketAcceptRisks,
  getSocketApiBaseUrl,
  getSocketApiProxy,
  getSocketApiTimeout,
  getSocketApiToken,
  getSocketCacacheDir,
  getSocketConfig,
  getSocketDebug,
  getSocketDlxDirEnv,
  getSocketHome,
  getSocketNoApiToken,
  getSocketNpmRegistry,
  getSocketOrgSlug,
  getSocketRegistryUrl,
  getSocketViewAllRisks,
} from '@socketsecurity/lib/env/socket'
import { resetEnv, setEnv } from '@socketsecurity/lib/env/rewire'
import { afterEach, describe, expect, it } from 'vitest'

describe('socket env', () => {
  afterEach(() => {
    resetEnv()
  })

  describe('getSocketAcceptRisks', () => {
    it('should return true when set to truthy value', () => {
      setEnv('SOCKET_ACCEPT_RISKS', '1')
      expect(getSocketAcceptRisks()).toBe(true)

      setEnv('SOCKET_ACCEPT_RISKS', 'true')
      expect(getSocketAcceptRisks()).toBe(true)
    })

    it('should return false when unset or falsy', () => {
      setEnv('SOCKET_ACCEPT_RISKS', '')
      expect(getSocketAcceptRisks()).toBe(false)

      setEnv('SOCKET_ACCEPT_RISKS', undefined)
      expect(getSocketAcceptRisks()).toBe(false)
    })
  })

  describe('getSocketApiBaseUrl', () => {
    it('should return URL when set', () => {
      setEnv('SOCKET_API_BASE_URL', 'https://api.socket.dev')
      expect(getSocketApiBaseUrl()).toBe('https://api.socket.dev')
    })

    it('should return undefined when not set', () => {
      setEnv('SOCKET_API_BASE_URL', undefined)
      expect(getSocketApiBaseUrl()).toBeUndefined()
    })
  })

  describe('getSocketApiProxy', () => {
    it('should return proxy URL when set', () => {
      setEnv('SOCKET_API_PROXY', 'http://proxy.example.com:8080')
      expect(getSocketApiProxy()).toBe('http://proxy.example.com:8080')
    })

    it('should return undefined when not set', () => {
      setEnv('SOCKET_API_PROXY', undefined)
      expect(getSocketApiProxy()).toBeUndefined()
    })
  })

  describe('getSocketApiTimeout', () => {
    it('should return timeout number when set', () => {
      setEnv('SOCKET_API_TIMEOUT', '30000')
      expect(getSocketApiTimeout()).toBe(30_000)
    })

    it('should return 0 when not set', () => {
      setEnv('SOCKET_API_TIMEOUT', undefined)
      expect(getSocketApiTimeout()).toBe(0)
    })

    it('should handle invalid numbers', () => {
      setEnv('SOCKET_API_TIMEOUT', 'invalid')
      expect(getSocketApiTimeout()).toBe(0)
    })
  })

  describe('getSocketApiToken', () => {
    it('should return token when set', () => {
      setEnv('SOCKET_API_TOKEN', 'test-token-123')
      expect(getSocketApiToken()).toBe('test-token-123')
    })

    it('should return undefined when not set', () => {
      setEnv('SOCKET_API_TOKEN', undefined)
      expect(getSocketApiToken()).toBeUndefined()
    })
  })

  describe('getSocketCacacheDir', () => {
    it('should return cacache directory when set', () => {
      setEnv('SOCKET_CACACHE_DIR', '/custom/cacache')
      expect(getSocketCacacheDir()).toBe('/custom/cacache')
    })

    it('should return undefined when not set', () => {
      setEnv('SOCKET_CACACHE_DIR', undefined)
      expect(getSocketCacacheDir()).toBeUndefined()
    })
  })

  describe('getSocketConfig', () => {
    it('should return config path when set', () => {
      setEnv('SOCKET_CONFIG', '/path/to/socket.yml')
      expect(getSocketConfig()).toBe('/path/to/socket.yml')
    })

    it('should return undefined when not set', () => {
      setEnv('SOCKET_CONFIG', undefined)
      expect(getSocketConfig()).toBeUndefined()
    })
  })

  describe('getSocketDebug', () => {
    it('should return debug value when set', () => {
      setEnv('SOCKET_DEBUG', 'api,cache')
      expect(getSocketDebug()).toBe('api,cache')
    })

    it('should return undefined when not set', () => {
      setEnv('SOCKET_DEBUG', undefined)
      expect(getSocketDebug()).toBeUndefined()
    })
  })

  describe('getSocketDlxDirEnv', () => {
    it('should return DLX directory when set', () => {
      setEnv('SOCKET_DLX_DIR', '/custom/dlx')
      expect(getSocketDlxDirEnv()).toBe('/custom/dlx')
    })

    it('should return undefined when not set', () => {
      setEnv('SOCKET_DLX_DIR', undefined)
      expect(getSocketDlxDirEnv()).toBeUndefined()
    })
  })

  describe('getSocketHome', () => {
    it('should return Socket home directory when set', () => {
      setEnv('SOCKET_HOME', '/home/user/.socket')
      expect(getSocketHome()).toBe('/home/user/.socket')
    })

    it('should return undefined when not set', () => {
      setEnv('SOCKET_HOME', undefined)
      expect(getSocketHome()).toBeUndefined()
    })
  })

  describe('getSocketNoApiToken', () => {
    it('should return true when set to truthy value', () => {
      setEnv('SOCKET_NO_API_TOKEN', '1')
      expect(getSocketNoApiToken()).toBe(true)
    })

    it('should return false when unset or falsy', () => {
      setEnv('SOCKET_NO_API_TOKEN', '')
      expect(getSocketNoApiToken()).toBe(false)
    })
  })

  describe('getSocketNpmRegistry', () => {
    it('should return NPM registry URL when set', () => {
      setEnv('SOCKET_NPM_REGISTRY', 'https://registry.socket.dev')
      expect(getSocketNpmRegistry()).toBe('https://registry.socket.dev')
    })

    it('should return undefined when not set', () => {
      setEnv('SOCKET_NPM_REGISTRY', undefined)
      expect(getSocketNpmRegistry()).toBeUndefined()
    })
  })

  describe('getSocketOrgSlug', () => {
    it('should return org slug when set', () => {
      setEnv('SOCKET_ORG_SLUG', 'my-org')
      expect(getSocketOrgSlug()).toBe('my-org')
    })

    it('should return undefined when not set', () => {
      setEnv('SOCKET_ORG_SLUG', undefined)
      expect(getSocketOrgSlug()).toBeUndefined()
    })
  })

  describe('getSocketRegistryUrl', () => {
    it('should return Socket registry URL when set', () => {
      setEnv('SOCKET_REGISTRY_URL', 'https://registry.socket.dev')
      expect(getSocketRegistryUrl()).toBe('https://registry.socket.dev')
    })

    it('should return undefined when not set', () => {
      setEnv('SOCKET_REGISTRY_URL', undefined)
      expect(getSocketRegistryUrl()).toBeUndefined()
    })
  })

  describe('getSocketViewAllRisks', () => {
    it('should return true when set to truthy value', () => {
      setEnv('SOCKET_VIEW_ALL_RISKS', '1')
      expect(getSocketViewAllRisks()).toBe(true)
    })

    it('should return false when unset or falsy', () => {
      setEnv('SOCKET_VIEW_ALL_RISKS', '')
      expect(getSocketViewAllRisks()).toBe(false)
    })
  })
})
