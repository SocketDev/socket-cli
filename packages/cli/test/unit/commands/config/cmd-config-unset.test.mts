/**
 * Unit tests for config unset command.
 *
 * Tests the command that removes configuration values from the config file.
 *
 * Test Coverage:
 * - Command metadata (description, hidden flag, CMD_NAME)
 * - Config key validation (valid, invalid, missing keys)
 * - Flag combinations (--json, --markdown, conflicting flags)
 * - --dry-run flag support (preview with remove operations)
 * - Handler invocation with correct parameters (key, outputKind, no value)
 * - Output kind resolution (text, json, markdown)
 * - Verification that no value parameter is passed to handler
 *
 * Testing Approach:
 * - Mock logger to capture output
 * - Mock meowOrExit to control flag values and input parsing
 * - Mock handleConfigUnset to verify handler calls
 * - Mock config utilities (isSupportedConfigKey, getSupportedConfigEntries)
 * - Mock dry-run output utilities
 * - Mock output mode utilities
 * - Mock validation utilities
 *
 * Related Files:
 * - src/commands/config/cmd-config-unset.mts - Implementation
 * - src/commands/config/handle-config-unset.mts - Handler
 * - src/commands/config/config-command-factory.mts - Factory
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

// Mock handler.
const mockHandleConfigUnset = vi.hoisted(() => vi.fn())

vi.mock('../../../../src/commands/config/handle-config-unset.mts', () => ({
  handleConfigUnset: mockHandleConfigUnset,
}))

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

vi.mock('../../../../src/utils/config.mts', async importOriginal => {
  const actual =
    await importOriginal<typeof import('../../../../src/utils/config.mts')>()
  return {
    ...actual,
    getSupportedConfigEntries: mockGetSupportedConfigEntries,
    isSupportedConfigKey: mockIsSupportedConfigKey,
  }
})

// Mock dry-run output.
const mockOutputDryRunWrite = vi.hoisted(() => vi.fn())

vi.mock('../../../../src/utils/dry-run/output.mts', () => ({
  outputDryRunWrite: mockOutputDryRunWrite,
}))

// Mock output mode utilities.
const mockGetOutputKind = vi.hoisted(() => vi.fn(() => 'text'))

vi.mock('../../../../src/utils/output/mode.mjs', () => ({
  getOutputKind: mockGetOutputKind,
}))

// Mock validation utilities.
const mockCheckCommandInput = vi.hoisted(() => vi.fn(() => true))

vi.mock('../../../../src/utils/validation/check-input.mts', () => ({
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
const { CMD_NAME, cmdConfigUnset } = await import(
  '../../../../src/commands/config/cmd-config-unset.mts'
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

  describe('command metadata', () => {
    it('should export CMD_NAME as unset', () => {
      expect(CMD_NAME).toBe('unset')
    })

    it('should have correct description', () => {
      expect(cmdConfigUnset.description).toBe(
        'Clear the value of a local CLI config item',
      )
    })

    it('should not be hidden', () => {
      expect(cmdConfigUnset.hidden).toBe(false)
    })
  })

  describe('run', () => {
    const importMeta = { url: 'file:///test/cmd-config-unset.mts' }
    const context = { parentName: 'socket config' }

    describe('valid config key', () => {
      it('should call handler with correct parameters', async () => {
        await cmdConfigUnset.run(['defaultOrg'], importMeta, context)

        expect(mockHandleConfigUnset).toHaveBeenCalledWith({
          key: 'defaultOrg',
          outputKind: 'text',
        })
      })

      it('should validate config key', async () => {
        await cmdConfigUnset.run(['apiToken'], importMeta, context)

        expect(mockIsSupportedConfigKey).toHaveBeenCalledWith('apiToken')
      })

      it('should call handler when validation passes', async () => {
        mockCheckCommandInput.mockReturnValue(true)

        await cmdConfigUnset.run(['apiBaseUrl'], importMeta, context)

        expect(mockHandleConfigUnset).toHaveBeenCalledWith({
          key: 'apiBaseUrl',
          outputKind: 'text',
        })
      })

      it('should handle multiple valid config keys', async () => {
        const keys = ['apiToken', 'defaultOrg', 'apiBaseUrl', 'apiProxy']

        for (const key of keys) {
          vi.clearAllMocks()
          mockCheckCommandInput.mockReturnValue(true)

          // eslint-disable-next-line no-await-in-loop
          await cmdConfigUnset.run([key], importMeta, context)

          expect(mockHandleConfigUnset).toHaveBeenCalledWith({
            key,
            outputKind: 'text',
          })
        }
      })

      it('should handle "test" key specially', async () => {
        mockCheckCommandInput.mockReturnValue(true)

        await cmdConfigUnset.run(['test'], importMeta, context)

        // "test" key bypasses isSupportedConfigKey check in validation.
        expect(mockIsSupportedConfigKey).not.toHaveBeenCalled()
        expect(mockHandleConfigUnset).toHaveBeenCalledWith({
          key: 'test',
          outputKind: 'text',
        })
      })
    })

    describe('invalid config key', () => {
      it('should not call handler when config key is invalid', async () => {
        mockIsSupportedConfigKey.mockReturnValue(false)
        mockCheckCommandInput.mockReturnValue(false)

        await cmdConfigUnset.run(['invalidKey'], importMeta, context)

        expect(mockHandleConfigUnset).not.toHaveBeenCalled()
      })

      it('should not call handler when config key is missing', async () => {
        mockCheckCommandInput.mockReturnValue(false)

        await cmdConfigUnset.run([], importMeta, context)

        expect(mockHandleConfigUnset).not.toHaveBeenCalled()
      })

      it('should validate empty string key', async () => {
        mockIsSupportedConfigKey.mockReturnValue(false)
        mockCheckCommandInput.mockReturnValue(false)

        await cmdConfigUnset.run([''], importMeta, context)

        expect(mockIsSupportedConfigKey).toHaveBeenCalledWith('')
        expect(mockHandleConfigUnset).not.toHaveBeenCalled()
      })
    })

    describe('--dry-run flag', () => {
      it('should show preview without calling handler', async () => {
        await cmdConfigUnset.run(
          ['defaultOrg', '--dry-run'],
          importMeta,
          context,
        )

        expect(mockOutputDryRunWrite).toHaveBeenCalledWith(
          '/test/home/.config/socket/config.json',
          'unset config value for "defaultOrg"',
          ['Remove "defaultOrg" from config'],
        )
        expect(mockHandleConfigUnset).not.toHaveBeenCalled()
      })

      it('should construct correct config path in dry-run', async () => {
        process.env['HOME'] = '/custom/home'

        await cmdConfigUnset.run(
          ['apiToken', '--dry-run'],
          importMeta,
          context,
        )

        expect(mockOutputDryRunWrite).toHaveBeenCalledWith(
          '/custom/home/.config/socket/config.json',
          'unset config value for "apiToken"',
          ['Remove "apiToken" from config'],
        )
      })

      it('should not execute handler in dry-run mode', async () => {
        await cmdConfigUnset.run(
          ['apiToken', '--dry-run'],
          importMeta,
          context,
        )

        expect(mockHandleConfigUnset).not.toHaveBeenCalled()
      })
    })

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

        await cmdConfigUnset.run(
          ['defaultOrg', '--json'],
          importMeta,
          context,
        )

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
          (v: any) =>
            v.message &&
            v.message.includes('--json') &&
            v.message.includes('--markdown'),
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

    describe('edge cases', () => {
      it('should handle readonly argv array', async () => {
        const readonlyArgv = Object.freeze([
          'defaultOrg',
        ]) as readonly string[]

        await cmdConfigUnset.run(readonlyArgv, importMeta, context)

        expect(mockHandleConfigUnset).toHaveBeenCalledWith({
          key: 'defaultOrg',
          outputKind: 'text',
        })
      })

      it('should ignore extra arguments after key', async () => {
        await cmdConfigUnset.run(
          ['apiToken', 'extra', 'args'],
          importMeta,
          context,
        )

        expect(mockHandleConfigUnset).toHaveBeenCalledWith({
          key: 'apiToken',
          outputKind: 'text',
        })
      })

      it('should handle missing HOME environment variable in dry-run', async () => {
        delete process.env['HOME']

        await cmdConfigUnset.run(
          ['defaultOrg', '--dry-run'],
          importMeta,
          context,
        )

        expect(mockOutputDryRunWrite).toHaveBeenCalledWith(
          expect.stringContaining('config.json'),
          expect.any(String),
          expect.any(Array),
        )
      })

      it('should handle keys with special characters', async () => {
        mockIsSupportedConfigKey.mockReturnValue(false)
        mockCheckCommandInput.mockReturnValue(false)

        await cmdConfigUnset.run(['api-token'], importMeta, context)

        expect(mockIsSupportedConfigKey).toHaveBeenCalledWith('api-token')
        expect(mockHandleConfigUnset).not.toHaveBeenCalled()
      })

      it('should handle numeric key', async () => {
        mockIsSupportedConfigKey.mockReturnValue(false)
        mockCheckCommandInput.mockReturnValue(false)

        await cmdConfigUnset.run(['123'], importMeta, context)

        expect(mockIsSupportedConfigKey).toHaveBeenCalledWith('123')
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
          (v: any) =>
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
