/**
 * Unit tests for Socket SDK setup.
 *
 * Purpose: Tests Socket SDK default-value resolution. Validates the default
 * API base URL / proxy / token getters, the visible-token-prefix helper, and
 * the NODE_EXTRA_CA_CERTS / SSL_CERT_FILE detection used before SDK setup.
 *
 * Testing Approach: Mocks @socketsecurity/sdk to test setup logic.
 *
 * Related Files: - util/socket/sdk.mts (implementation)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the config utility.
const mockGetConfigValueOrUndef = vi.hoisted(() => vi.fn())
vi.mock(import('../../../../src/util/config.mts'), () => ({
  getConfigValueOrUndef: mockGetConfigValueOrUndef,
}))

// Mock environment getters from @socketsecurity/lib.
const mockGetSocketCliApiBaseUrl = vi.hoisted(() => vi.fn())
const mockGetSocketCliApiProxy = vi.hoisted(() => vi.fn())
const mockGetSocketApiToken = vi.hoisted(() => vi.fn())
const mockGetSocketCliNoApiToken = vi.hoisted(() => vi.fn())
const mockGetSocketCliApiTimeout = vi.hoisted(() => vi.fn())
vi.mock(import('@socketsecurity/lib-stable/env/socket'), () => ({
  getSocketApiToken: mockGetSocketApiToken,
}))
vi.mock(import('@socketsecurity/lib-stable/env/socket-cli'), () => ({
  getSocketCliApiBaseUrl: mockGetSocketCliApiBaseUrl,
  getSocketCliApiProxy: mockGetSocketCliApiProxy,
  getSocketCliNoApiToken: mockGetSocketCliNoApiToken,
  getSocketCliApiTimeout: mockGetSocketCliApiTimeout,
}))

// Mock is-interactive.
const mockIsInteractive = vi.hoisted(() => vi.fn(() => false))
vi.mock(import('@socketregistry/is-interactive/index.cjs'), () => ({
  default: mockIsInteractive,
}))

// Mock the SocketSdk class.
class MockSocketSdk {
  apiToken: string
  options: unknown

  constructor(apiToken: string, options: unknown) {
    this.apiToken = apiToken
    this.options = options
  }

  getOrganizations() {
    return Promise.resolve({ ok: true, data: [] })
  }
}
const mockSocketSdkConstructor = vi.hoisted(() => vi.fn())
vi.mock(import('@socketsecurity/sdk-stable'), () => ({
  SocketSdk: class {
    constructor(apiToken: string, options: unknown) {
      mockSocketSdkConstructor(apiToken, options)
      return new MockSocketSdk(apiToken, options)
    }
  },
  createUserAgentFromPkgJson: vi.fn(() => 'test-user-agent'),
}))

// Mock telemetry.
vi.mock(import('../../../../src/util/telemetry/integration.mts'), () => ({
  trackCliEvent: vi.fn(),
}))

// Mock debug.
vi.mock(import('../../../../src/util/debug.mts'), () => ({
  debugApiRequest: vi.fn(),
  debugApiResponse: vi.fn(),
}))

import {
  getDefaultApiBaseUrl,
  getDefaultApiToken,
  getDefaultProxyUrl,
  getExtraCaCerts,
  getVisibleTokenPrefix,
  hasDefaultApiToken,
  invalidateDefaultApiToken,
} from '../../../../src/util/socket/sdk.mts'

describe('SDK Utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSocketCliNoApiToken.mockReturnValue(false)
    mockGetSocketApiToken.mockReturnValue(undefined)
    mockGetSocketCliApiBaseUrl.mockReturnValue(undefined)
    mockGetSocketCliApiProxy.mockReturnValue(undefined)
    mockGetSocketCliApiTimeout.mockReturnValue(undefined)
    mockGetConfigValueOrUndef.mockReturnValue(undefined)
  })

  describe('getDefaultApiBaseUrl', () => {
    it('returns undefined when no URL is configured', () => {
      const url = getDefaultApiBaseUrl()
      expect(url).toBeUndefined()
    })

    it('returns URL from environment variable', () => {
      mockGetSocketCliApiBaseUrl.mockReturnValue('https://api.socket.dev')
      const url = getDefaultApiBaseUrl()
      expect(url).toBe('https://api.socket.dev')
    })

    it('returns URL from config when env is not set', () => {
      mockGetConfigValueOrUndef.mockReturnValue('https://custom.api.socket.dev')
      const url = getDefaultApiBaseUrl()
      expect(url).toBe('https://custom.api.socket.dev')
    })

    it('returns undefined for invalid URL', () => {
      mockGetSocketCliApiBaseUrl.mockReturnValue('not-a-valid-url')
      const url = getDefaultApiBaseUrl()
      expect(url).toBeUndefined()
    })
  })

  describe('getDefaultProxyUrl', () => {
    it('returns undefined when no proxy is configured', () => {
      const url = getDefaultProxyUrl()
      expect(url).toBeUndefined()
    })

    it('returns proxy URL from environment variable', () => {
      mockGetSocketCliApiProxy.mockReturnValue('http://proxy.example.com:8080')
      const url = getDefaultProxyUrl()
      expect(url).toBe('http://proxy.example.com:8080')
    })

    it('returns undefined for invalid proxy URL', () => {
      mockGetSocketCliApiProxy.mockReturnValue('invalid-proxy')
      const url = getDefaultProxyUrl()
      expect(url).toBeUndefined()
    })
  })

  describe('getDefaultApiToken', () => {
    it('returns undefined when SOCKET_CLI_NO_API_TOKEN is set', () => {
      mockGetSocketCliNoApiToken.mockReturnValue(true)
      const token = getDefaultApiToken()
      expect(token).toBeUndefined()
    })

    it('returns token from environment variable', () => {
      mockGetSocketApiToken.mockReturnValue('mock-env-value-12345')
      const token = getDefaultApiToken()
      expect(token).toBe('mock-env-value-12345')
    })

    it('returns token from config when env is not set', () => {
      mockGetConfigValueOrUndef.mockReturnValue('mock-config-value-12345')
      const token = getDefaultApiToken()
      expect(token).toBe('mock-config-value-12345')
    })
  })

  describe('getVisibleTokenPrefix', () => {
    it('handles when no token is set', () => {
      mockGetSocketCliNoApiToken.mockReturnValue(true)
      const prefix = getVisibleTokenPrefix()
      expect(prefix).toBe('')
    })

    it('returns visible prefix when token is set', () => {
      // Token must be long enough to have a prefix.
      mockGetSocketApiToken.mockReturnValue('sk_sec12345678901234567890')
      const prefix = getVisibleTokenPrefix()
      expect(typeof prefix).toBe('string')
    })
  })

  describe('hasDefaultApiToken', () => {
    it('returns false when no token is set', () => {
      mockGetSocketCliNoApiToken.mockReturnValue(true)
      const hasToken = hasDefaultApiToken()
      expect(hasToken).toBe(false)
    })

    it('returns true when token is set', () => {
      mockGetSocketApiToken.mockReturnValue('mock-value-for-test')
      const hasToken = hasDefaultApiToken()
      expect(hasToken).toBe(true)
    })
  })

  describe('invalidateDefaultApiToken', () => {
    it('clears the cached default token', () => {
      mockGetSocketApiToken.mockReturnValue('cached-token')
      // Populate the cache.
      expect(getDefaultApiToken()).toBe('cached-token')
      // Now invalidate — and have the underlying source return undefined.
      invalidateDefaultApiToken()
      mockGetSocketApiToken.mockReturnValue(undefined)
      mockGetConfigValueOrUndef.mockReturnValue(undefined)
      expect(getDefaultApiToken()).toBeUndefined()
    })
  })

  describe('getExtraCaCerts', () => {
    const realNodeExtraCaCerts = process.env['NODE_EXTRA_CA_CERTS']
    const realSslCertFile = process.env['SSL_CERT_FILE']

    afterEach(() => {
      // Restore original env vars after each test.
      if (realNodeExtraCaCerts === undefined) {
        delete process.env['NODE_EXTRA_CA_CERTS']
      } else {
        process.env['NODE_EXTRA_CA_CERTS'] = realNodeExtraCaCerts
      }
      if (realSslCertFile === undefined) {
        delete process.env['SSL_CERT_FILE']
      } else {
        process.env['SSL_CERT_FILE'] = realSslCertFile
      }
    })

    it('returns undefined when NODE_EXTRA_CA_CERTS is set (Node already loaded)', async () => {
      // Use a fresh module import to bypass the module-level cache
      // (`_extraCaCertsResolved`) that the rest of the test suite has
      // already populated.
      vi.resetModules()
      process.env['NODE_EXTRA_CA_CERTS'] = '/some/path/ca.pem'
      delete process.env['SSL_CERT_FILE']
      const fresh = await import('../../../../src/util/socket/sdk.mts')
      const result = fresh.getExtraCaCerts()
      expect(result).toBeUndefined()
    })

    it('returns undefined when neither env var is set', async () => {
      vi.resetModules()
      delete process.env['NODE_EXTRA_CA_CERTS']
      delete process.env['SSL_CERT_FILE']
      const fresh = await import('../../../../src/util/socket/sdk.mts')
      const result = fresh.getExtraCaCerts()
      expect(result).toBeUndefined()
    })

    it('caches the resolved value across calls', async () => {
      vi.resetModules()
      delete process.env['NODE_EXTRA_CA_CERTS']
      delete process.env['SSL_CERT_FILE']
      const fresh = await import('../../../../src/util/socket/sdk.mts')
      // Two calls — second hits the cache early-return.
      expect(fresh.getExtraCaCerts()).toBeUndefined()
      expect(fresh.getExtraCaCerts()).toBeUndefined()
    })
  })
})
