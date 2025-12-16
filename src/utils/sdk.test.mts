/**
 * Unit tests for SDK setup and telemetry hooks.
 *
 * Purpose:
 * Tests Socket SDK initialization with telemetry and debug hooks.
 *
 * Test Coverage:
 * - SDK initialization with valid API token.
 * - Request hook tracking API requests.
 * - Response hook tracking successful API responses.
 * - Response hook tracking API errors.
 * - Debug logging for all requests and responses.
 * - Infinite loop prevention for telemetry endpoints.
 * - Proxy configuration.
 * - Base URL configuration.
 *
 * Testing Approach:
 * Mocks SocketSdk and telemetry to test hook integration without network calls.
 *
 * Related Files:
 * - utils/sdk.mts (implementation)
 * - utils/telemetry/integration.mts (telemetry tracking)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import constants from '../constants.mts'
import { setupSdk } from './sdk.mts'

import type { RequestInfo, ResponseInfo } from '@socketsecurity/sdk'

// Mock telemetry integration.
const mockTrackCliEvent = vi.hoisted(() => vi.fn())
vi.mock('./telemetry/integration.mts', () => ({
  trackCliEvent: mockTrackCliEvent,
}))

// Mock debug functions.
const mockDebugApiRequest = vi.hoisted(() => vi.fn())
const mockDebugApiResponse = vi.hoisted(() => vi.fn())
vi.mock('./debug.mts', () => ({
  debugApiRequest: mockDebugApiRequest,
  debugApiResponse: mockDebugApiResponse,
}))

// Mock config.
const mockGetConfigValueOrUndef = vi.hoisted(() => vi.fn(() => undefined))
vi.mock('./config.mts', () => ({
  getConfigValueOrUndef: mockGetConfigValueOrUndef,
}))

// Mock SocketSdk.
const MockSocketSdk = vi.hoisted(() =>
  vi.fn().mockImplementation((token, options) => ({
    options,
    token,
  })),
)

const mockCreateUserAgentFromPkgJson = vi.hoisted(() =>
  vi.fn(() => 'socket-cli/1.1.34'),
)

vi.mock('@socketsecurity/sdk', () => ({
  SocketSdk: MockSocketSdk,
  createUserAgentFromPkgJson: mockCreateUserAgentFromPkgJson,
}))

// Mock constants.
vi.mock('../constants.mts', () => ({
  default: {
    ENV: {
      INLINED_SOCKET_CLI_HOMEPAGE: 'https://github.com/SocketDev/socket-cli',
      INLINED_SOCKET_CLI_NAME: 'socket-cli',
      INLINED_SOCKET_CLI_VERSION: '1.1.34',
      SOCKET_CLI_API_TIMEOUT: 30_000,
      SOCKET_CLI_DEBUG: false,
    },
  },
  CONFIG_KEY_API_BASE_URL: 'apiBaseUrl',
  CONFIG_KEY_API_PROXY: 'apiProxy',
  CONFIG_KEY_API_TOKEN: 'apiToken',
}))

describe('SDK setup with telemetry hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetConfigValueOrUndef.mockReturnValue(undefined)
    constants.ENV.SOCKET_CLI_DEBUG = false
  })

  describe('setupSdk', () => {
    it('should initialize SDK with valid token', async () => {
      const result = await setupSdk({ apiToken: 'test-token' })

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).toBeDefined()
        expect(result.data.token).toBe('test-token')
        expect(MockSocketSdk).toHaveBeenCalledWith(
          'test-token',
          expect.objectContaining({
            hooks: expect.objectContaining({
              onRequest: expect.any(Function),
              onResponse: expect.any(Function),
            }),
          }),
        )
      }
    })

    it('should return error when no token provided', async () => {
      const result = await setupSdk()

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.message).toBe('Auth Error')
        expect(result.cause).toContain('socket login')
      }
    })

    it('should configure hooks for telemetry and debugging', async () => {
      const result = await setupSdk({ apiToken: 'test-token' })

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.options.hooks).toBeDefined()
        expect(result.data.options.hooks.onRequest).toBeInstanceOf(Function)
        expect(result.data.options.hooks.onResponse).toBeInstanceOf(Function)
      }
    })
  })

  describe('onRequest hook', () => {
    it('should track API request event', async () => {
      const result = await setupSdk({ apiToken: 'test-token' })

      expect(result.ok).toBe(true)
      if (result.ok) {
        const requestInfo: RequestInfo = {
          method: 'GET',
          timeout: 30_000,
          url: 'https://api.socket.dev/v0/packages',
        }

        result.data.options.hooks.onRequest(requestInfo)

        expect(mockTrackCliEvent).toHaveBeenCalledWith(
          'api_request',
          process.argv,
          {
            method: 'GET',
            timeout: 30_000,
            url: 'https://api.socket.dev/v0/packages',
          },
        )
      }
    })

    it('should skip tracking for telemetry endpoints to prevent infinite loop', async () => {
      constants.ENV.SOCKET_CLI_DEBUG = true
      const result = await setupSdk({ apiToken: 'test-token' })

      expect(result.ok).toBe(true)
      if (result.ok) {
        const requestInfo: RequestInfo = {
          method: 'POST',
          timeout: 30_000,
          url: 'https://api.socket.dev/v0/organizations/my-org/telemetry',
        }

        result.data.options.hooks.onRequest(requestInfo)

        expect(mockTrackCliEvent).not.toHaveBeenCalled()
        expect(mockDebugApiRequest).toHaveBeenCalledWith(
          'POST',
          'https://api.socket.dev/v0/organizations/my-org/telemetry',
          30_000,
        )
      }
    })

    it('should always call debug function for requests', async () => {
      constants.ENV.SOCKET_CLI_DEBUG = true
      const result = await setupSdk({ apiToken: 'test-token' })

      expect(result.ok).toBe(true)
      if (result.ok) {
        const requestInfo: RequestInfo = {
          method: 'POST',
          timeout: 30_000,
          url: 'https://api.socket.dev/v0/scan',
        }

        result.data.options.hooks.onRequest(requestInfo)

        expect(mockDebugApiRequest).toHaveBeenCalledWith(
          'POST',
          'https://api.socket.dev/v0/scan',
          30_000,
        )
      }
    })
  })

  describe('onResponse hook', () => {
    it('should track successful API response event', async () => {
      const result = await setupSdk({ apiToken: 'test-token' })

      expect(result.ok).toBe(true)
      if (result.ok) {
        const responseInfo: ResponseInfo = {
          duration: 123,
          headers: {},
          method: 'GET',
          status: 200,
          statusText: 'OK',
          url: 'https://api.socket.dev/v0/packages',
        }

        result.data.options.hooks.onResponse(responseInfo)

        expect(mockTrackCliEvent).toHaveBeenCalledWith(
          'api_response',
          process.argv,
          {
            duration: 123,
            method: 'GET',
            status: 200,
            statusText: 'OK',
            url: 'https://api.socket.dev/v0/packages',
          },
        )
      }
    })

    it('should skip tracking for telemetry endpoints to prevent infinite loop', async () => {
      constants.ENV.SOCKET_CLI_DEBUG = true
      const result = await setupSdk({ apiToken: 'test-token' })

      expect(result.ok).toBe(true)
      if (result.ok) {
        const responseInfo: ResponseInfo = {
          duration: 456,
          headers: {},
          method: 'POST',
          status: 200,
          statusText: 'OK',
          url: 'https://api.socket.dev/v0/organizations/my-org/telemetry',
        }

        result.data.options.hooks.onResponse(responseInfo)

        expect(mockTrackCliEvent).not.toHaveBeenCalled()
        expect(mockDebugApiResponse).toHaveBeenCalledWith(
          'POST',
          'https://api.socket.dev/v0/organizations/my-org/telemetry',
          200,
          undefined,
          456,
          {},
        )
      }
    })

    it('should track API error event when error exists', async () => {
      const result = await setupSdk({ apiToken: 'test-token' })

      expect(result.ok).toBe(true)
      if (result.ok) {
        const error = new Error('Network timeout')
        const responseInfo: ResponseInfo = {
          duration: 456,
          error,
          headers: {},
          method: 'POST',
          status: 0,
          statusText: '',
          url: 'https://api.socket.dev/v0/scan',
        }

        result.data.options.hooks.onResponse(responseInfo)

        expect(mockTrackCliEvent).toHaveBeenCalledWith(
          'api_error',
          process.argv,
          {
            duration: 456,
            error_message: 'Network timeout',
            error_type: 'Error',
            method: 'POST',
            status: 0,
            statusText: '',
            url: 'https://api.socket.dev/v0/scan',
          },
        )
      }
    })

    it('should always call debug function for responses', async () => {
      constants.ENV.SOCKET_CLI_DEBUG = true
      const result = await setupSdk({ apiToken: 'test-token' })

      expect(result.ok).toBe(true)
      if (result.ok) {
        const responseInfo: ResponseInfo = {
          duration: 789,
          headers: { 'content-type': 'application/json' },
          method: 'GET',
          status: 200,
          statusText: 'OK',
          url: 'https://api.socket.dev/v0/packages',
        }

        result.data.options.hooks.onResponse(responseInfo)

        expect(mockDebugApiResponse).toHaveBeenCalledWith(
          'GET',
          'https://api.socket.dev/v0/packages',
          200,
          undefined,
          789,
          { 'content-type': 'application/json' },
        )
      }
    })

    it('should track error with custom error type', async () => {
      const result = await setupSdk({ apiToken: 'test-token' })

      expect(result.ok).toBe(true)
      if (result.ok) {
        class CustomError extends Error {
          constructor(message: string) {
            super(message)
            this.name = 'CustomError'
          }
        }

        const error = new CustomError('Custom error occurred')
        const responseInfo: ResponseInfo = {
          duration: 250,
          error,
          headers: {},
          method: 'DELETE',
          status: 500,
          statusText: 'Internal Server Error',
          url: 'https://api.socket.dev/v0/resource',
        }

        result.data.options.hooks.onResponse(responseInfo)

        expect(mockTrackCliEvent).toHaveBeenCalledWith(
          'api_error',
          process.argv,
          {
            duration: 250,
            error_message: 'Custom error occurred',
            error_type: 'CustomError',
            method: 'DELETE',
            status: 500,
            statusText: 'Internal Server Error',
            url: 'https://api.socket.dev/v0/resource',
          },
        )
      }
    })
  })

  describe('SDK configuration', () => {
    it('should configure proxy when provided', async () => {
      const result = await setupSdk({
        apiProxy: 'http://proxy.example.com:8080',
        apiToken: 'test-token',
      })

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.options.agent).toBeDefined()
      }
    })

    it('should configure base URL when provided', async () => {
      const result = await setupSdk({
        apiBaseUrl: 'https://custom.api.socket.dev',
        apiToken: 'test-token',
      })

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.options.baseUrl).toBe(
          'https://custom.api.socket.dev',
        )
      }
    })

    it('should configure timeout from environment', async () => {
      constants.ENV.SOCKET_CLI_API_TIMEOUT = 60_000
      const result = await setupSdk({ apiToken: 'test-token' })

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.options.timeout).toBe(60_000)
      }
    })

    it('should configure user agent', async () => {
      const result = await setupSdk({ apiToken: 'test-token' })

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.options.userAgent).toBe('socket-cli/1.1.34')
      }
    })
  })

  describe('hook integration', () => {
    it('should handle multiple request events', async () => {
      const result = await setupSdk({ apiToken: 'test-token' })

      expect(result.ok).toBe(true)
      if (result.ok) {
        const request1: RequestInfo = {
          method: 'GET',
          timeout: 30_000,
          url: 'https://api.socket.dev/v0/packages/npm/lodash',
        }
        const request2: RequestInfo = {
          method: 'POST',
          timeout: 30_000,
          url: 'https://api.socket.dev/v0/scan',
        }

        result.data.options.hooks.onRequest(request1)
        result.data.options.hooks.onRequest(request2)

        expect(mockTrackCliEvent).toHaveBeenCalledTimes(2)
        expect(mockTrackCliEvent).toHaveBeenNthCalledWith(
          1,
          'api_request',
          process.argv,
          {
            method: 'GET',
            timeout: 30_000,
            url: 'https://api.socket.dev/v0/packages/npm/lodash',
          },
        )
        expect(mockTrackCliEvent).toHaveBeenNthCalledWith(
          2,
          'api_request',
          process.argv,
          {
            method: 'POST',
            timeout: 30_000,
            url: 'https://api.socket.dev/v0/scan',
          },
        )
      }
    })

    it('should handle multiple response events', async () => {
      const result = await setupSdk({ apiToken: 'test-token' })

      expect(result.ok).toBe(true)
      if (result.ok) {
        const response1: ResponseInfo = {
          duration: 100,
          headers: {},
          method: 'GET',
          status: 200,
          statusText: 'OK',
          url: 'https://api.socket.dev/v0/packages',
        }
        const response2: ResponseInfo = {
          duration: 200,
          error: new Error('Failed'),
          headers: {},
          method: 'POST',
          status: 500,
          statusText: 'Internal Server Error',
          url: 'https://api.socket.dev/v0/scan',
        }

        result.data.options.hooks.onResponse(response1)
        result.data.options.hooks.onResponse(response2)

        expect(mockTrackCliEvent).toHaveBeenCalledTimes(2)
        expect(mockTrackCliEvent).toHaveBeenNthCalledWith(
          1,
          'api_response',
          process.argv,
          {
            duration: 100,
            method: 'GET',
            status: 200,
            statusText: 'OK',
            url: 'https://api.socket.dev/v0/packages',
          },
        )
        expect(mockTrackCliEvent).toHaveBeenNthCalledWith(
          2,
          'api_error',
          process.argv,
          {
            duration: 200,
            error_message: 'Failed',
            error_type: 'Error',
            method: 'POST',
            status: 500,
            statusText: 'Internal Server Error',
            url: 'https://api.socket.dev/v0/scan',
          },
        )
      }
    })
  })
})
