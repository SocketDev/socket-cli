/**
 * Unit tests for the `socket mcp` CLI entry point.
 *
 * Tests cmdMcp.run(argv, importMeta, ctx) — argv parsing, env-var
 * fallbacks, flag → handleMcp option translation. Mocks meowOrExit
 * to bypass the real CLI parser and feed pre-shaped flag values.
 *
 * Test Coverage:
 * - Command metadata (description, hidden)
 * - Default mode is stdio
 * - --http flag flips to HTTP mode
 * - MCP_HTTP_MODE=true env var also flips to HTTP mode
 * - --port flag forwarded; defaults to 3000 when missing
 * - MCP_PORT env var fallback when --port not set
 * - --trust-proxy flag + TRUST_PROXY=true env fallback
 * - --oauth-issuer / --oauth-client-id / --oauth-client-secret
 *   flags + matching SOCKET_OAUTH_* env fallbacks
 * - --oauth-required-scopes parses whitespace-separated string into
 *   array; empty string yields undefined (handler picks default)
 * - All flags forwarded to handleMcp with the right shape
 *
 * Related Files:
 * - src/commands/mcp/cmd-mcp.mts - Implementation
 * - src/commands/mcp/handle-mcp.mts - Dispatcher (mocked)
 * - src/utils/cli/with-subcommands.mts - meowOrExit (mocked)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as LoggerModule from '@socketsecurity/lib-stable/logger'
import type * as WithSubcommandsModule from '../../../../src/utils/cli/with-subcommands.mjs'

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

const { mockHandleMcp, mockMeowOrExit } = vi.hoisted(() => ({
  mockHandleMcp: vi.fn().mockResolvedValue(undefined),
  // The cmd-mcp.mts run() reads cli.flags.<x>. Build a flags object
  // from the argv each test passes in, mimicking what meowOrExit
  // would produce. We parse a tiny subset of argv to keep the test
  // realistic (the real parsing is exercised in meow.test.mts).
  mockMeowOrExit: vi.fn((input: { argv: string[] | readonly string[] }) => {
    const argv = [...input.argv]
    const flags: Record<string, unknown> = {
      http: false,
      'oauth-client-id': '',
      'oauth-client-secret': '',
      'oauth-issuer': '',
      'oauth-required-scopes': '',
      port: 3000,
      'trust-proxy': false,
    }
    for (let i = 0; i < argv.length; i++) {
      const a = argv[i]!
      if (a === '--http') {
        flags['http'] = true
      } else if (a === '--trust-proxy') {
        flags['trust-proxy'] = true
      } else if (a === '--port') {
        flags['port'] = Number(argv[++i])
      } else if (a.startsWith('--port=')) {
        flags['port'] = Number(a.slice('--port='.length))
      } else if (a === '--oauth-issuer') {
        flags['oauth-issuer'] = argv[++i]
      } else if (a === '--oauth-client-id') {
        flags['oauth-client-id'] = argv[++i]
      } else if (a === '--oauth-client-secret') {
        flags['oauth-client-secret'] = argv[++i]
      } else if (a === '--oauth-required-scopes') {
        flags['oauth-required-scopes'] = argv[++i]
      }
    }
    return {
      flags,
      help: '',
      input: [],
      pkg: {},
      showHelp: vi.fn(),
      showVersion: vi.fn(),
      unknownFlags: [],
    }
  }),
}))

vi.mock('../../../../src/commands/mcp/handle-mcp.mts', () => ({
  handleMcp: mockHandleMcp,
}))

vi.mock(
  '../../../../src/utils/cli/with-subcommands.mjs',
  async importOriginal => {
    const actual = await importOriginal<typeof WithSubcommandsModule>()
    return {
      ...actual,
      meowOrExit: mockMeowOrExit,
    }
  },
)

const { cmdMcp } = await import('../../../../src/commands/mcp/cmd-mcp.mts')

const importMeta = { url: 'file:///test/cmd-mcp.mts' }
const context = { parentName: 'socket' }

const ENV_KEYS = [
  'MCP_HTTP_MODE',
  'MCP_PORT',
  'SOCKET_OAUTH_INTROSPECTION_CLIENT_ID',
  'SOCKET_OAUTH_INTROSPECTION_CLIENT_SECRET',
  'SOCKET_OAUTH_ISSUER',
  'SOCKET_OAUTH_REQUIRED_SCOPES',
  'TRUST_PROXY',
] as const

const savedEnv: Record<string, string | undefined> = {}

beforeEach(() => {
  vi.clearAllMocks()
  for (let i = 0, { length } = ENV_KEYS; i < length; i += 1) {
    const k = ENV_KEYS[i]
    savedEnv[k] = process.env[k]
    delete process.env[k]
  }
})

afterEach(() => {
  for (let i = 0, { length } = ENV_KEYS; i < length; i += 1) {
    const k = ENV_KEYS[i]
    if (savedEnv[k] === undefined) {
      delete process.env[k]
    } else {
      process.env[k] = savedEnv[k]
    }
  }
})

describe('cmdMcp — metadata', () => {
  it('has the right description', () => {
    expect(cmdMcp.description).toContain('MCP')
  })

  it('is not hidden from help', () => {
    expect(cmdMcp.hidden).toBe(false)
  })
})

describe('cmdMcp — mode selection', () => {
  it('defaults to stdio mode', async () => {
    await cmdMcp.run([], importMeta, context)
    expect(mockHandleMcp).toHaveBeenCalledWith(
      expect.objectContaining({ http: false }),
    )
  })

  it('switches to HTTP mode with --http', async () => {
    await cmdMcp.run(['--http'], importMeta, context)
    expect(mockHandleMcp).toHaveBeenCalledWith(
      expect.objectContaining({ http: true }),
    )
  })

  it('switches to HTTP mode when MCP_HTTP_MODE=true', async () => {
    process.env['MCP_HTTP_MODE'] = 'true'
    await cmdMcp.run([], importMeta, context)
    expect(mockHandleMcp).toHaveBeenCalledWith(
      expect.objectContaining({ http: true }),
    )
  })

  it('does not switch on MCP_HTTP_MODE values other than literal "true"', async () => {
    process.env['MCP_HTTP_MODE'] = '1'
    await cmdMcp.run([], importMeta, context)
    expect(mockHandleMcp).toHaveBeenCalledWith(
      expect.objectContaining({ http: false }),
    )
  })
})

describe('cmdMcp — port flag', () => {
  it('defaults port to 3000 when no flag or env is set', async () => {
    await cmdMcp.run([], importMeta, context)
    expect(mockHandleMcp).toHaveBeenCalledWith(
      expect.objectContaining({ port: 3000 }),
    )
  })

  it('honors --port', async () => {
    await cmdMcp.run(['--port', '5151'], importMeta, context)
    expect(mockHandleMcp).toHaveBeenCalledWith(
      expect.objectContaining({ port: 5151 }),
    )
  })

  it('falls back to MCP_PORT env when no --port flag is given', async () => {
    process.env['MCP_PORT'] = '8081'
    // Clear the meow mock's default of 3000 so we can verify the env fallback.
    mockMeowOrExit.mockImplementationOnce(() => ({
      flags: {
        http: false,
        'oauth-client-id': '',
        'oauth-client-secret': '',
        'oauth-issuer': '',
        'oauth-required-scopes': '',
        port: 0, // sentinel: caller didn't supply
        'trust-proxy': false,
      },
      help: '',
      input: [],
      pkg: {},
      showHelp: vi.fn(),
      showVersion: vi.fn(),
      unknownFlags: [],
    }))
    await cmdMcp.run([], importMeta, context)
    expect(mockHandleMcp).toHaveBeenCalledWith(
      expect.objectContaining({ port: 8081 }),
    )
  })

  it('falls back to default 3000 when MCP_PORT is unset and flag is 0', async () => {
    // Clear MCP_PORT explicitly so the `process.env['MCP_PORT'] || \`${DEFAULT_PORT}\``
    // fallback chain hits the right-arm.
    delete process.env['MCP_PORT']
    mockMeowOrExit.mockImplementationOnce(() => ({
      flags: {
        http: false,
        'oauth-client-id': '',
        'oauth-client-secret': '',
        'oauth-issuer': '',
        'oauth-required-scopes': '',
        port: 0,
        'trust-proxy': false,
      },
      help: '',
      input: [],
      pkg: {},
      showHelp: vi.fn(),
      showVersion: vi.fn(),
      unknownFlags: [],
    }))
    await cmdMcp.run([], importMeta, context)
    expect(mockHandleMcp).toHaveBeenCalledWith(
      expect.objectContaining({ port: 3000 }),
    )
  })

  it('falls back to default 3000 when MCP_PORT is unparseable', async () => {
    process.env['MCP_PORT'] = 'notanumber'
    mockMeowOrExit.mockImplementationOnce(() => ({
      flags: {
        http: false,
        'oauth-client-id': '',
        'oauth-client-secret': '',
        'oauth-issuer': '',
        'oauth-required-scopes': '',
        port: 0,
        'trust-proxy': false,
      },
      help: '',
      input: [],
      pkg: {},
      showHelp: vi.fn(),
      showVersion: vi.fn(),
      unknownFlags: [],
    }))
    await cmdMcp.run([], importMeta, context)
    expect(mockHandleMcp).toHaveBeenCalledWith(
      expect.objectContaining({ port: 3000 }),
    )
  })
})

describe('cmdMcp — trust-proxy', () => {
  it('forwards --trust-proxy=true', async () => {
    await cmdMcp.run(['--trust-proxy'], importMeta, context)
    expect(mockHandleMcp).toHaveBeenCalledWith(
      expect.objectContaining({ trustProxy: true }),
    )
  })

  it('honors TRUST_PROXY=true env', async () => {
    process.env['TRUST_PROXY'] = 'true'
    await cmdMcp.run([], importMeta, context)
    expect(mockHandleMcp).toHaveBeenCalledWith(
      expect.objectContaining({ trustProxy: true }),
    )
  })

  it('defaults to false when neither flag nor env are set', async () => {
    await cmdMcp.run([], importMeta, context)
    expect(mockHandleMcp).toHaveBeenCalledWith(
      expect.objectContaining({ trustProxy: false }),
    )
  })
})

describe('cmdMcp — help text', () => {
  it('renders the help text with the command name interpolated', async () => {
    // The help: (command) => `…` callback is normally invoked by meow
    // when --help is passed. Capture the config we hand to meowOrExit
    // and invoke the help fn directly to exercise that branch.
    let capturedConfig: { help?: ((cmd: string) => string) | undefined } | undefined
    mockMeowOrExit.mockImplementationOnce(input => {
      capturedConfig = (input as { config: typeof capturedConfig }).config
      return {
        flags: {
          http: false,
          'oauth-client-id': '',
          'oauth-client-secret': '',
          'oauth-issuer': '',
          'oauth-required-scopes': '',
          port: 3000,
          'trust-proxy': false,
        },
        help: '',
        input: [],
        pkg: {},
        showHelp: vi.fn(),
        showVersion: vi.fn(),
        unknownFlags: [],
      }
    })
    await cmdMcp.run([], importMeta, context)
    const helpText = capturedConfig?.help?.('socket mcp') ?? ''
    expect(helpText).toContain('socket mcp [options]')
    expect(helpText).toContain('Modes')
    expect(helpText).toContain('Environment variables')
    expect(helpText).toContain('Examples')
    expect(helpText).toContain('SOCKET_API_TOKEN')
  })
})

describe('cmdMcp — OAuth flags', () => {
  it('forwards --oauth-issuer, --oauth-client-id, --oauth-client-secret', async () => {
    await cmdMcp.run(
      [
        '--http',
        '--oauth-issuer',
        'https://issuer.example',
        '--oauth-client-id',
        'cid',
        '--oauth-client-secret',
        'csec',
      ],
      importMeta,
      context,
    )
    expect(mockHandleMcp).toHaveBeenCalledWith(
      expect.objectContaining({
        http: true,
        oauthIssuer: 'https://issuer.example',
        oauthClientId: 'cid',
        oauthClientSecret: 'csec',
      }),
    )
  })

  it('falls back to SOCKET_OAUTH_* env vars when flags are empty', async () => {
    process.env['SOCKET_OAUTH_ISSUER'] = 'https://env-issuer'
    process.env['SOCKET_OAUTH_INTROSPECTION_CLIENT_ID'] = 'env-cid'
    process.env['SOCKET_OAUTH_INTROSPECTION_CLIENT_SECRET'] = 'env-csec'
    await cmdMcp.run(['--http'], importMeta, context)
    expect(mockHandleMcp).toHaveBeenCalledWith(
      expect.objectContaining({
        oauthIssuer: 'https://env-issuer',
        oauthClientId: 'env-cid',
        oauthClientSecret: 'env-csec',
      }),
    )
  })

  it('parses --oauth-required-scopes as whitespace-separated', async () => {
    await cmdMcp.run(
      ['--http', '--oauth-required-scopes', 'a:read  b:write'],
      importMeta,
      context,
    )
    expect(mockHandleMcp).toHaveBeenCalledWith(
      expect.objectContaining({
        oauthRequiredScopes: ['a:read', 'b:write'],
      }),
    )
  })

  it('passes oauthRequiredScopes=undefined when neither flag nor env are set', async () => {
    await cmdMcp.run(['--http'], importMeta, context)
    expect(mockHandleMcp).toHaveBeenCalledWith(
      expect.objectContaining({ oauthRequiredScopes: undefined }),
    )
  })

  it('parses SOCKET_OAUTH_REQUIRED_SCOPES env var', async () => {
    process.env['SOCKET_OAUTH_REQUIRED_SCOPES'] = 'scope:one scope:two'
    await cmdMcp.run(['--http'], importMeta, context)
    expect(mockHandleMcp).toHaveBeenCalledWith(
      expect.objectContaining({
        oauthRequiredScopes: ['scope:one', 'scope:two'],
      }),
    )
  })
})
