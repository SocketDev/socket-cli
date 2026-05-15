/**
 * Unit tests for the MCP stdio transport runner.
 *
 * Tests runStdioTransport(config) — wires a fresh server through the
 * StdioServerTransport and connects it.
 *
 * Test Coverage:
 * - Logger emits the start + ready messages
 * - createConfiguredServer is called with the supplied config
 * - StdioServerTransport is instantiated
 * - server.connect(transport) is awaited (function resolves only after
 *   the underlying connect resolves)
 * - Errors from connect propagate to the caller
 *
 * Related Files:
 * - src/commands/mcp/transport-stdio.mts - Implementation
 * - src/commands/mcp/server.mts - Server factory (mocked here)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as LoggerModule from '@socketsecurity/lib-stable/logger'

const mockLogger = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
  log: vi.fn(),
}))

vi.mock('@socketsecurity/lib/logger', async importOriginal => {
  const actual = await importOriginal<typeof LoggerModule>()
  return {
    ...actual,
    getDefaultLogger: () => mockLogger,
  }
})

const { mockConnect, mockServer, mockCreateConfiguredServer } = vi.hoisted(
  () => {
    const connect = vi.fn().mockResolvedValue(undefined)
    const server = { connect, close: vi.fn().mockResolvedValue(undefined) }
    return {
      mockConnect: connect,
      mockServer: server,
      mockCreateConfiguredServer: vi.fn(() => server),
    }
  },
)

vi.mock('../../../../src/commands/mcp/server.mts', () => ({
  createConfiguredServer: mockCreateConfiguredServer,
}))

const { mockStdioTransportInstance, MockStdioServerTransport } = vi.hoisted(
  () => {
    const instance = { stdioTag: true }
    // vi.fn() is not constructable; use a real class so `new T()` works.
    class StdioCtor {
      stdioTag = true
      constructor() {
        StdioCtor.calls.push([])
        // Return the singleton so the test can assert identity.
        return instance
      }
      static calls: unknown[][] = []
    }
    return {
      mockStdioTransportInstance: instance,
      MockStdioServerTransport: StdioCtor,
    }
  },
)

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: MockStdioServerTransport,
}))

const { runStdioTransport } =
  await import('../../../../src/commands/mcp/transport-stdio.mts')

const baseConfig = {
  getApiToken: () => 'test_a',
  serverName: 'socket',
  version: '1.2.3',
}

beforeEach(() => {
  vi.clearAllMocks()
  MockStdioServerTransport.calls.length = 0
  mockConnect.mockResolvedValue(undefined)
})

describe('runStdioTransport', () => {
  it('logs the start message before connecting', async () => {
    await runStdioTransport(baseConfig)
    expect(mockLogger.info).toHaveBeenNthCalledWith(
      1,
      'Starting Socket MCP server in stdio mode',
    )
  })

  it('builds the server with the supplied config', async () => {
    await runStdioTransport(baseConfig)
    expect(mockCreateConfiguredServer).toHaveBeenCalledWith(baseConfig)
  })

  it('instantiates StdioServerTransport (no constructor args)', async () => {
    await runStdioTransport(baseConfig)
    expect(MockStdioServerTransport.calls).toHaveLength(1)
    expect(MockStdioServerTransport.calls[0]).toEqual([])
  })

  it('connects the server to the stdio transport', async () => {
    await runStdioTransport(baseConfig)
    expect(mockConnect).toHaveBeenCalledTimes(1)
    expect(mockConnect.mock.calls[0]![0]).toBe(mockStdioTransportInstance)
  })

  it('logs the ready message after connect resolves', async () => {
    let connectResolve!: () => void
    mockConnect.mockReturnValueOnce(
      new Promise<void>(resolve => {
        connectResolve = resolve
      }),
    )
    const promise = runStdioTransport(baseConfig)
    // Before connect resolves, the success log should not have fired.
    expect(mockLogger.info).toHaveBeenCalledWith(
      'Starting Socket MCP server in stdio mode',
    )
    expect(mockLogger.info).not.toHaveBeenCalledWith(
      expect.stringContaining('started successfully'),
    )
    connectResolve()
    await promise
    expect(mockLogger.info).toHaveBeenCalledWith(
      'Socket MCP server version 1.2.3 started successfully (stdio)',
    )
  })

  it('propagates errors from server.connect to the caller', async () => {
    mockConnect.mockRejectedValueOnce(new Error('transport boom'))
    await expect(runStdioTransport(baseConfig)).rejects.toThrow(
      'transport boom',
    )
  })

  it('uses the version from config in the success message', async () => {
    await runStdioTransport({ ...baseConfig, version: '99.0.0' })
    expect(mockLogger.info).toHaveBeenCalledWith(
      'Socket MCP server version 99.0.0 started successfully (stdio)',
    )
  })

  // Quick: the mocked server is unused except as a connect target.
  // Ensure we didn't accidentally also call .close() in the happy path.
  it('does not close the server during normal startup', async () => {
    await runStdioTransport(baseConfig)
    expect(mockServer.close).not.toHaveBeenCalled()
  })
})
