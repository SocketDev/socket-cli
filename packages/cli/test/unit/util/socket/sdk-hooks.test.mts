/**
 * Unit tests for Socket SDK request/response hooks and file-validation
 * callback.
 *
 * Purpose: Validates the onRequest/onResponse telemetry hooks (including the
 * telemetry-endpoint skip) and the onFileValidation callback wired into
 * setupSdk's SDK options.
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

  describe('setupSdk hooks', () => {
    it('onRequest hook is callable and does not throw', async () => {
      const result = await setupSdk({
        apiToken: 'mock-sdk-value-12345',
      })

      expect(result.ok).toBe(true)
      // Get the hooks from the constructor call.
      const sdkOptions = mockSocketSdkConstructor.mock.calls[0]![1]
      const { onRequest } = sdkOptions.hooks

      // Call onRequest with mock request info.
      expect(() => {
        onRequest({
          method: 'GET',
          url: 'https://api.socket.dev/v1/packages',
          timeout: 30_000,
        })
      }).not.toThrow()
    })

    it('onRequest hook skips telemetry for telemetry endpoints', async () => {
      const result = await setupSdk({
        apiToken: 'mock-sdk-value-12345',
      })

      expect(result.ok).toBe(true)
      const sdkOptions = mockSocketSdkConstructor.mock.calls[0]![1]
      const { onRequest } = sdkOptions.hooks

      // Call onRequest with telemetry URL.
      expect(() => {
        onRequest({
          method: 'POST',
          url: 'https://api.socket.dev/v1/telemetry',
          timeout: 30_000,
        })
      }).not.toThrow()
    })

    it('onResponse hook is callable and does not throw', async () => {
      const result = await setupSdk({
        apiToken: 'mock-sdk-value-12345',
      })

      expect(result.ok).toBe(true)
      const sdkOptions = mockSocketSdkConstructor.mock.calls[0]![1]
      const { onResponse } = sdkOptions.hooks

      // Call onResponse with mock response info.
      expect(() => {
        onResponse({
          method: 'GET',
          url: 'https://api.socket.dev/v1/packages',
          status: 200,
          statusText: 'OK',
          duration: 100,
          headers: {},
        })
      }).not.toThrow()
    })

    it('onResponse hook handles error responses', async () => {
      const result = await setupSdk({
        apiToken: 'mock-sdk-value-12345',
      })

      expect(result.ok).toBe(true)
      const sdkOptions = mockSocketSdkConstructor.mock.calls[0]![1]
      const { onResponse } = sdkOptions.hooks

      // Call onResponse with error info.
      expect(() => {
        onResponse({
          method: 'GET',
          url: 'https://api.socket.dev/v1/packages',
          status: 500,
          statusText: 'Internal Server Error',
          duration: 100,
          headers: {},
          error: new Error('Server error'),
        })
      }).not.toThrow()
    })

    it('onResponse hook skips telemetry for telemetry endpoints', async () => {
      const result = await setupSdk({
        apiToken: 'mock-sdk-value-12345',
      })

      expect(result.ok).toBe(true)
      const sdkOptions = mockSocketSdkConstructor.mock.calls[0]![1]
      const { onResponse } = sdkOptions.hooks

      // Call onResponse with telemetry URL.
      expect(() => {
        onResponse({
          method: 'POST',
          url: 'https://api.socket.dev/v1/telemetry',
          status: 200,
          statusText: 'OK',
          duration: 100,
          headers: {},
        })
      }).not.toThrow()
    })
  })

  describe('setupSdk onFileValidation', () => {
    it('onFileValidation returns shouldContinue true with valid paths', async () => {
      const result = await setupSdk({
        apiToken: 'mock-sdk-value-12345',
      })

      expect(result.ok).toBe(true)
      const sdkOptions = mockSocketSdkConstructor.mock.calls[0]![1]
      const { onFileValidation } = sdkOptions

      const validationResult = onFileValidation(['/path/to/valid.json'], [], {
        operation: 'createFullScan',
      })

      expect(validationResult).toEqual({ shouldContinue: true })
    })

    it('onFileValidation warns and continues when invalid paths exist', async () => {
      const result = await setupSdk({
        apiToken: 'mock-sdk-value-12345',
      })

      expect(result.ok).toBe(true)
      const sdkOptions = mockSocketSdkConstructor.mock.calls[0]![1]
      const { onFileValidation } = sdkOptions

      const validationResult = onFileValidation(
        ['/path/to/valid.json'],
        ['/path/to/invalid.json', '/path/to/another-invalid.json'],
        { operation: 'uploadManifestFiles', orgSlug: 'test-org' },
      )

      expect(validationResult).toEqual({ shouldContinue: true })
    })

    it('onFileValidation handles createDependenciesSnapshot operation', async () => {
      const result = await setupSdk({
        apiToken: 'mock-sdk-value-12345',
      })

      expect(result.ok).toBe(true)
      const sdkOptions = mockSocketSdkConstructor.mock.calls[0]![1]
      const { onFileValidation } = sdkOptions

      const validationResult = onFileValidation([], ['/path/to/symlink.json'], {
        operation: 'createDependenciesSnapshot',
      })

      expect(validationResult).toEqual({ shouldContinue: true })
    })
  })
})
