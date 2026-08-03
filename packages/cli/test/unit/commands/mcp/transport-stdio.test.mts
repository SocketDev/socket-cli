/**
 * Unit tests for the MCP stdio transport runner.
 *
 * Tests runStdioTransport(config) — hands the server factory to the SDK's
 * `serveStdio` entry, which owns the transport and the era decision for the
 * connection.
 *
 * Test Coverage: - Logger emits the start + ready messages - serveStdio is
 * handed a factory, not one instance - the factory builds the server with the
 * supplied config, freshly per call - the returned connection handle is passed
 * through - the onerror callback routes SDK errors to the logger - Errors from
 * serveStdio propagate to the caller.
 *
 * Related Files: - src/commands/mcp/transport-stdio.mts - Implementation -
 * src/commands/mcp/server.mts - Server factory, mocked here.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { runStdioTransport } from '../../../../src/commands/mcp/transport-stdio.mts'

import type * as LoggerModule from '@socketsecurity/lib-stable/logger/default'

const mockLogger = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
  log: vi.fn(),
}))

vi.mock(
  import('@socketsecurity/lib-stable/logger/default'),
  async importOriginal => {
    const actual = await importOriginal<typeof LoggerModule>()
    return {
      ...actual,
      getDefaultLogger: () => mockLogger,
    }
  },
)

const { mockCreateConfiguredServer } = vi.hoisted(() => ({
  mockCreateConfiguredServer: vi.fn(() => ({
    close: vi.fn().mockResolvedValue(undefined),
    connect: vi.fn().mockResolvedValue(undefined),
  })),
}))

vi.mock(import('../../../../src/commands/mcp/server.mts'), () => ({
  createConfiguredServer: mockCreateConfiguredServer,
}))

const { mockHandle, mockServeStdio } = vi.hoisted(() => {
  const handle = { close: vi.fn().mockResolvedValue(undefined) }
  return {
    mockHandle: handle,
    mockServeStdio: vi.fn(() => handle),
  }
})

vi.mock(import('@modelcontextprotocol/server/stdio'), () => ({
  serveStdio: mockServeStdio,
}))

const baseConfig = {
  getApiToken: () => 'test_a',
  serverName: 'socket',
  version: '1.2.3',
}

beforeEach(() => {
  vi.clearAllMocks()
  mockServeStdio.mockReturnValue(mockHandle)
})

describe('runStdioTransport', () => {
  it('logs the start message before serving', () => {
    runStdioTransport(baseConfig)
    expect(mockLogger.info).toHaveBeenNthCalledWith(
      1,
      'Starting Socket MCP server in stdio mode',
    )
  })

  it('hands serveStdio a factory rather than one server instance', () => {
    runStdioTransport(baseConfig)
    expect(mockServeStdio).toHaveBeenCalledTimes(1)
    expect(typeof mockServeStdio.mock.calls[0]![0]).toBe('function')
    // serveStdio calls the factory itself — including for the discarded
    // `server/discover` probe — so nothing may be built eagerly.
    expect(mockCreateConfiguredServer).not.toHaveBeenCalled()
  })

  it('builds a fresh server from the supplied config on every factory call', () => {
    runStdioTransport(baseConfig)
    const factory = mockServeStdio.mock.calls[0]![0] as () => unknown
    const first = factory()
    const second = factory()
    expect(mockCreateConfiguredServer).toHaveBeenCalledTimes(2)
    expect(mockCreateConfiguredServer).toHaveBeenCalledWith(baseConfig)
    expect(first).not.toBe(second)
  })

  it('routes SDK errors to the logger through onerror', () => {
    runStdioTransport(baseConfig)
    const options = mockServeStdio.mock.calls[0]![1] as {
      onerror: (error: Error) => void
    }
    options.onerror(new Error('stdio boom'))
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Socket MCP stdio error: stdio boom',
    )
  })

  it('logs the ready message after serveStdio returns', () => {
    runStdioTransport(baseConfig)
    expect(mockLogger.info).toHaveBeenCalledWith(
      'Socket MCP server version 1.2.3 started successfully (stdio)',
    )
  })

  it('returns the connection handle from serveStdio', () => {
    expect(runStdioTransport(baseConfig)).toBe(mockHandle)
  })

  it('propagates errors from serveStdio to the caller', () => {
    mockServeStdio.mockImplementationOnce(() => {
      throw new Error('transport boom')
    })
    expect(() => runStdioTransport(baseConfig)).toThrow('transport boom')
  })

  it('uses the version from config in the success message', () => {
    runStdioTransport({ ...baseConfig, version: '99.0.0' })
    expect(mockLogger.info).toHaveBeenCalledWith(
      'Socket MCP server version 99.0.0 started successfully (stdio)',
    )
  })
})
