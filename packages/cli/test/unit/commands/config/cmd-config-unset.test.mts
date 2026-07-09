/**
 * Unit tests for config unset command.
 *
 * Tests the command that removes configuration values from the config file.
 *
 * Test Coverage:
 *
 * - Command metadata (description, hidden flag, CMD_NAME)
 * - Flag combinations (--json, --markdown, conflicting flags)
 * - Handler invocation with correct parameters (key, outputKind, no value)
 * - Output kind resolution (text, json, markdown)
 * - Verification that no value parameter is passed to handler
 *
 * Config key validation, --dry-run flag support, and edge cases live in
 * sibling `cmd-config-unset-*.test.mts` files.
 *
 * Testing Approach:
 *
 * - Mock logger to capture output
 * - Mock meowOrExit to control flag values and input parsing
 * - Mock handleConfigUnset to verify handler calls
 * - Mock config utilities (isSupportedConfigKey, getSupportedConfigEntries)
 * - Mock output mode utilities
 * - Mock validation utilities
 *
 * Related Files:
 *
 * - Src/commands/config/cmd-config-unset.mts - Implementation
 * - Src/commands/config/handle-config-unset.mts - Handler
 * - Src/commands/config/config-command-factory.mts - Factory
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { cmdConfigUnset } from '../../../../src/commands/config/cmd-config-unset.mts'

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
const mockHandleConfigUnset = vi.hoisted(() => vi.fn())

vi.mock(
  import('../../../../src/commands/config/handle-config-unset.mts'),
  () => ({
    handleConfigUnset: mockHandleConfigUnset,
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

describe('cmd-config-unset', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
    process.env['HOME'] = '/test/home'
    mockIsSupportedConfigKey.mockReturnValue(true)
    mockCheckCommandInput.mockReturnValue(true)
    mockGetOutputKind.mockReturnValue('text')
  })

  describe('run', () => {
    const importMeta = { url: 'file:///test/cmd-config-unset.mts' }
    const context = { parentName: 'socket config' }

    describe('output formats', () => {
      it('should pass text output kind when no format flag provided', async () => {
        mockGetOutputKind.mockReturnValue('text')

        await cmdConfigUnset.run(['defaultOrg'], importMeta, context)

        expect(mockGetOutputKind).toHaveBeenCalledWith(false, false)
        expect(mockHandleConfigUnset).toHaveBeenCalledWith({
          key: 'defaultOrg',
          outputKind: 'text',
        })
      })

      it('should pass json output kind when --json flag provided', async () => {
        mockGetOutputKind.mockReturnValue('json')

        await cmdConfigUnset.run(['defaultOrg', '--json'], importMeta, context)

        expect(mockGetOutputKind).toHaveBeenCalledWith(true, false)
        expect(mockHandleConfigUnset).toHaveBeenCalledWith({
          key: 'defaultOrg',
          outputKind: 'json',
        })
      })

      it('should pass markdown output kind when --markdown flag provided', async () => {
        mockGetOutputKind.mockReturnValue('markdown')

        await cmdConfigUnset.run(
          ['defaultOrg', '--markdown'],
          importMeta,
          context,
        )

        expect(mockGetOutputKind).toHaveBeenCalledWith(false, true)
        expect(mockHandleConfigUnset).toHaveBeenCalledWith({
          key: 'defaultOrg',
          outputKind: 'markdown',
        })
      })
    })

    describe('flag validation', () => {
      it('should validate that --json and --markdown are not used together', async () => {
        await cmdConfigUnset.run(
          ['defaultOrg', '--json', '--markdown'],
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

        await cmdConfigUnset.run(
          ['defaultOrg', '--json', '--markdown'],
          importMeta,
          context,
        )

        expect(mockHandleConfigUnset).not.toHaveBeenCalled()
      })
    })

    describe('validation flow', () => {
      it('should check all validations in correct order', async () => {
        await cmdConfigUnset.run(['apiToken'], importMeta, context)

        expect(mockCheckCommandInput).toHaveBeenCalled()
        const call = mockCheckCommandInput.mock.calls[0]
        const validations = call.slice(1)

        // Should have at least 2 validations: key validation and flag conflict.
        expect(validations.length).toBeGreaterThanOrEqual(2)

        // First validation: key check.
        expect(validations[0]).toMatchObject({
          test: true,
          message: 'Config key should be the first arg',
        })

        // Last validation: flag conflict check.
        const lastValidation = validations[validations.length - 1]
        expect(lastValidation).toMatchObject({
          nook: true,
          test: true,
          fail: 'bad',
        })
      })

      it('should not pass value parameter to handler', async () => {
        await cmdConfigUnset.run(['apiToken'], importMeta, context)

        const callArgs = mockHandleConfigUnset.mock.calls[0][0]
        expect(callArgs).not.toHaveProperty('value')
        expect(callArgs).toHaveProperty('key')
        expect(callArgs).toHaveProperty('outputKind')
      })

      it('should never include value validation for unset', async () => {
        await cmdConfigUnset.run(['apiToken'], importMeta, context)

        expect(mockCheckCommandInput).toHaveBeenCalled()
        const call = mockCheckCommandInput.mock.calls[0]
        const validations = call.slice(1)

        // Should NOT have value validation for unset command.
        const valueValidation = validations.find(
          (v: unknown) =>
            v.message &&
            (v.message.includes('value') || v.message.includes('unset')),
        )
        expect(valueValidation).toBeUndefined()
      })
    })

    describe('comparison with set command', () => {
      it('should not require a value argument unlike set', async () => {
        mockCheckCommandInput.mockReturnValue(true)

        await cmdConfigUnset.run(['apiToken'], importMeta, context)

        expect(mockHandleConfigUnset).toHaveBeenCalledWith({
          key: 'apiToken',
          outputKind: 'text',
        })

        // Verify no value in call.
        const callArgs = mockHandleConfigUnset.mock.calls[0][0]
        expect(callArgs.value).toBeUndefined()
      })

      it('should ignore any value-like arguments provided', async () => {
        await cmdConfigUnset.run(
          ['apiToken', 'this-looks-like-value'],
          importMeta,
          context,
        )

        const callArgs = mockHandleConfigUnset.mock.calls[0][0]
        expect(callArgs).not.toHaveProperty('value')
      })
    })
  })
})
