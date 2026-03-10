/**
 * Unit tests for oops command.
 *
 * Tests the command that triggers intentional errors for development/testing.
 *
 * Test Coverage:
 * - Command metadata (description, hidden flag)
 * - --dry-run flag support
 * - Error throwing in default mode
 * - JSON error output format
 * - Markdown error output format
 * - --throw flag to force error throwing even with output flags
 * - Exit code behavior
 *
 * Testing Approach:
 * - Mock logger to capture output
 * - Mock meowOrExit to control flag values
 * - Mock serializeResultJson to verify JSON output format
 * - Mock failMsgWithBadge to verify markdown output format
 * - Verify error throwing and exit codes
 *
 * Related Files:
 * - src/commands/oops/cmd-oops.mts - Implementation
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
  const actual =
    await importOriginal<typeof import('@socketsecurity/lib/logger')>()
  return {
    ...actual,
    getDefaultLogger: () => mockLogger,
  }
})

// Mock output utilities.
const mockSerializeResultJson = vi.hoisted(() =>
  vi.fn(data => JSON.stringify(data)),
)

vi.mock('../../../../src/utils/output/result-json.mjs', () => ({
  serializeResultJson: mockSerializeResultJson,
}))

const mockFailMsgWithBadge = vi.hoisted(() =>
  vi.fn((title, message) => `${title}: ${message}`),
)

vi.mock('../../../../src/utils/error/fail-msg-with-badge.mts', () => ({
  failMsgWithBadge: mockFailMsgWithBadge,
}))

// Mock meowOrExit to prevent actual CLI parsing.
const mockMeowOrExit = vi.hoisted(() =>
  vi.fn((options: { argv: string[] | readonly string[] }) => {
    const argv = options.argv
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
    if (argv.includes('--throw')) {
      flags['throw'] = true
    }

    return {
      flags,
      help: '',
      input: [],
      pkg: {},
    }
  }),
)

vi.mock(
  '../../../../src/utils/cli/with-subcommands.mjs',
  async importOriginal => {
    const actual =
      await importOriginal<
        typeof import('../../../../src/utils/cli/with-subcommands.mjs')
      >()
    return {
      ...actual,
      meowOrExit: mockMeowOrExit,
    }
  },
)

// Import after mocks.
const { CMD_NAME, cmdOops } = await import(
  '../../../../src/commands/oops/cmd-oops.mts'
)

describe('cmd-oops', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
  })

  describe('command metadata', () => {
    it('should export CMD_NAME as oops', () => {
      expect(CMD_NAME).toBe('oops')
    })

    it('should have correct description', () => {
      expect(cmdOops.description).toBe(
        'Trigger an intentional error (for development)',
      )
    })

    it('should be hidden', () => {
      expect(cmdOops.hidden).toBe(true)
    })
  })

  describe('run', () => {
    const importMeta = { url: 'file:///test/cmd-oops.mts' }
    const context = { parentName: 'socket' }

    describe('--dry-run flag', () => {
      it('should show preview without throwing error', async () => {
        await cmdOops.run(['--dry-run'], importMeta, context)

        expect(mockLogger.log).toHaveBeenCalledWith('')
        expect(mockLogger.log).toHaveBeenCalledWith(
          expect.stringContaining('Would trigger an intentional error'),
        )
        expect(mockLogger.log).toHaveBeenCalledWith(
          expect.stringContaining(
            'This command throws an error for development/testing purposes.',
          ),
        )
        expect(mockLogger.log).toHaveBeenCalledWith(
          expect.stringContaining('This error was intentionally left blank'),
        )
      })

      it('should indicate thrown error format in dry-run', async () => {
        await cmdOops.run(['--dry-run'], importMeta, context)

        expect(mockLogger.log).toHaveBeenCalledWith(
          expect.stringContaining('Output format: Thrown Error exception'),
        )
      })

      it('should indicate JSON format in dry-run with --json', async () => {
        await cmdOops.run(['--dry-run', '--json'], importMeta, context)

        expect(mockLogger.log).toHaveBeenCalledWith(
          expect.stringContaining('Output format: JSON error response'),
        )
      })

      it('should indicate markdown format in dry-run with --markdown', async () => {
        await cmdOops.run(['--dry-run', '--markdown'], importMeta, context)

        expect(mockLogger.log).toHaveBeenCalledWith(
          expect.stringContaining('Output format: Markdown error message'),
        )
      })

      it('should indicate thrown format when --throw flag present', async () => {
        await cmdOops.run(
          ['--dry-run', '--json', '--throw'],
          importMeta,
          context,
        )

        expect(mockLogger.log).toHaveBeenCalledWith(
          expect.stringContaining('Output format: Thrown Error exception'),
        )
      })

      it('should show run instruction in dry-run', async () => {
        await cmdOops.run(['--dry-run'], importMeta, context)

        expect(mockLogger.log).toHaveBeenCalledWith(
          expect.stringContaining('Run without --dry-run to trigger the error'),
        )
      })
    })

    describe('default error behavior', () => {
      it('should throw error when no output flags provided', async () => {
        await expect(cmdOops.run([], importMeta, context)).rejects.toThrow(
          'This error was intentionally left blank.',
        )
      })

      it('should throw error with exact message', async () => {
        try {
          await cmdOops.run([], importMeta, context)
          expect.fail('Should have thrown an error')
        } catch (e: unknown) {
          expect(e).toBeInstanceOf(Error)
          if (e instanceof Error) {
            expect(e.message).toBe('This error was intentionally left blank.')
          }
        }
      })
    })

    describe('--json flag', () => {
      it('should output JSON error and still throw', async () => {
        await expect(
          cmdOops.run(['--json'], importMeta, context),
        ).rejects.toThrow('This error was intentionally left blank.')

        expect(mockSerializeResultJson).toHaveBeenCalledWith({
          ok: false,
          message: 'Oops',
          cause: 'This error was intentionally left blank',
        })
        expect(mockLogger.log).toHaveBeenCalledWith(
          expect.stringContaining('ok'),
        )
      })

      it('should set exit code to 1 with --json before throwing', async () => {
        try {
          await cmdOops.run(['--json'], importMeta, context)
        } catch {
          // Expected to throw
        }

        expect(process.exitCode).toBe(1)
      })

      it('should throw error even with --json', async () => {
        await expect(
          cmdOops.run(['--json'], importMeta, context),
        ).rejects.toThrow('This error was intentionally left blank.')
      })
    })

    describe('--markdown flag', () => {
      it('should output markdown error without throwing', async () => {
        await cmdOops.run(['--markdown'], importMeta, context)

        expect(mockFailMsgWithBadge).toHaveBeenCalledWith(
          'Oops',
          'This error was intentionally left blank',
        )
        expect(mockLogger.fail).toHaveBeenCalled()
      })

      it('should set exit code to 1 with --markdown', async () => {
        await cmdOops.run(['--markdown'], importMeta, context)

        expect(process.exitCode).toBe(1)
      })

      it('should not throw error with --markdown', async () => {
        await expect(
          cmdOops.run(['--markdown'], importMeta, context),
        ).resolves.not.toThrow()
      })
    })

    describe('--throw flag', () => {
      it('should throw error even with --json when --throw is provided', async () => {
        await expect(
          cmdOops.run(['--json', '--throw'], importMeta, context),
        ).rejects.toThrow('This error was intentionally left blank.')
      })

      it('should throw error even with --markdown when --throw is provided', async () => {
        await expect(
          cmdOops.run(['--markdown', '--throw'], importMeta, context),
        ).rejects.toThrow('This error was intentionally left blank.')
      })

      it('should not output JSON when --throw overrides --json', async () => {
        try {
          await cmdOops.run(['--json', '--throw'], importMeta, context)
          expect.fail('Should have thrown an error')
        } catch {
          expect(mockSerializeResultJson).not.toHaveBeenCalled()
        }
      })

      it('should not output markdown when --throw overrides --markdown', async () => {
        try {
          await cmdOops.run(['--markdown', '--throw'], importMeta, context)
          expect.fail('Should have thrown an error')
        } catch {
          expect(mockFailMsgWithBadge).not.toHaveBeenCalled()
        }
      })
    })

    describe('flag combinations', () => {
      it('should handle --json and --markdown together (outputs JSON then returns)', async () => {
        await cmdOops.run(['--json', '--markdown'], importMeta, context)

        expect(mockSerializeResultJson).toHaveBeenCalledWith({
          ok: false,
          message: 'Oops',
          cause: 'This error was intentionally left blank',
        })
        expect(mockFailMsgWithBadge).toHaveBeenCalledWith(
          'Oops',
          'This error was intentionally left blank',
        )
      })

      it('should handle all flags together', async () => {
        await expect(
          cmdOops.run(
            ['--json', '--markdown', '--throw'],
            importMeta,
            context,
          ),
        ).rejects.toThrow('This error was intentionally left blank.')
      })
    })

    describe('edge cases', () => {
      it('should handle readonly argv array', async () => {
        const readonlyArgv = Object.freeze(['--markdown']) as readonly string[]

        await cmdOops.run(readonlyArgv, importMeta, context)

        expect(process.exitCode).toBe(1)
        expect(mockLogger.fail).toHaveBeenCalled()
      })

      it('should handle empty flags object', async () => {
        await expect(cmdOops.run([], importMeta, context)).rejects.toThrow(
          'This error was intentionally left blank.',
        )
      })
    })
  })
})
