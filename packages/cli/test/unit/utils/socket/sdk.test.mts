/**
 * Unit tests for Socket SDK setup.
 *
 * Purpose:
 * Tests Socket SDK initialization and configuration. Validates SDK setup with various options.
 *
 * Test Coverage:
 * - SDK initialization
 * - API token handling
 * - Base URL configuration
 * - Proxy URL configuration
 * - User agent setup
 * - SDK error handling
 *
 * Testing Approach:
 * Mocks @socketsecurity/sdk to test setup logic.
 *
 * Related Files:
 * - utils/socket/sdk.mts (implementation)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the config utility.
const mockGetConfigValueOrUndef = vi.hoisted(() => vi.fn())
vi.mock('../../../../src/utils/config.mts', () => ({
  getConfigValueOrUndef: mockGetConfigValueOrUndef,
}))

// Mock environment getters from @socketsecurity/lib.
const mockGetSocketCliApiBaseUrl = vi.hoisted(() => vi.fn())
const mockGetSocketCliApiProxy = vi.hoisted(() => vi.fn())
const mockGetSocketCliApiToken = vi.hoisted(() => vi.fn())
const mockGetSocketCliNoApiToken = vi.hoisted(() => vi.fn())
const mockGetSocketCliApiTimeout = vi.hoisted(() => vi.fn())
vi.mock('@socketsecurity/lib/env/socket-cli', () => ({
  getSocketCliApiBaseUrl: mockGetSocketCliApiBaseUrl,
  getSocketCliApiProxy: mockGetSocketCliApiProxy,
  getSocketCliApiToken: mockGetSocketCliApiToken,
  getSocketCliNoApiToken: mockGetSocketCliNoApiToken,
  getSocketCliApiTimeout: mockGetSocketCliApiTimeout,
}))

// Mock is-interactive.
const mockIsInteractive = vi.hoisted(() => vi.fn(() => false))
vi.mock('@socketregistry/is-interactive/index.cjs', () => ({
  default: mockIsInteractive,
}))

// Mock the SocketSdk class.
class MockSocketSdk {
  apiToken: string
  options: any

  constructor(apiToken: string, options: any) {
    this.apiToken = apiToken
    this.options = options
  }

  getOrganizations() {
    return Promise.resolve({ ok: true, data: [] })
  }
}
const mockSocketSdkConstructor = vi.hoisted(() => vi.fn())
vi.mock('@socketsecurity/sdk', () => ({
  SocketSdk: class {
    constructor(apiToken: string, options: any) {
      mockSocketSdkConstructor(apiToken, options)
      return new MockSocketSdk(apiToken, options)
    }
  },
  createUserAgentFromPkgJson: vi.fn(() => 'test-user-agent'),
}))

// Mock telemetry.
vi.mock('../../../../src/utils/telemetry/integration.mts', () => ({
  trackCliEvent: vi.fn(),
}))

// Mock debug.
vi.mock('../../../../src/utils/debug.mts', () => ({
  debugApiRequest: vi.fn(),
  debugApiResponse: vi.fn(),
}))

import {
  getDefaultApiBaseUrl,
  getDefaultApiToken,
  getDefaultProxyUrl,
  getPublicApiToken,
  getVisibleTokenPrefix,
  hasDefaultApiToken,
  setupSdk,
} from '../../../../src/utils/socket/sdk.mts'

describe('SDK Utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSocketCliNoApiToken.mockReturnValue(false)
    mockGetSocketCliApiToken.mockReturnValue(undefined)
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
      mockGetSocketCliApiToken.mockReturnValue('mock-env-value-12345')
      const token = getDefaultApiToken()
      expect(token).toBe('mock-env-value-12345')
    })

    it('returns token from config when env is not set', () => {
      mockGetConfigValueOrUndef.mockReturnValue('mock-config-value-12345')
      const token = getDefaultApiToken()
      expect(token).toBe('mock-config-value-12345')
    })
  })

  describe('getPublicApiToken', () => {
    it('returns a token value', () => {
      const token = getPublicApiToken()
      expect(typeof token).toBe('string')
      expect(token.length).toBeGreaterThan(0)
    })

    it('returns default token when set', () => {
      mockGetSocketCliApiToken.mockReturnValue('mock-custom-value-12345')
      const token = getPublicApiToken()
      expect(token).toBe('mock-custom-value-12345')
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
      mockGetSocketCliApiToken.mockReturnValue('sk_sec12345678901234567890')
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
      mockGetSocketCliApiToken.mockReturnValue('mock-value-for-test')
      const hasToken = hasDefaultApiToken()
      expect(hasToken).toBe(true)
    })
  })

  describe('setupSdk', () => {
    it('returns error when no token and not interactive', () => {
      mockIsInteractive.mockReturnValue(false)
      mockGetSocketCliNoApiToken.mockReturnValue(true)

      return setupSdk().then(result => {
        expect(result.ok).toBe(false)
        if (!result.ok) {
          expect(result.message).toBe('Auth Error')
          expect(result.cause).toContain('socket login')
        }
      })
    })

    it('returns SDK instance when token is provided', async () => {
      const result = await setupSdk({ apiToken: 'mock-sdk-value-12345' })

      expect(result.ok).toBe(true)
      expect(mockSocketSdkConstructor).toHaveBeenCalledWith(
        'mock-sdk-value-12345',
        expect.any(Object),
      )
    })

    it('uses provided apiBaseUrl', async () => {
      const result = await setupSdk({
        apiToken: 'mock-sdk-value-12345',
        apiBaseUrl: 'https://custom.api.socket.dev',
      })

      expect(result.ok).toBe(true)
      expect(mockSocketSdkConstructor).toHaveBeenCalledWith(
        'mock-sdk-value-12345',
        expect.objectContaining({
          baseUrl: 'https://custom.api.socket.dev',
        }),
      )
    })

    it('uses apiProxy when provided as valid URL', async () => {
      const result = await setupSdk({
        apiToken: 'mock-sdk-value-12345',
        apiProxy: 'http://proxy.example.com:8080',
      })

      expect(result.ok).toBe(true)
      expect(mockSocketSdkConstructor).toHaveBeenCalledWith(
        'mock-sdk-value-12345',
        expect.objectContaining({
          agent: expect.any(Object),
        }),
      )
    })

    it('ignores invalid apiProxy', async () => {
      const result = await setupSdk({
        apiToken: 'mock-sdk-value-12345',
        apiProxy: 'not-a-url',
      })

      expect(result.ok).toBe(true)
      // Should not include agent in options.
      expect(mockSocketSdkConstructor).toHaveBeenCalledWith(
        'mock-sdk-value-12345',
        expect.not.objectContaining({
          agent: expect.any(Object),
        }),
      )
    })

    it('uses timeout from environment', async () => {
      mockGetSocketCliApiTimeout.mockReturnValue(30000)

      const result = await setupSdk({
        apiToken: 'mock-sdk-value-12345',
      })

      expect(result.ok).toBe(true)
      expect(mockSocketSdkConstructor).toHaveBeenCalledWith(
        'mock-sdk-value-12345',
        expect.objectContaining({
          timeout: 30000,
        }),
      )
    })

    it('includes hooks in SDK options', async () => {
      const result = await setupSdk({
        apiToken: 'mock-sdk-value-12345',
      })

      expect(result.ok).toBe(true)
      expect(mockSocketSdkConstructor).toHaveBeenCalledWith(
        'mock-sdk-value-12345',
        expect.objectContaining({
          hooks: expect.objectContaining({
            onRequest: expect.any(Function),
            onResponse: expect.any(Function),
          }),
        }),
      )
    })

    it('includes onFileValidation in SDK options', async () => {
      const result = await setupSdk({
        apiToken: 'mock-sdk-value-12345',
      })

      expect(result.ok).toBe(true)
      expect(mockSocketSdkConstructor).toHaveBeenCalledWith(
        'mock-sdk-value-12345',
        expect.objectContaining({
          onFileValidation: expect.any(Function),
        }),
      )
    })

    it('includes user agent in SDK options', async () => {
      const result = await setupSdk({
        apiToken: 'mock-sdk-value-12345',
      })

      expect(result.ok).toBe(true)
      expect(mockSocketSdkConstructor).toHaveBeenCalledWith(
        'mock-sdk-value-12345',
        expect.objectContaining({
          userAgent: 'test-user-agent',
        }),
      )
    })

    it('uses HttpProxyAgent for http base URL', async () => {
      const result = await setupSdk({
        apiToken: 'mock-sdk-value-12345',
        apiBaseUrl: 'http://api.socket.dev',
        apiProxy: 'http://proxy.example.com:8080',
      })

      expect(result.ok).toBe(true)
      // Just verify it includes an agent; the specific class is internal.
      expect(mockSocketSdkConstructor).toHaveBeenCalledWith(
        'mock-sdk-value-12345',
        expect.objectContaining({
          agent: expect.any(Object),
          baseUrl: 'http://api.socket.dev',
        }),
      )
    })

    it('falls back to default proxy from environment when invalid proxy provided', async () => {
      mockGetSocketCliApiProxy.mockReturnValue('http://default-proxy.example.com:8080')

      const result = await setupSdk({
        apiToken: 'mock-sdk-value-12345',
        apiProxy: 'invalid-proxy',
      })

      expect(result.ok).toBe(true)
      // Should use the default proxy from environment.
      expect(mockSocketSdkConstructor).toHaveBeenCalledWith(
        'mock-sdk-value-12345',
        expect.objectContaining({
          agent: expect.any(Object),
        }),
      )
    })

    it('returns SDK with default token from config', async () => {
      mockGetConfigValueOrUndef.mockReturnValue('mock-config-value-12345')

      const result = await setupSdk()

      expect(result.ok).toBe(true)
      expect(mockSocketSdkConstructor).toHaveBeenCalledWith(
        'mock-config-value-12345',
        expect.any(Object),
      )
    })
  })
})
