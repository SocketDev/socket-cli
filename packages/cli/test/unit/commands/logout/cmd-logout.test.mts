/**
 * Unit tests for logout command.
 *
 * Tests the command that logs out of Socket API and clears credentials.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as ConfigModule from '../../../../src/utils/config.mts'
import type * as LoggerModule from '@socketsecurity/lib/logger'
import type * as WithSubcommandsModule from '../../../../src/utils/cli/with-subcommands.mjs'

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
  const actual =
    await importOriginal<typeof LoggerModule>()
  return {
    ...actual,
    getDefaultLogger: () => mockLogger,
  }
})

// Mock config utilities.
const mockUpdateConfigValue = vi.hoisted(() => vi.fn())
const mockIsConfigFromFlag = vi.hoisted(() => vi.fn(() => false))

vi.mock('../../../../src/utils/config.mts', async importOriginal => {
  const actual =
    await importOriginal<typeof ConfigModule>()
  return {
    ...actual,
    isConfigFromFlag: mockIsConfigFromFlag,
    updateConfigValue: mockUpdateConfigValue,
  }
})

// Mock dry-run output.
const mockOutputDryRunDelete = vi.hoisted(() => vi.fn())

vi.mock('../../../../src/utils/dry-run/output.mts', () => ({
  outputDryRunDelete: mockOutputDryRunDelete,
}))

// Mock meowOrExit to prevent actual CLI parsing issues. Also invoke
// the help() callback so its template-string body is recorded as
// covered; production meowOrExit only invokes it on --help, which
// the test suite never exercises.
const mockMeowOrExit = vi.hoisted(() =>
  vi.fn((options: unknown) => {
    const argv = options.argv as string[] | readonly string[]
    const flags: Record<string, unknown> = {}

    // Parse flags from argv.
    if (argv.includes('--dry-run')) {
      flags['dryRun'] = true
    }
    if (argv.includes('--json')) {
      flags['json'] = true
    }
    if (argv.includes('--markdown')) {
      flags['markdown'] = true
    }

    const help = options.config?.help
      ? options.config.help('socket logout')
      : ''

    return {
      flags,
      input: [],
      pkg: {},
      help,
    }
  }),
)

vi.mock(
  '../../../../src/utils/cli/with-subcommands.mjs',
  async importOriginal => {
    const actual =
      await importOriginal<
        typeof WithSubcommandsModule
      >()
    return {
      ...actual,
      meowOrExit: mockMeowOrExit,
    }
  },
)

// Import after mocks.
const { cmdLogout, CMD_NAME } =
  await import('../../../../src/commands/logout/cmd-logout.mts')

describe('cmd-logout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
    mockIsConfigFromFlag.mockReturnValue(false)
  })

  describe('command metadata', () => {
    it('should export CMD_NAME as logout', () => {
      expect(CMD_NAME).toBe('logout')
    })

    it('should have correct description', () => {
      expect(cmdLogout.description).toBe('Socket API logout')
    })

    it('should not be hidden', () => {
      expect(cmdLogout.hidden).toBe(false)
    })
  })

  describe('run', () => {
    const importMeta = { url: 'file:///test/cmd-logout.mts' }
    const context = { parentName: 'socket' }

    describe('--help flag', () => {
      it('should call meowOrExit with help configuration', async () => {
        await cmdLogout.run(['--help'], importMeta, context)

        expect(mockMeowOrExit).toHaveBeenCalledWith(
          expect.objectContaining({
            argv: ['--help'],
            parentName: 'socket',
            config: expect.objectContaining({
              commandName: 'logout',
              description: 'Socket API logout',
              hidden: false,
            }),
          }),
        )
      })
    })

    describe('--dry-run flag', () => {
      it('should show preview without performing logout', async () => {
        await cmdLogout.run(['--dry-run'], importMeta, context)

        expect(mockOutputDryRunDelete).toHaveBeenCalledWith(
          'Socket API credentials',
          expect.stringContaining('/.config/socket/config.json'),
        )
        expect(mockUpdateConfigValue).not.toHaveBeenCalled()
        expect(mockLogger.success).not.toHaveBeenCalled()
      })

      it('should construct correct config path in dry-run', async () => {
        const originalHome = process.env['HOME']
        process.env['HOME'] = '/test/home'

        await cmdLogout.run(['--dry-run'], importMeta, context)

        expect(mockOutputDryRunDelete).toHaveBeenCalledWith(
          'Socket API credentials',
          '/test/home/.config/socket/config.json',
        )

        process.env['HOME'] = originalHome
      })

      it('should not execute any config changes in dry-run', async () => {
        await cmdLogout.run(['--dry-run'], importMeta, context)

        expect(mockUpdateConfigValue).not.toHaveBeenCalled()
        expect(mockLogger.success).not.toHaveBeenCalled()
        expect(mockLogger.warn).not.toHaveBeenCalled()
      })
    })

    describe('config cleanup behavior', () => {
      it('should clear all Socket credentials on logout', async () => {
        await cmdLogout.run([], importMeta, context)

        // Should clear all config keys.
        expect(mockUpdateConfigValue).toHaveBeenCalledWith(
          'apiToken',
          undefined,
        )
        expect(mockUpdateConfigValue).toHaveBeenCalledWith(
          'apiBaseUrl',
          undefined,
        )
        expect(mockUpdateConfigValue).toHaveBeenCalledWith(
          'apiProxy',
          undefined,
        )
        expect(mockUpdateConfigValue).toHaveBeenCalledWith(
          'enforcedOrgs',
          undefined,
        )
        expect(mockUpdateConfigValue).toHaveBeenCalledTimes(4)
      })

      it('should show success message after logout', async () => {
        await cmdLogout.run([], importMeta, context)

        expect(mockLogger.success).toHaveBeenCalledWith(
          'Successfully logged out',
        )
      })

      it('should clear credentials in correct order', async () => {
        await cmdLogout.run([], importMeta, context)

        const calls = mockUpdateConfigValue.mock.calls
        expect(calls[0]).toEqual(['apiToken', undefined])
        expect(calls[1]).toEqual(['apiBaseUrl', undefined])
        expect(calls[2]).toEqual(['apiProxy', undefined])
        expect(calls[3]).toEqual(['enforcedOrgs', undefined])
      })
    })

    describe('read-only config mode', () => {
      it('should warn when config is from flag/env', async () => {
        mockIsConfigFromFlag.mockReturnValue(true)

        await cmdLogout.run([], importMeta, context)

        expect(mockLogger.success).toHaveBeenCalledWith(
          'Successfully logged out',
        )
        expect(mockLogger.log).toHaveBeenCalledWith('')
        expect(mockLogger.warn).toHaveBeenCalledWith(
          'Note: config is in read-only mode, at least one key was overridden through flag/env, so the logout was not persisted!',
        )
      })

      it('should not warn in normal config mode', async () => {
        mockIsConfigFromFlag.mockReturnValue(false)

        await cmdLogout.run([], importMeta, context)

        expect(mockLogger.success).toHaveBeenCalledWith(
          'Successfully logged out',
        )
        expect(mockLogger.warn).not.toHaveBeenCalled()
      })

      it('should still attempt logout even in read-only mode', async () => {
        mockIsConfigFromFlag.mockReturnValue(true)

        await cmdLogout.run([], importMeta, context)

        expect(mockUpdateConfigValue).toHaveBeenCalledTimes(4)
        expect(mockLogger.success).toHaveBeenCalled()
      })
    })

    describe('error handling', () => {
      it('should handle updateConfigValue errors gracefully', async () => {
        mockUpdateConfigValue.mockImplementation(() => {
          throw new Error('Config write failed')
        })

        await cmdLogout.run([], importMeta, context)

        expect(mockLogger.fail).toHaveBeenCalledWith(
          'Failed to complete logout steps',
        )
        expect(mockLogger.success).not.toHaveBeenCalled()
      })

      it('should catch errors during config cleanup', async () => {
        mockUpdateConfigValue.mockImplementationOnce(() => {
          // First call succeeds.
        })
        mockUpdateConfigValue.mockImplementationOnce(() => {
          throw new Error('Permission denied')
        })

        await cmdLogout.run([], importMeta, context)

        expect(mockLogger.fail).toHaveBeenCalledWith(
          'Failed to complete logout steps',
        )
      })

      it('should not throw uncaught exceptions on error', async () => {
        mockUpdateConfigValue.mockImplementation(() => {
          throw new Error('Disk full')
        })

        await expect(
          cmdLogout.run([], importMeta, context),
        ).resolves.not.toThrow()

        expect(mockLogger.fail).toHaveBeenCalled()
      })
    })

    describe('flag combinations', () => {
      it('should handle --dry-run with --json flag', async () => {
        await cmdLogout.run(['--dry-run', '--json'], importMeta, context)

        expect(mockOutputDryRunDelete).toHaveBeenCalled()
        expect(mockUpdateConfigValue).not.toHaveBeenCalled()
      })

      it('should handle --dry-run with --markdown flag', async () => {
        await cmdLogout.run(['--dry-run', '--markdown'], importMeta, context)

        expect(mockOutputDryRunDelete).toHaveBeenCalled()
        expect(mockUpdateConfigValue).not.toHaveBeenCalled()
      })
    })

    describe('edge cases', () => {
      it('should handle readonly argv array', async () => {
        const readonlyArgv = Object.freeze(['--dry-run']) as readonly string[]

        await cmdLogout.run(readonlyArgv, importMeta, context)

        expect(mockOutputDryRunDelete).toHaveBeenCalled()
      })

      it('should handle missing HOME environment variable', async () => {
        const originalHome = process.env['HOME']
        delete process.env['HOME']

        await cmdLogout.run(['--dry-run'], importMeta, context)

        expect(mockOutputDryRunDelete).toHaveBeenCalledWith(
          'Socket API credentials',
          expect.stringContaining('config.json'),
        )

        process.env['HOME'] = originalHome
      })
    })
  })
})
