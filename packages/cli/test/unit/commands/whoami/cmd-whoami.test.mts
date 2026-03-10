/**
 * Unit tests for whoami command.
 *
 * Tests the command that displays authentication status and token information.
 *
 * Test Coverage:
 * - Command metadata (description, hidden flag)
 * - Token detection from environment variable
 * - Token detection from config file
 * - No token (unauthenticated) scenario
 * - Output formatting (JSON, text)
 * - Token masking and display
 *
 * Testing Approach:
 * - Mock logger to capture output
 * - Mock meowOrExit to control flag values and prevent process.exit
 * - Mock getDefaultApiToken from utils/socket/sdk.mts
 * - Mock getVisibleTokenPrefix from utils/socket/sdk.mts
 * - Mock SOCKET_CLI_API_TOKEN environment variable
 * - Mock getConfigValueOrUndef from utils/config.mts
 * - Test output format for authenticated/unauthenticated states
 * - Verify token display masking (TOKEN_PREFIX + visible prefix + ...)
 *
 * Related Files:
 * - src/commands/whoami/cmd-whoami.mts - Implementation
 * - src/utils/socket/sdk.mts - Token utilities
 * - src/utils/config.mts - Config file utilities
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the logger.
const mockLogger = vi.hoisted(() => ({
  error: vi.fn(),
  fail: vi.fn(),
  info: vi.fn(),
  log: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
}))

vi.mock('@socketsecurity/lib/logger', async importOriginal => {
  const actual = await importOriginal<typeof import('@socketsecurity/lib/logger')>()
  return {
    ...actual,
    getDefaultLogger: () => mockLogger,
  }
})

// Create mock functions with hoisting.
const {
  mockApiToken,
  mockGetConfigValueOrUndef,
  mockGetDefaultApiToken,
  mockGetVisibleTokenPrefix,
  mockMeowOrExit,
} = vi.hoisted(() => {
  return {
    mockApiToken: { value: undefined as string | undefined },
    mockGetConfigValueOrUndef: vi.fn(),
    mockGetDefaultApiToken: vi.fn(),
    mockGetVisibleTokenPrefix: vi.fn(),
    mockMeowOrExit: vi.fn((args: { argv: string[] | readonly string[] }) => {
      const flags: Record<string, unknown> = {}
      // Parse simple flags from argv.
      const argv = args.argv
      if (argv.includes('--json')) {
        flags['json'] = true
      }
      if (argv.includes('--markdown')) {
        flags['markdown'] = true
      }
      if (argv.includes('--dry-run')) {
        flags['dryRun'] = true
      }
      return {
        flags,
        help: '',
        input: [],
        pkg: {},
      }
    }),
  }
})

// Mock SOCKET_CLI_API_TOKEN environment variable.
vi.mock('../../../../src/env/socket-cli-api-token.mts', () => ({
  get SOCKET_CLI_API_TOKEN() {
    return mockApiToken.value
  },
}))

// Mock config utilities.
vi.mock('../../../../src/utils/config.mts', () => ({
  getConfigValueOrUndef: mockGetConfigValueOrUndef,
}))

// Mock SDK utilities.
vi.mock('../../../../src/utils/socket/sdk.mjs', () => ({
  getDefaultApiToken: mockGetDefaultApiToken,
  getVisibleTokenPrefix: mockGetVisibleTokenPrefix,
  hasDefaultApiToken: vi.fn(() => false),
}))

// Mock TOKEN_PREFIX constant to avoid security check false positives.
const MOCK_TOKEN_PREFIX = 'test_'
vi.mock('../../../../src/constants/socket.mjs', () => ({
  TOKEN_PREFIX: MOCK_TOKEN_PREFIX,
  TOKEN_PREFIX_LENGTH: MOCK_TOKEN_PREFIX.length,
}))

// Mock meowOrExit to prevent actual CLI parsing and process.exit.
vi.mock('../../../../src/utils/cli/with-subcommands.mjs', async importOriginal => {
  const actual =
    await importOriginal<
      typeof import('../../../../src/utils/cli/with-subcommands.mjs')
    >()
  return {
    ...actual,
    meowOrExit: mockMeowOrExit,
  }
})

// Import after mocks.
const { cmdWhoami } = await import(
  '../../../../src/commands/whoami/cmd-whoami.mts'
)

describe('cmd-whoami', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
    mockApiToken.value = undefined
  })

  describe('command metadata', () => {
    it('should have correct description', () => {
      expect(cmdWhoami.description).toBe(
        'Check Socket CLI authentication status',
      )
    })

    it('should not be hidden', () => {
      expect(cmdWhoami.hidden).toBe(false)
    })
  })

  describe('run', () => {
    const importMeta = { url: 'file:///test/cmd-whoami.mts' }
    const context = { parentName: 'socket' }

    describe('authenticated with token from environment variable', () => {
      beforeEach(() => {
        mockApiToken.value = 'test_fake_token_12345'
        mockGetDefaultApiToken.mockReturnValue('test_fake_token_12345')
        mockGetVisibleTokenPrefix.mockReturnValue('test1')
      })

      it('should display authenticated status in text format', async () => {
        await cmdWhoami.run([], importMeta, context)

        expect(mockGetDefaultApiToken).toHaveBeenCalled()
        expect(mockGetVisibleTokenPrefix).toHaveBeenCalled()
        expect(mockLogger.success).toHaveBeenCalledWith(
          'Authenticated with Socket',
        )
        expect(mockLogger.log).toHaveBeenCalledWith('  Token: test_test1...')
        expect(mockLogger.log).toHaveBeenCalledWith(
          '  Source: Environment variable (SOCKET_SECURITY_API_KEY)',
        )
      })

      it('should display authenticated status in JSON format', async () => {
        await cmdWhoami.run(['--json'], importMeta, context)

        expect(mockGetDefaultApiToken).toHaveBeenCalled()
        expect(mockGetVisibleTokenPrefix).toHaveBeenCalled()
        expect(mockLogger.log).toHaveBeenCalled()

        const jsonOutput = mockLogger.log.mock.calls[0][0]
        const result = JSON.parse(jsonOutput)

        expect(result).toEqual({
          ok: true,
          data: {
            authenticated: true,
            location: 'Environment variable (SOCKET_SECURITY_API_KEY)',
            token: 'test_test1...',
          },
        })
      })
    })

    describe('authenticated with token from config file', () => {
      beforeEach(() => {
        mockApiToken.value = undefined
        mockGetConfigValueOrUndef.mockReturnValue('test_fake_config_token')
        mockGetDefaultApiToken.mockReturnValue('test_fake_config_token')
        mockGetVisibleTokenPrefix.mockReturnValue('confi')
      })

      it('should display config file as token source in text format', async () => {
        await cmdWhoami.run([], importMeta, context)

        expect(mockGetDefaultApiToken).toHaveBeenCalled()
        expect(mockGetVisibleTokenPrefix).toHaveBeenCalled()
        expect(mockLogger.success).toHaveBeenCalledWith(
          'Authenticated with Socket',
        )
        expect(mockLogger.log).toHaveBeenCalledWith(
          '  Token: test_confi...',
        )
        expect(mockLogger.log).toHaveBeenCalledWith(
          '  Source: Config file (~/.config/socket/config.toml)',
        )
      })

      it('should display config file as token source in JSON format', async () => {
        await cmdWhoami.run(['--json'], importMeta, context)

        expect(mockLogger.log).toHaveBeenCalled()

        const jsonOutput = mockLogger.log.mock.calls[0][0]
        const result = JSON.parse(jsonOutput)

        expect(result).toEqual({
          ok: true,
          data: {
            authenticated: true,
            location: 'Config file (~/.config/socket/config.toml)',
            token: 'test_confi...',
          },
        })
      })
    })

    describe('not authenticated (no token)', () => {
      beforeEach(() => {
        mockApiToken.value = undefined
        mockGetConfigValueOrUndef.mockReturnValue(undefined)
        mockGetDefaultApiToken.mockReturnValue(undefined)
      })

      it('should display unauthenticated status in text format', async () => {
        await cmdWhoami.run([], importMeta, context)

        expect(mockGetDefaultApiToken).toHaveBeenCalled()
        expect(mockLogger.fail).toHaveBeenCalledWith(
          'Not authenticated with Socket',
        )
        expect(mockLogger.log).toHaveBeenCalledWith('')
        expect(mockLogger.log).toHaveBeenCalledWith(
          'To authenticate, run one of:',
        )
        expect(mockLogger.log).toHaveBeenCalledWith('  socket login')
        expect(mockLogger.log).toHaveBeenCalledWith(
          '  export SOCKET_SECURITY_API_KEY=<your-token>',
        )
      })

      it('should display unauthenticated status in JSON format', async () => {
        await cmdWhoami.run(['--json'], importMeta, context)

        expect(mockLogger.log).toHaveBeenCalled()

        const jsonOutput = mockLogger.log.mock.calls[0][0]
        const result = JSON.parse(jsonOutput)

        expect(result).toEqual({
          ok: true,
          data: {
            authenticated: false,
            location: null,
            token: null,
          },
        })
      })

      it('should not call getVisibleTokenPrefix when unauthenticated', async () => {
        await cmdWhoami.run([], importMeta, context)

        expect(mockGetVisibleTokenPrefix).not.toHaveBeenCalled()
      })

      it('should not display token when unauthenticated', async () => {
        await cmdWhoami.run([], importMeta, context)

        const logCalls = mockLogger.log.mock.calls.map(call => call[0]).join('\n')
        expect(logCalls).not.toContain('test_')
      })
    })

    describe('token priority', () => {
      it('should prioritize environment variable over config file', async () => {
        mockApiToken.value = 'test_env_token_value'
        mockGetConfigValueOrUndef.mockReturnValue('test_gtoken')
        mockGetDefaultApiToken.mockReturnValue('test_env_token_value')
        mockGetVisibleTokenPrefix.mockReturnValue('envto')

        await cmdWhoami.run([], importMeta, context)

        expect(mockLogger.log).toHaveBeenCalledWith(
          '  Source: Environment variable (SOCKET_SECURITY_API_KEY)',
        )
      })
    })

    describe('token masking', () => {
      it('should mask token with prefix and ellipsis', async () => {
        mockGetDefaultApiToken.mockReturnValue('test_masked_token_abc')
        mockGetVisibleTokenPrefix.mockReturnValue('abcde')

        await cmdWhoami.run([], importMeta, context)

        expect(mockLogger.log).toHaveBeenCalledWith(
          '  Token: test_abcde...',
        )
      })

      it('should show correct visible prefix length', async () => {
        mockGetDefaultApiToken.mockReturnValue('test_longer_token_xyz')
        mockGetVisibleTokenPrefix.mockReturnValue('xyz98')

        await cmdWhoami.run([], importMeta, context)

        expect(mockLogger.log).toHaveBeenCalledWith(
          '  Token: test_xyz98...',
        )
      })
    })

    describe('output format flags', () => {
      beforeEach(() => {
        mockGetDefaultApiToken.mockReturnValue('test_2345')
        mockGetVisibleTokenPrefix.mockReturnValue('test1')
      })

      it('should default to text format when no format flag provided', async () => {
        await cmdWhoami.run([], importMeta, context)

        expect(mockLogger.success).toHaveBeenCalledWith(
          'Authenticated with Socket',
        )
        expect(mockLogger.log).toHaveBeenCalledWith(
          expect.stringContaining('Token:'),
        )
      })

      it('should use JSON format when --json flag provided', async () => {
        await cmdWhoami.run(['--json'], importMeta, context)

        expect(mockLogger.success).not.toHaveBeenCalled()
        expect(mockLogger.log).toHaveBeenCalledWith(
          expect.stringContaining('"ok":'),
        )
      })
    })

    describe('edge cases', () => {
      it('should handle empty token gracefully', async () => {
        mockGetDefaultApiToken.mockReturnValue('')
        mockGetConfigValueOrUndef.mockReturnValue('')

        await cmdWhoami.run([], importMeta, context)

        expect(mockLogger.fail).toHaveBeenCalledWith(
          'Not authenticated with Socket',
        )
      })

      it('should not fail when config returns null', async () => {
        mockGetDefaultApiToken.mockReturnValue(null)
        mockGetConfigValueOrUndef.mockReturnValue(null)

        await cmdWhoami.run([], importMeta, context)

        expect(mockLogger.fail).toHaveBeenCalledWith(
          'Not authenticated with Socket',
        )
      })
    })
  })
})
