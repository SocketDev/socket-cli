/**
 * Unit tests for the MCP command handler.
 *
 * Tests handleMcp(opts) — the dispatcher that picks transport (stdio
 * vs HTTP), validates the OAuth + token combination, and forwards
 * to runStdioTransport / runHttpTransport.
 *
 * Test Coverage:
 * - stdio path with token configured → calls runStdioTransport with
 *   the right ServerConfig
 * - stdio path without token → logs error, exits with code 1
 * - HTTP path with all three OAuth fields → calls runHttpTransport
 *   with the OAuth config
 * - HTTP path with token (no OAuth) → calls runHttpTransport without
 *   throwing
 * - HTTP path with partial OAuth (issuer + clientId, no secret) →
 *   logs error, exits with code 1
 * - HTTP path without OAuth and without token → logs error, exits
 *   with code 1
 * - Custom oauthRequiredScopes forwarded
 * - Default scopes (`packages:list`) used when caller doesn't supply
 * - Version string read from constants ENV.INLINED_VERSION (with
 *   '0.0.0' fallback)
 *
 * Related Files:
 * - src/commands/mcp/handle-mcp.mts - Implementation
 * - src/commands/mcp/transport-stdio.mts - Stdio runner (mocked)
 * - src/commands/mcp/transport-http.mts - HTTP runner (mocked)
 * - src/utils/socket/sdk.mts - getDefaultApiToken (mocked)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockLogger = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
  log: vi.fn(),
}))

vi.mock('@socketsecurity/lib/logger', async importOriginal => {
  const actual =
    await importOriginal<typeof import('@socketsecurity/lib/logger')>()
  return {
    ...actual,
    getDefaultLogger: () => mockLogger,
  }
})

const { mockGetDefaultApiToken } = vi.hoisted(() => ({
  mockGetDefaultApiToken: vi.fn(),
}))

vi.mock('../../../../src/utils/socket/sdk.mts', () => ({
  getDefaultApiToken: mockGetDefaultApiToken,
}))

const { mockRunHttpTransport, mockRunStdioTransport } = vi.hoisted(() => ({
  mockRunHttpTransport: vi.fn().mockResolvedValue(undefined),
  mockRunStdioTransport: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../../../src/commands/mcp/transport-stdio.mts', () => ({
  runStdioTransport: mockRunStdioTransport,
}))

vi.mock('../../../../src/commands/mcp/transport-http.mts', () => ({
  runHttpTransport: mockRunHttpTransport,
}))

vi.mock('../../../../src/constants.mts', () => ({
  default: {
    ENV: {
      INLINED_VERSION: '7.7.7',
    },
  },
}))

const { handleMcp } = await import('../../../../src/commands/mcp/handle-mcp.mts')

const exitSpy = vi
  .spyOn(process, 'exit')
  .mockImplementation((_code?: string | number | null | undefined) => {
    // Throw so the test can assert "exit was called" without actually
    // killing the worker.
    throw new Error('process.exit called')
  })

beforeEach(() => {
  vi.clearAllMocks()
  mockGetDefaultApiToken.mockReturnValue('test_default_token')
})

describe('handleMcp — stdio path', () => {
  it('forwards to runStdioTransport with the resolved version + getApiToken', async () => {
    await handleMcp({
      http: false,
      port: 3000,
      trustProxy: false,
    })
    expect(mockRunStdioTransport).toHaveBeenCalledTimes(1)
    expect(mockRunHttpTransport).not.toHaveBeenCalled()
    const config = mockRunStdioTransport.mock.calls[0]![0]
    expect(config.serverName).toBe('socket')
    expect(config.version).toBe('7.7.7')
    expect(config.getApiToken()).toBe('test_default_token')
  })

  it('exits with code 1 when no token is configured', async () => {
    mockGetDefaultApiToken.mockReturnValue(undefined)
    await expect(
      handleMcp({ http: false, port: 3000, trustProxy: false }),
    ).rejects.toThrow('process.exit called')
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('No SOCKET_API_TOKEN configured'),
    )
    expect(exitSpy).toHaveBeenCalledWith(1)
    expect(mockRunStdioTransport).not.toHaveBeenCalled()
  })
})

describe('handleMcp — HTTP path', () => {
  it('forwards to runHttpTransport with all options when OAuth is fully configured', async () => {
    await handleMcp({
      http: true,
      oauthClientId: 'client-id',
      oauthClientSecret: 'client-secret',
      oauthIssuer: 'https://auth.example.com',
      port: 4000,
      trustProxy: true,
    })
    expect(mockRunHttpTransport).toHaveBeenCalledTimes(1)
    const config = mockRunHttpTransport.mock.calls[0]![0]
    expect(config.serverName).toBe('socket')
    expect(config.version).toBe('7.7.7')
    expect(config.oauthIssuer).toBe('https://auth.example.com')
    expect(config.oauthClientId).toBe('client-id')
    expect(config.oauthClientSecret).toBe('client-secret')
    expect(config.port).toBe(4000)
    expect(config.trustProxy).toBe(true)
  })

  it('uses the default OAuth scopes when caller omits them', async () => {
    await handleMcp({
      http: true,
      oauthClientId: 'a',
      oauthClientSecret: 'b',
      oauthIssuer: 'https://issuer',
      port: 3000,
      trustProxy: false,
    })
    const config = mockRunHttpTransport.mock.calls[0]![0]
    expect(config.oauthRequiredScopes).toEqual(['packages:list'])
  })

  it('forwards a custom oauthRequiredScopes list', async () => {
    await handleMcp({
      http: true,
      oauthClientId: 'a',
      oauthClientSecret: 'b',
      oauthIssuer: 'https://issuer',
      oauthRequiredScopes: ['foo:read', 'bar:write'],
      port: 3000,
      trustProxy: false,
    })
    const config = mockRunHttpTransport.mock.calls[0]![0]
    expect(config.oauthRequiredScopes).toEqual(['foo:read', 'bar:write'])
  })

  it('runs HTTP without OAuth when only the local token is set', async () => {
    await handleMcp({ http: true, port: 3000, trustProxy: false })
    expect(mockRunHttpTransport).toHaveBeenCalledTimes(1)
    const config = mockRunHttpTransport.mock.calls[0]![0]
    expect(config.oauthIssuer).toBe('')
    expect(config.oauthClientId).toBe('')
    expect(config.oauthClientSecret).toBe('')
  })

  it('exits with code 1 when OAuth is partially configured (issuer only)', async () => {
    await expect(
      handleMcp({
        http: true,
        oauthIssuer: 'https://issuer',
        port: 3000,
        trustProxy: false,
      }),
    ).rejects.toThrow('process.exit called')
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('Incomplete OAuth configuration'),
    )
    expect(mockRunHttpTransport).not.toHaveBeenCalled()
  })

  it('exits with code 1 when OAuth is partially configured (clientId only)', async () => {
    await expect(
      handleMcp({
        http: true,
        oauthClientId: 'client-id',
        port: 3000,
        trustProxy: false,
      }),
    ).rejects.toThrow('process.exit called')
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('Incomplete OAuth configuration'),
    )
  })

  it('exits with code 1 when OAuth is partially configured (clientSecret only)', async () => {
    await expect(
      handleMcp({
        http: true,
        oauthClientSecret: 'shh',
        port: 3000,
        trustProxy: false,
      }),
    ).rejects.toThrow('process.exit called')
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('Incomplete OAuth configuration'),
    )
  })

  it('exits with code 1 when neither OAuth nor a local token is set', async () => {
    mockGetDefaultApiToken.mockReturnValue(undefined)
    await expect(
      handleMcp({ http: true, port: 3000, trustProxy: false }),
    ).rejects.toThrow('process.exit called')
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('No SOCKET_API_TOKEN configured and OAuth is not enabled'),
    )
    expect(mockRunHttpTransport).not.toHaveBeenCalled()
  })
})
