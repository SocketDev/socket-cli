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
import {
  clampApiTimeout,
  getCliUserAgent,
  getExtraCaCerts,
  hasDefaultApiToken,
  isOAuthLoginActive,
  resolveDefaultApiToken,
  setupSdk,
} from './sdk.mts'

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
const mockGetConfigValueOrUndef = vi.hoisted(() =>
  vi.fn((_key: string): unknown => undefined),
)
const mockIsConfigFromFlag = vi.hoisted(() => vi.fn(() => false))
vi.mock('./config.mts', () => ({
  getConfigValueOrUndef: mockGetConfigValueOrUndef,
  isConfigFromFlag: mockIsConfigFromFlag,
}))

vi.mock('./errors.mts', () => ({
  getErrorCause: (error: unknown) =>
    error instanceof Error ? error.message : 'Unknown error',
}))

const mockReadOAuthCredentials = vi.hoisted(() =>
  vi.fn((): unknown => undefined),
)
const mockResolveOAuthAccessToken = vi.hoisted(() =>
  vi.fn(async () => 'oauth-access-token'),
)
vi.mock('./oauth.mts', () => ({
  readOAuthCredentials: mockReadOAuthCredentials,
  resolveOAuthAccessToken: mockResolveOAuthAccessToken,
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
      SOCKET_CLI_NO_API_TOKEN: false,
      SOCKET_CLI_API_TOKEN: '',
    },
    socketAppDataPath: '/tmp/socket-sdk-test',
  },
  CONFIG_KEY_API_BASE_URL: 'apiBaseUrl',
  CONFIG_KEY_API_PROXY: 'apiProxy',
  CONFIG_KEY_API_TOKEN: 'apiToken',
  CONFIG_KEY_AUTH_TYPE: 'authType',
}))

describe('SDK setup with telemetry hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetConfigValueOrUndef.mockReturnValue(undefined)
    mockIsConfigFromFlag.mockReturnValue(false)
    mockReadOAuthCredentials.mockReturnValue(undefined)
    mockResolveOAuthAccessToken.mockResolvedValue('oauth-access-token')
    constants.ENV.SOCKET_CLI_DEBUG = false
    constants.ENV.SOCKET_CLI_NO_API_TOKEN = false
    constants.ENV.SOCKET_CLI_API_TOKEN = ''
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

    it('uses the active OAuth access token for SDK requests', async () => {
      mockGetConfigValueOrUndef.mockImplementation((key: string) =>
        key === 'authType' ? 'oauth' : undefined,
      )
      mockReadOAuthCredentials.mockReturnValue({
        apiOrigin: 'https://api.socket.dev',
        accessToken: 'stored-access-token',
      })

      const result = await setupSdk()

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.token).toBe('oauth-access-token')
      }
      expect(mockResolveOAuthAccessToken).toHaveBeenCalledWith(
        '/tmp/socket-sdk-test',
        expect.objectContaining({ apiProxy: undefined }),
      )
    })

    it('keeps an explicit environment API token ahead of active OAuth', async () => {
      mockGetConfigValueOrUndef.mockImplementation((key: string) =>
        key === 'authType' ? 'oauth' : undefined,
      )
      constants.ENV.SOCKET_CLI_API_TOKEN = 'explicit-env-token'

      const result = await setupSdk()

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.token).toBe('explicit-env-token')
      }
      expect(mockResolveOAuthAccessToken).not.toHaveBeenCalled()
    })

    it('does not fall back when an active OAuth session cannot refresh', async () => {
      mockGetConfigValueOrUndef.mockImplementation((key: string) =>
        key === 'authType' ? 'oauth' : undefined,
      )
      mockReadOAuthCredentials.mockReturnValue({
        apiOrigin: 'https://api.socket.dev',
        accessToken: 'stale-token',
      })
      mockResolveOAuthAccessToken.mockRejectedValueOnce(
        new Error('refresh failed'),
      )

      const result = await setupSdk()

      expect(result).toMatchObject({
        ok: false,
        message: 'Auth Error',
        cause: 'refresh failed',
      })
      expect(MockSocketSdk).not.toHaveBeenCalled()
    })

    it('returns OAuth credential read errors as an auth result', async () => {
      mockGetConfigValueOrUndef.mockImplementation((key: string) =>
        key === 'authType' ? 'oauth' : undefined,
      )
      mockReadOAuthCredentials.mockImplementationOnce(() => {
        throw new Error('saved credentials are corrupt')
      })

      const result = await setupSdk()

      expect(result).toMatchObject({
        ok: false,
        message: 'Auth Error',
        cause: 'saved credentials are corrupt',
      })
      expect(MockSocketSdk).not.toHaveBeenCalled()
    })

    it('recognizes a stored OAuth session for command preflight', () => {
      mockGetConfigValueOrUndef.mockImplementation((key: string) =>
        key === 'authType' ? 'oauth' : undefined,
      )
      mockReadOAuthCredentials.mockReturnValue({ accessToken: 'oauth-token' })
      expect(hasDefaultApiToken()).toBe(true)
    })

    it('classifies OAuth only when config and explicit token overrides are absent', () => {
      mockGetConfigValueOrUndef.mockImplementation((key: string) =>
        key === 'authType' ? 'oauth' : undefined,
      )
      expect(isOAuthLoginActive()).toBe(true)

      mockIsConfigFromFlag.mockReturnValue(true)
      expect(isOAuthLoginActive()).toBe(false)
      mockIsConfigFromFlag.mockReturnValue(false)

      constants.ENV.SOCKET_CLI_API_TOKEN = 'explicit-env-token'
      expect(isOAuthLoginActive()).toBe(false)
      constants.ENV.SOCKET_CLI_API_TOKEN = ''

      constants.ENV.SOCKET_CLI_NO_API_TOKEN = true
      expect(isOAuthLoginActive()).toBe(false)
    })

    it('does not read persisted OAuth credentials for a config override', async () => {
      mockIsConfigFromFlag.mockReturnValue(true)
      mockGetConfigValueOrUndef.mockImplementation((key: string) =>
        key === 'authType' ? 'oauth' : undefined,
      )

      expect(hasDefaultApiToken()).toBe(false)
      await expect(resolveDefaultApiToken()).resolves.toBeUndefined()
      expect(mockReadOAuthCredentials).not.toHaveBeenCalled()
      expect(mockResolveOAuthAccessToken).not.toHaveBeenCalled()
    })

    it('keeps corrupt OAuth state from crashing preflight or falling back', async () => {
      mockGetConfigValueOrUndef.mockImplementation((key: string) =>
        key === 'authType' ? 'oauth' : undefined,
      )
      mockReadOAuthCredentials.mockImplementation(() => {
        throw new Error('Saved OAuth credentials are corrupt')
      })

      expect(hasDefaultApiToken()).toBe(true)
      await expect(resolveDefaultApiToken()).rejects.toThrow(
        'Saved OAuth credentials are corrupt',
      )
      expect(mockResolveOAuthAccessToken).not.toHaveBeenCalled()
    })

    it('refuses to send the OAuth access token to a custom API origin', async () => {
      mockGetConfigValueOrUndef.mockImplementation((key: string) =>
        key === 'authType' ? 'oauth' : undefined,
      )
      mockReadOAuthCredentials.mockReturnValue({
        apiOrigin: 'https://api.socket.dev',
        accessToken: 'oauth-token',
      })

      await expect(
        resolveDefaultApiToken({ apiBaseUrl: 'https://example.test/v0/' }),
      ).rejects.toThrow(/trusted API origin/)
      expect(mockResolveOAuthAccessToken).not.toHaveBeenCalled()
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

    it('should pass an explicit agent with no idle timeout by default', async () => {
      // Regression: Node >=19's global agent applies a 5s socket inactivity
      // timeout. Requests made without an explicit agent inherit it, so
      // uploadManifestFiles (which streams a chunked multipart body while the
      // server parses auth/multipart before responding) was torn down at ~5s
      // with no response. setupSdk must always supply an explicit agent that
      // has no such timeout.
      const result = await setupSdk({ apiToken: 'test-token' })

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.options.agent).toBeDefined()
        expect(MockHttpsAgent).toHaveBeenCalled()
        const agentOpts = MockHttpsAgent.mock.calls.at(-1)?.[0]
        expect(agentOpts?.timeout).toBeUndefined()
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

describe('getCliUserAgent', () => {
  it('formats name/version, node version, and platform/arch', () => {
    const userAgent = getCliUserAgent()

    expect(userAgent).toBe(
      `socket-cli/1.1.34 node/${process.version} ${process.platform}/${process.arch}`,
    )
  })

  it('returns a stable value across repeated calls', () => {
    const first = getCliUserAgent()
    const second = getCliUserAgent()

    expect(second).toBe(first)
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

  it('should create a default HttpsAgent with no timeout when no proxy or CA certs are configured', async () => {
    const { setupSdk: fn } = await import('./sdk.mts')
    const result = await fn({ apiToken: 'test-token' })

    expect(result.ok).toBe(true)
    if (result.ok) {
      // The default branch must still pass an explicit agent so requests do
      // not inherit Node's global agent (keepAlive plus a 5s socket timeout).
      expect(result.data.options.agent).toBeDefined()
      expect(MockHttpsAgent).toHaveBeenCalledTimes(1)
      // A fresh agent carries no timeout, so no per-socket inactivity timeout.
      const agentOpts = MockHttpsAgent.mock.calls[0]?.[0]
      expect(agentOpts?.timeout).toBeUndefined()
    }
  })
})

describe('clampApiTimeout', () => {
  it('should leave an in-range timeout unchanged', () => {
    expect(clampApiTimeout(5_000)).toBe(5_000)
    expect(clampApiTimeout(60_000)).toBe(60_000)
    expect(clampApiTimeout(300_000)).toBe(300_000)
  })

  it('should raise a below-minimum timeout to the floor', () => {
    expect(clampApiTimeout(1_000)).toBe(5_000)
    expect(clampApiTimeout(1)).toBe(5_000)
  })

  it('should lower an above-maximum timeout to the ceiling', () => {
    expect(clampApiTimeout(999_999)).toBe(300_000)
    expect(clampApiTimeout(300_001)).toBe(300_000)
  })
})
