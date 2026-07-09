/**
 * Unit tests for Socket SDK setup.
 *
 * Purpose: Tests Socket SDK initialization and configuration. Validates SDK
 * setup with various options.
 *
 * Test Coverage: - SDK initialization - API token handling - Base URL
 * configuration - Proxy URL configuration - User agent setup.
 *
 * Testing Approach: Mocks @socketsecurity/sdk to test setup logic.
 *
 * Related Files: - util/socket/sdk.mts (implementation)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

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

import { setupSdk } from '../../../../src/util/socket/sdk.mts'

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
      mockGetSocketCliApiTimeout.mockReturnValue(30_000)

      const result = await setupSdk({
        apiToken: 'mock-sdk-value-12345',
      })

      expect(result.ok).toBe(true)
      expect(mockSocketSdkConstructor).toHaveBeenCalledWith(
        'mock-sdk-value-12345',
        expect.objectContaining({
          timeout: 30_000,
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
      mockGetSocketCliApiProxy.mockReturnValue(
        'http://default-proxy.example.com:8080',
      )

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
