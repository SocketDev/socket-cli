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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import constants from '../constants.mts'
import { getExtraCaCerts, setupSdk } from './sdk.mts'

import type { RequestInfo, ResponseInfo } from '@socketsecurity/sdk'

// Mock node:fs for certificate file reading.
const mockReadFileSync = vi.hoisted(() => vi.fn())
vi.mock('node:fs', () => ({
  readFileSync: mockReadFileSync,
}))

// Mock node:tls for root certificates.
const MOCK_ROOT_CERTS = vi.hoisted(() => [
  '-----BEGIN CERTIFICATE-----\nROOT1\n-----END CERTIFICATE-----',
])
vi.mock('node:tls', () => ({
  rootCertificates: MOCK_ROOT_CERTS,
}))

// Mock node:https for HttpsAgent.
const MockHttpsAgent = vi.hoisted(() =>
  vi.fn().mockImplementation(opts => ({ ...opts, _isHttpsAgent: true })),
)
vi.mock('node:https', () => ({
  Agent: MockHttpsAgent,
}))

// Mock hpagent proxy agents.
const MockHttpProxyAgent = vi.hoisted(() =>
  vi.fn().mockImplementation(opts => ({ ...opts, _isHttpProxyAgent: true })),
)
const MockHttpsProxyAgent = vi.hoisted(() =>
  vi.fn().mockImplementation(opts => ({ ...opts, _isHttpsProxyAgent: true })),
)
vi.mock('hpagent', () => ({
  HttpProxyAgent: MockHttpProxyAgent,
  HttpsProxyAgent: MockHttpsProxyAgent,
}))

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

// Mock registry debug functions used by getExtraCaCerts.
vi.mock('@socketsecurity/registry/lib/debug', () => ({
  debugDir: vi.fn(),
  debugFn: vi.fn(),
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
      NODE_EXTRA_CA_CERTS: '',
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

describe('getExtraCaCerts', () => {
  const savedEnv = { ...process.env }

  beforeEach(() => {
    vi.clearAllMocks()
    // Reset the cached state by re-importing. Since vitest caches modules,
    // we reset the internal state via the resolved flag workaround: calling
    // the function after resetting module-level state is not possible without
    // re-import, so we use resetModules.
    vi.resetModules()
    // Restore environment variables.
    process.env = { ...savedEnv }
    delete process.env['NODE_EXTRA_CA_CERTS']
    delete process.env['SSL_CERT_FILE']
    constants.ENV.NODE_EXTRA_CA_CERTS = ''
  })

  afterEach(() => {
    process.env = savedEnv
  })

  it('should return undefined when no cert env vars are set', async () => {
    const { getExtraCaCerts: fn } = await import('./sdk.mts')
    const result = fn()
    expect(result).toBeUndefined()
  })

  it('should return undefined when NODE_EXTRA_CA_CERTS is set in process.env', async () => {
    process.env['NODE_EXTRA_CA_CERTS'] = '/some/cert.pem'
    const { getExtraCaCerts: fn } = await import('./sdk.mts')
    const result = fn()
    expect(result).toBeUndefined()
    // Should not attempt to read the file.
    expect(mockReadFileSync).not.toHaveBeenCalled()
  })

  it('should read cert file and combine with root certs when SSL_CERT_FILE is set', async () => {
    const fakePEM =
      '-----BEGIN CERTIFICATE-----\nEXTRA\n-----END CERTIFICATE-----'
    constants.ENV.NODE_EXTRA_CA_CERTS = '/path/to/ssl-cert.pem'
    mockReadFileSync.mockReturnValue(fakePEM)

    const { getExtraCaCerts: fn } = await import('./sdk.mts')
    const result = fn()

    expect(mockReadFileSync).toHaveBeenCalledWith(
      '/path/to/ssl-cert.pem',
      'utf-8',
    )
    expect(result).toEqual([...MOCK_ROOT_CERTS, fakePEM])
  })

  it('should return undefined when cert file does not exist', async () => {
    constants.ENV.NODE_EXTRA_CA_CERTS = '/nonexistent/cert.pem'
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT: no such file or directory')
    })

    const { getExtraCaCerts: fn } = await import('./sdk.mts')
    const result = fn()

    expect(mockReadFileSync).toHaveBeenCalled()
    expect(result).toBeUndefined()
  })

  it('should cache the result after first call', async () => {
    const fakePEM =
      '-----BEGIN CERTIFICATE-----\nCACHED\n-----END CERTIFICATE-----'
    constants.ENV.NODE_EXTRA_CA_CERTS = '/path/to/cert.pem'
    mockReadFileSync.mockReturnValue(fakePEM)

    const { getExtraCaCerts: fn } = await import('./sdk.mts')
    const result1 = fn()
    const result2 = fn()

    // File should only be read once.
    expect(mockReadFileSync).toHaveBeenCalledTimes(1)
    expect(result1).toBe(result2)
  })
})

describe('setupSdk with extra CA certificates', () => {
  const savedEnv = { ...process.env }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    mockGetConfigValueOrUndef.mockReturnValue(undefined)
    constants.ENV.SOCKET_CLI_DEBUG = false
    constants.ENV.NODE_EXTRA_CA_CERTS = ''
    process.env = { ...savedEnv }
    delete process.env['NODE_EXTRA_CA_CERTS']
  })

  afterEach(() => {
    process.env = savedEnv
  })

  it('should pass CA certs to HttpsAgent when SSL_CERT_FILE is configured', async () => {
    const fakePEM =
      '-----BEGIN CERTIFICATE-----\nAGENT\n-----END CERTIFICATE-----'
    constants.ENV.NODE_EXTRA_CA_CERTS = '/path/to/cert.pem'
    mockReadFileSync.mockReturnValue(fakePEM)

    const { setupSdk: fn } = await import('./sdk.mts')
    const result = await fn({ apiToken: 'test-token' })

    expect(result.ok).toBe(true)
    if (result.ok) {
      // Should create an HttpsAgent with combined CA certs.
      expect(result.data.options.agent).toBeDefined()
      expect(MockHttpsAgent).toHaveBeenCalledWith({
        ca: [...MOCK_ROOT_CERTS, fakePEM],
      })
    }
  })

  it('should pass CA certs to proxy agent when proxy and SSL_CERT_FILE are configured', async () => {
    const fakePEM =
      '-----BEGIN CERTIFICATE-----\nPROXY\n-----END CERTIFICATE-----'
    constants.ENV.NODE_EXTRA_CA_CERTS = '/path/to/cert.pem'
    mockReadFileSync.mockReturnValue(fakePEM)

    const expectedCa = [...MOCK_ROOT_CERTS, fakePEM]
    const { setupSdk: fn } = await import('./sdk.mts')
    const result = await fn({
      apiProxy: 'http://proxy.example.com:8080',
      apiToken: 'test-token',
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.options.agent).toBeDefined()
      // Verify the proxy agent was constructed with CA and proxy connect options.
      expect(MockSocketSdk).toHaveBeenCalledWith(
        'test-token',
        expect.objectContaining({
          agent: expect.objectContaining({
            ca: expectedCa,
            proxyConnectOptions: { ca: expectedCa },
          }),
        }),
      )
    }
  })

  it('should not create agent when no extra CA certs are needed', async () => {
    const { setupSdk: fn } = await import('./sdk.mts')
    const result = await fn({ apiToken: 'test-token' })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.options.agent).toBeUndefined()
      expect(MockHttpsAgent).not.toHaveBeenCalled()
    }
  })
})
