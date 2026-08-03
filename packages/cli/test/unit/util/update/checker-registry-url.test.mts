/**
 * Unit tests for npm registry URL validation in the update checker.
 *
 * Purpose: The registry URL comes from `.npmrc`, which a checked-out repo can
 * supply, and the matching auth token rides along in the Authorization header.
 * These tests cover the SSRF guard on that URL — private / link-local hosts and
 * non-http(s) schemes are refused unless the operator allowlists the hostname —
 * plus the non-empty and public-default cases.
 *
 * Related Files: - util/update/checker.mts (implementation) -
 * util/url/safe-endpoint.mts (guard) - checker.test.mts.
 */

import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock https module.
const mockRequest = vi.hoisted(() => vi.fn())
vi.mock(import('node:https'), () => ({
  default: {
    request: mockRequest,
  },
  request: mockRequest,
}))

// Mock signal-exit.
vi.mock(import('@socketsecurity/lib-stable/events/exit/handler'), () => ({
  onExit: vi.fn(() => () => {}),
}))

// Mock logger.
vi.mock(import('@socketsecurity/lib-stable/logger/default'), () => ({
  getDefaultLogger: () => ({
    log: vi.fn(),
    warn: vi.fn(),
  }),
}))

import { NetworkUtils } from '../../../../src/util/update/checker.mts'

interface MockResponse extends EventEmitter {
  statusCode: number
  statusMessage: string
  headers: Record<string, string>
}

interface MockRequest extends EventEmitter {
  destroy: () => void
  end: () => void
}

function createMockRequest(): MockRequest {
  const req = new EventEmitter() as MockRequest
  req.destroy = vi.fn()
  req.end = vi.fn()
  return req
}

function createMockResponse(statusCode: number): MockResponse {
  const res = new EventEmitter() as MockResponse
  res.statusCode = statusCode
  res.statusMessage = statusCode === 200 ? 'OK' : 'Error'
  res.headers = { 'content-type': 'application/json' }
  return res
}

// Answer the next https.request with a 200 carrying `{ version }`.
function stubRegistryVersionResponse(version: string): void {
  const mockRes = createMockResponse(200)
  const mockReq = createMockRequest()
  mockRequest.mockImplementation((_options, callback) => {
    process.nextTick(() => {
      callback(mockRes)
      process.nextTick(() => {
        mockRes.emit('data', JSON.stringify({ version }))
        mockRes.emit('end')
      })
    })
    return mockReq
  })
}

describe('update/checker registry URL', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('throws when registryUrl is an explicit empty string', async () => {
    await expect(
      NetworkUtils.getLatestVersion('test', { registryUrl: '' }),
    ).rejects.toThrow(
      /getLatestVersion options\.registryUrl must be a non-empty string/,
    )
  })

  it('throws error for invalid registry URL', async () => {
    await expect(
      NetworkUtils.getLatestVersion('test', { registryUrl: 'not-a-url' }),
    ).rejects.toThrow(/npm registry URL is refused/)
  })

  it('refuses an RFC-1918 registry host', async () => {
    await expect(
      NetworkUtils.getLatestVersion('test', {
        registryUrl: 'https://10.0.0.5/',
      }),
    ).rejects.toThrow(/npm registry URL is refused/)
  })

  it('refuses the cloud metadata address as a registry', async () => {
    await expect(
      NetworkUtils.getLatestVersion('test', {
        registryUrl: 'http://169.254.169.254/',
      }),
    ).rejects.toThrow(/npm registry URL is refused/)
  })

  it('refuses a non-http(s) registry scheme', async () => {
    await expect(
      NetworkUtils.getLatestVersion('test', {
        registryUrl: 'file:///etc/passwd',
      }),
    ).rejects.toThrow(/must use http\(s\)/)
  })

  it('names .npmrc in the refusal', async () => {
    await expect(
      NetworkUtils.getLatestVersion('test', {
        registryUrl: 'https://10.0.0.5/',
      }),
    ).rejects.toThrow(/\.npmrc/)
  })

  it('names the escape hatch in the refusal', async () => {
    await expect(
      NetworkUtils.getLatestVersion('test', {
        registryUrl: 'https://10.0.0.5/',
      }),
    ).rejects.toThrow(/SOCKET_CLI_ALLOWED_PRIVATE_HOSTS/)
  })

  it('permits a private registry listed in SOCKET_CLI_ALLOWED_PRIVATE_HOSTS', async () => {
    vi.stubEnv('SOCKET_CLI_ALLOWED_PRIVATE_HOSTS', '10.0.0.5')
    stubRegistryVersionResponse('1.0.0')

    const result = await NetworkUtils.getLatestVersion('test', {
      registryUrl: 'https://10.0.0.5/',
    })

    expect(result).toBe('1.0.0')
    expect(mockRequest.mock.calls[0]?.[0].hostname).toBe('10.0.0.5')
  })

  it('uses the public npm registry by default', async () => {
    stubRegistryVersionResponse('1.0.0')

    await NetworkUtils.getLatestVersion('test')

    expect(mockRequest.mock.calls[0]?.[0].hostname).toBe('registry.npmjs.org')
  })

  it('accepts a public custom registry over https', async () => {
    stubRegistryVersionResponse('1.0.0')

    await NetworkUtils.getLatestVersion('test', {
      registryUrl: 'https://custom.registry.com',
    })

    expect(mockRequest.mock.calls[0]?.[0].hostname).toBe('custom.registry.com')
  })
})
