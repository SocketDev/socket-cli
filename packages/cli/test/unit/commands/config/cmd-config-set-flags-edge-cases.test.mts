/**
 * Unit tests for config set command.
 *
 * Tests output-format flags, flag conflict validation, edge cases, and the
 * overall validation flow of the command that updates configuration values
 * in the config file.
 *
 * Testing Approach:
 *
 * - Mock logger to capture output
 * - Mock meowOrExit to control flag values and input parsing
 * - Mock handleConfigSet to verify handler calls
 * - Mock config utilities (isSupportedConfigKey, getSupportedConfigEntries)
 * - Mock dry-run output utilities
 * - Mock output mode utilities
 * - Mock validation utilities
 *
 * Related Files:
 *
 * - Src/commands/config/cmd-config-set.mts - Implementation
 * - Src/commands/config/handle-config-set.mts - Handler
 * - Src/commands/config/config-command-factory.mts - Factory
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { cmdConfigSet } from '../../../../src/commands/config/cmd-config-set.mts'

import type * as ConfigModule from '../../../../src/util/config.mts'
import type * as LoggerModule from '@socketsecurity/lib-stable/logger/default'
import type * as WithSubcommandsModule from '../../../../src/util/cli/with-subcommands.mjs'

// Mock the logger.
const mockLogger = vi.hoisted(() => ({
  error: vi.fn(),
  fail: vi.fn(),
  info: vi.fn(),
  log: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
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

// Mock handler.
const mockHandleConfigSet = vi.hoisted(() => vi.fn())

vi.mock(
  import('../../../../src/commands/config/handle-config-set.mts'),
  () => ({
    handleConfigSet: mockHandleConfigSet,
  }),
)

// Mock config utilities.
const mockIsSupportedConfigKey = vi.hoisted(() => vi.fn(() => true))
const mockGetSupportedConfigEntries = vi.hoisted(() =>
  vi.fn(() => [
    ['apiBaseUrl', 'API base URL'],
    ['apiProxy', 'API proxy URL'],
    ['apiToken', 'API authentication token'],
    ['defaultOrg', 'Default organization slug'],
  ]),
)

vi.mock(import('../../../../src/util/config.mts'), async importOriginal => {
  const actual = await importOriginal<typeof ConfigModule>()
  return {
    ...actual,
    getSupportedConfigEntries: mockGetSupportedConfigEntries,
    isSupportedConfigKey: mockIsSupportedConfigKey,
  }
})

// Mock dry-run output.
const mockOutputDryRunWrite = vi.hoisted(() => vi.fn())

vi.mock(import('../../../../src/util/dry-run/output.mts'), () => ({
  outputDryRunWrite: mockOutputDryRunWrite,
}))

// Mock output mode utilities.
const mockGetOutputKind = vi.hoisted(() => vi.fn(() => 'text'))

vi.mock(import('../../../../src/util/output/mode.mjs'), () => ({
  getOutputKind: mockGetOutputKind,
}))

// Mock validation utilities.
const mockCheckCommandInput = vi.hoisted(() => vi.fn(() => true))

vi.mock(import('../../../../src/util/validation/check-input.mts'), () => ({
  checkCommandInput: mockCheckCommandInput,
}))

// Mock meowOrExit to prevent actual CLI parsing.
const mockMeowOrExit = vi.hoisted(() =>
  vi.fn((options: { argv: string[] | readonly string[] }) => {
    const argv = options.argv
    const flags: Record<string, unknown> = {
      dryRun: false,
      json: false,
      markdown: false,
    }
    const input: string[] = []

    // Parse flags from argv.
    for (let i = 0; i < argv.length; i++) {
      const arg = argv[i]
      if (arg === '--dry-run') {
        flags['dryRun'] = true
      } else if (arg === '--json') {
        flags['json'] = true
      } else if (arg === '--markdown') {
        flags['markdown'] = true
      } else if (!arg.startsWith('--')) {
        input.push(arg)
      }
    }

    return {
      flags,
      help: '',
      input,
      pkg: {},
    }
  }),
)

vi.mock(
  import('../../../../src/util/cli/with-subcommands.mjs'),
  async importOriginal => {
    const actual = await importOriginal<typeof WithSubcommandsModule>()
    return {
      ...actual,
      meowOrExit: mockMeowOrExit,
    }
  },
)

describe('cmd-config-set', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
    process.env['HOME'] = '/test/home'
    mockIsSupportedConfigKey.mockReturnValue(true)
    mockCheckCommandInput.mockReturnValue(true)
    mockGetOutputKind.mockReturnValue('text')
  })

  describe('run', () => {
    const importMeta = { url: 'file:///test/cmd-config-set.mts' }
    const context = { parentName: 'socket config' }

    describe('output formats', () => {
      it('should pass text output kind when no format flag provided', async () => {
        mockGetOutputKind.mockReturnValue('text')

        await cmdConfigSet.run(['defaultOrg', 'my-org'], importMeta, context)

        expect(mockGetOutputKind).toHaveBeenCalledWith(false, false)
        expect(mockHandleConfigSet).toHaveBeenCalledWith({
          key: 'defaultOrg',
          outputKind: 'text',
          value: 'my-org',
        })
      })

      it('should pass json output kind when --json flag provided', async () => {
        mockGetOutputKind.mockReturnValue('json')

        await cmdConfigSet.run(
          ['defaultOrg', 'my-org', '--json'],
          importMeta,
          context,
        )

        expect(mockGetOutputKind).toHaveBeenCalledWith(true, false)
        expect(mockHandleConfigSet).toHaveBeenCalledWith({
          key: 'defaultOrg',
          outputKind: 'json',
          value: 'my-org',
        })
      })

      it('should pass markdown output kind when --markdown flag provided', async () => {
        mockGetOutputKind.mockReturnValue('markdown')

        await cmdConfigSet.run(
          ['defaultOrg', 'my-org', '--markdown'],
          importMeta,
          context,
        )

        expect(mockGetOutputKind).toHaveBeenCalledWith(false, true)
        expect(mockHandleConfigSet).toHaveBeenCalledWith({
          key: 'defaultOrg',
          outputKind: 'markdown',
          value: 'my-org',
        })
      })
    })

    describe('flag validation', () => {
      it('should validate that --json and --markdown are not used together', async () => {
        await cmdConfigSet.run(
          ['defaultOrg', 'my-org', '--json', '--markdown'],
          importMeta,
          context,
        )

        expect(mockCheckCommandInput).toHaveBeenCalled()
        const call = mockCheckCommandInput.mock.calls[0]

        // Check that validation includes the conflicting flags check.
        const validations = call.slice(1)
        const conflictCheck = validations.find(
          (v: unknown) =>
            v.message?.includes('--json') && v.message.includes('--markdown'),
        )
        expect(conflictCheck).toBeDefined()
        expect(conflictCheck.nook).toBe(true)
        expect(conflictCheck.test).toBe(false)
      })

      it('should not call handler when flag validation fails', async () => {
        mockCheckCommandInput.mockReturnValue(false)

        await cmdConfigSet.run(
          ['defaultOrg', 'my-org', '--json', '--markdown'],
          importMeta,
          context,
        )

        expect(mockHandleConfigSet).not.toHaveBeenCalled()
      })
    })

    describe('edge cases', () => {
      it('should handle readonly argv array', async () => {
        const readonlyArgv = Object.freeze(['defaultOrg', 'my-org'])

        await cmdConfigSet.run(readonlyArgv, importMeta, context)

        expect(mockHandleConfigSet).toHaveBeenCalledWith({
          key: 'defaultOrg',
          outputKind: 'text',
          value: 'my-org',
        })
      })

      it('should handle missing HOME environment variable in dry-run', async () => {
        delete process.env['HOME']

        await cmdConfigSet.run(
          ['defaultOrg', 'my-org', '--dry-run'],
          importMeta,
          context,
        )

        expect(mockOutputDryRunWrite).toHaveBeenCalledWith(
          expect.stringContaining('config.json'),
          expect.any(String),
          expect.any(Array),
        )
      })

      it('should handle value that looks like a flag', async () => {
        await cmdConfigSet.run(
          ['apiProxy', '--not-a-flag'],
          importMeta,
          context,
        )

        // meowOrExit would parse --not-a-flag as a flag, so this tests that behavior.
        const callArgs = mockHandleConfigSet.mock.calls[0]
        expect(callArgs).toBeDefined()
      })

      it('should handle very long values', async () => {
        const longValue = 'a'.repeat(1000)
        await cmdConfigSet.run(['apiToken', longValue], importMeta, context)

        expect(mockHandleConfigSet).toHaveBeenCalledWith({
          key: 'apiToken',
          outputKind: 'text',
          value: longValue,
        })
      })
    })

    describe('validation flow', () => {
      it('should check all validations in correct order', async () => {
        await cmdConfigSet.run(['apiToken', 'token'], importMeta, context)

        expect(mockCheckCommandInput).toHaveBeenCalled()
        const call = mockCheckCommandInput.mock.calls[0]
        const validations = call.slice(1)

        // Should have at least 3 validations: key, value, and flag conflict.
        expect(validations.length).toBeGreaterThanOrEqual(3)

        // First validation: key check.
        expect(validations[0]).toMatchObject({
          test: true,
          message: 'Config key should be the first arg',
        })

        // Second validation: value check.
        expect(validations[1]).toMatchObject({
          test: true,
        })

        // Last validation: flag conflict check.
        const lastValidation = validations[validations.length - 1]
        expect(lastValidation).toMatchObject({
          nook: true,
          test: true,
          fail: 'bad',
        })
      })

      it('should always pass value parameter to handler', async () => {
        await cmdConfigSet.run(['apiToken', 'token'], importMeta, context)

        const callArgs = mockHandleConfigSet.mock.calls[0][0]
        expect(callArgs).toHaveProperty('value')
        expect(callArgs).toHaveProperty('key')
        expect(callArgs).toHaveProperty('outputKind')
        expect(callArgs.value).toBe('token')
      })
    })
  })
})
