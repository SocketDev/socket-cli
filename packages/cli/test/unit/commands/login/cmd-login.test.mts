/**
 * Unit tests for login command.
 *
 * Tests the command entry point that handles Socket API authentication
 * and stores credentials for subsequent CLI operations.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { InputError } from '../../../../src/utils/error/errors.mjs'

// Mock the logger.
const mockLogger = vi.hoisted(() => ({
  error: vi.fn(),
  fail: vi.fn(),
  info: vi.fn(),
  log: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
}))

vi.mock('@socketsecurity/lib/logger', () => ({
  getDefaultLogger: () => mockLogger,
}))

// Mock isInteractive.
const mockIsInteractive = vi.hoisted(() => vi.fn().mockReturnValue(true))

vi.mock('@socketregistry/is-interactive/index.cjs', () => ({
  default: mockIsInteractive,
}))

// Mock attemptLogin.
const mockAttemptLogin = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))

vi.mock('../../../../src/commands/login/attempt-login.mts', () => ({
  attemptLogin: mockAttemptLogin,
}))

// Mock outputDryRunWrite.
const mockOutputDryRunWrite = vi.hoisted(() => vi.fn())

vi.mock('../../../../src/utils/dry-run/output.mts', () => ({
  outputDryRunWrite: mockOutputDryRunWrite,
}))

// Import after mocks.
const { cmdLogin, CMD_NAME } =
  await import('../../../../src/commands/login/cmd-login.mts')

describe('cmd-login', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsInteractive.mockReturnValue(true)
    process.exitCode = undefined
  })

  describe('command metadata', () => {
    it('should have correct command name', () => {
      expect(CMD_NAME).toBe('login')
    })

    it('should have correct description', () => {
      expect(cmdLogin.description).toBe(
        'Setup Socket CLI with an API token and defaults',
      )
    })

    it('should not be hidden', () => {
      expect(cmdLogin.hidden).toBe(false)
    })
  })

  describe('run', () => {
    const importMeta = { url: 'file:///test/cmd-login.mts' }
    const context = { parentName: 'socket' }

    describe('help flag', () => {
      it('should display help text with --help flag', async () => {
        await expect(
          cmdLogin.run(['--help'], importMeta, context),
        ).rejects.toThrow()

        expect(mockAttemptLogin).not.toHaveBeenCalled()
      })
    })

    describe('dry-run flag', () => {
      it('should show preview without performing login', async () => {
        await cmdLogin.run(['--dry-run'], importMeta, context)

        expect(mockOutputDryRunWrite).toHaveBeenCalledWith(
          expect.stringContaining('config.json'),
          'authenticate with Socket API',
          expect.arrayContaining([
            'Prompt for Socket API token',
            'Verify token with Socket API',
            'Save API token to config',
            'Optionally set default organization',
            'Optionally install bash completion',
          ]),
        )
        expect(mockAttemptLogin).not.toHaveBeenCalled()
      })

      it('should not perform authentication in dry-run mode', async () => {
        await cmdLogin.run(['--dry-run'], importMeta, context)

        expect(mockAttemptLogin).not.toHaveBeenCalled()
      })
    })

    describe('non-interactive shell', () => {
      it('should throw InputError when not in interactive shell', async () => {
        mockIsInteractive.mockReturnValue(false)

        await expect(cmdLogin.run([], importMeta, context)).rejects.toThrow(
          /socket login needs an interactive TTY/,
        )
        expect(mockAttemptLogin).not.toHaveBeenCalled()
      })

      it('should suggest using SOCKET_CLI_API_TOKEN environment variable', async () => {
        mockIsInteractive.mockReturnValue(false)

        try {
          await cmdLogin.run([], importMeta, context)
          expect.fail('Should have thrown an error')
        } catch (e) {
          const error = e as InputError
          expect(error.message).toContain('SOCKET_CLI_API_TOKEN')
        }
      })
    })

    describe('login execution', () => {
      it('should call attemptLogin with empty strings by default', async () => {
        await cmdLogin.run([], importMeta, context)

        expect(mockAttemptLogin).toHaveBeenCalledWith('', '')
      })

      it('should pass API base URL when provided', async () => {
        await cmdLogin.run(
          ['--api-base-url=https://api.example.com'],
          importMeta,
          context,
        )

        expect(mockAttemptLogin).toHaveBeenCalledWith(
          'https://api.example.com',
          '',
        )
      })

      it('should pass API proxy when provided', async () => {
        await cmdLogin.run(
          ['--api-proxy=http://localhost:8080'],
          importMeta,
          context,
        )

        expect(mockAttemptLogin).toHaveBeenCalledWith(
          '',
          'http://localhost:8080',
        )
      })

      it('should pass both API base URL and proxy when provided', async () => {
        await cmdLogin.run(
          [
            '--api-base-url=https://api.example.com',
            '--api-proxy=http://localhost:8080',
          ],
          importMeta,
          context,
        )

        expect(mockAttemptLogin).toHaveBeenCalledWith(
          'https://api.example.com',
          'http://localhost:8080',
        )
      })

      it('should handle empty string API base URL', async () => {
        await cmdLogin.run(['--api-base-url='], importMeta, context)

        expect(mockAttemptLogin).toHaveBeenCalledWith('', '')
      })

      it('should handle empty string API proxy', async () => {
        await cmdLogin.run(['--api-proxy='], importMeta, context)

        expect(mockAttemptLogin).toHaveBeenCalledWith('', '')
      })
    })

    describe('flag validation', () => {
      it('should accept valid --api-base-url format', async () => {
        const validUrls = [
          'https://api.socket.dev',
          'http://localhost:3000',
          'https://staging.example.com',
        ]

        for (const url of validUrls) {
          mockAttemptLogin.mockClear()
          await cmdLogin.run([`--api-base-url=${url}`], importMeta, context)
          expect(mockAttemptLogin).toHaveBeenCalledWith(url, '')
        }
      })

      it('should accept valid --api-proxy format', async () => {
        const validProxies = [
          'http://localhost:1234',
          'https://proxy.example.com:8080',
          'socks5://127.0.0.1:9050',
        ]

        for (const proxy of validProxies) {
          mockAttemptLogin.mockClear()
          await cmdLogin.run([`--api-proxy=${proxy}`], importMeta, context)
          expect(mockAttemptLogin).toHaveBeenCalledWith('', proxy)
        }
      })
    })

    describe('error handling', () => {
      it('should propagate errors from attemptLogin', async () => {
        const testError = new Error('Authentication failed')
        mockAttemptLogin.mockRejectedValue(testError)

        await expect(cmdLogin.run([], importMeta, context)).rejects.toThrow(
          'Authentication failed',
        )
      })

      it('should not call attemptLogin when dry-run is enabled', async () => {
        await cmdLogin.run(['--dry-run'], importMeta, context)

        expect(mockAttemptLogin).not.toHaveBeenCalled()
      })

      it('should not call attemptLogin when not interactive', async () => {
        mockIsInteractive.mockReturnValue(false)

        await expect(cmdLogin.run([], importMeta, context)).rejects.toThrow()
        expect(mockAttemptLogin).not.toHaveBeenCalled()
      })
    })

    describe('execution flow', () => {
      it('should check interactivity before calling attemptLogin', async () => {
        mockIsInteractive.mockReturnValue(true)
        mockAttemptLogin.mockResolvedValue(undefined)

        await cmdLogin.run([], importMeta, context)

        expect(mockIsInteractive).toHaveBeenCalled()
        expect(mockAttemptLogin).toHaveBeenCalled()
      })

      it('should call attemptLogin exactly once per successful run', async () => {
        mockAttemptLogin.mockResolvedValue(undefined)

        await cmdLogin.run([], importMeta, context)

        expect(mockAttemptLogin).toHaveBeenCalledTimes(1)
      })
    })
  })
})
