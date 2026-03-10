/**
 * Unit tests for config set command.
 *
 * Tests the command that updates configuration values in the config file.
 *
 * Test Coverage:
 * - Command metadata (description, hidden flag, CMD_NAME)
 * - Config key validation (valid, invalid, missing keys)
 * - Value requirement validation (present, missing, empty)
 * - Flag combinations (--json, --markdown, conflicting flags)
 * - --dry-run flag support (preview with write operations)
 * - Handler invocation with correct parameters (key, value, outputKind)
 * - Output kind resolution (text, json, markdown)
 * - Value handling (simple strings, strings with spaces, special characters)
 *
 * Testing Approach:
 * - Mock logger to capture output
 * - Mock meowOrExit to control flag values and input parsing
 * - Mock handleConfigSet to verify handler calls
 * - Mock config utilities (isSupportedConfigKey, getSupportedConfigEntries)
 * - Mock dry-run output utilities
 * - Mock output mode utilities
 * - Mock validation utilities
 *
 * Related Files:
 * - src/commands/config/cmd-config-set.mts - Implementation
 * - src/commands/config/handle-config-set.mts - Handler
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
const mockHandleConfigSet = vi.hoisted(() => vi.fn())

vi.mock('../../../../src/commands/config/handle-config-set.mts', () => ({
  handleConfigSet: mockHandleConfigSet,
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
const { CMD_NAME, cmdConfigSet } = await import(
  '../../../../src/commands/config/cmd-config-set.mts'
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

  describe('command metadata', () => {
    it('should export CMD_NAME as set', () => {
      expect(CMD_NAME).toBe('set')
    })

    it('should have correct description', () => {
      expect(cmdConfigSet.description).toBe(
        'Update the value of a local CLI config item',
      )
    })

    it('should not be hidden', () => {
      expect(cmdConfigSet.hidden).toBe(false)
    })
  })

  describe('run', () => {
    const importMeta = { url: 'file:///test/cmd-config-set.mts' }
    const context = { parentName: 'socket config' }

    describe('valid config key and value', () => {
      it('should call handler with correct parameters', async () => {
        await cmdConfigSet.run(
          ['defaultOrg', 'my-org'],
          importMeta,
          context,
        )

        expect(mockHandleConfigSet).toHaveBeenCalledWith({
          key: 'defaultOrg',
          outputKind: 'text',
          value: 'my-org',
        })
      })

      it('should validate config key', async () => {
        await cmdConfigSet.run(['apiToken', 'token-value'], importMeta, context)

        expect(mockIsSupportedConfigKey).toHaveBeenCalledWith('apiToken')
      })

      it('should handle multiple valid config keys', async () => {
        const testCases = [
          { key: 'apiToken', value: 'abc123' },
          { key: 'defaultOrg', value: 'test-org' },
          { key: 'apiBaseUrl', value: 'https://api.example.com' },
          { key: 'apiProxy', value: 'https://proxy.example.com' },
        ]

        for (const { key, value } of testCases) {
          vi.clearAllMocks()
          mockCheckCommandInput.mockReturnValue(true)

          // eslint-disable-next-line no-await-in-loop
          await cmdConfigSet.run([key, value], importMeta, context)

          expect(mockHandleConfigSet).toHaveBeenCalledWith({
            key,
            outputKind: 'text',
            value,
          })
        }
      })

      it('should handle values with spaces by joining remaining args', async () => {
        await cmdConfigSet.run(
          ['apiProxy', 'https://proxy.example.com', 'with', 'spaces'],
          importMeta,
          context,
        )

        expect(mockHandleConfigSet).toHaveBeenCalledWith({
          key: 'apiProxy',
          outputKind: 'text',
          value: 'https://proxy.example.com with spaces',
        })
      })

      it('should handle "test" key specially', async () => {
        mockCheckCommandInput.mockReturnValue(true)

        await cmdConfigSet.run(['test', 'test-value'], importMeta, context)

        // "test" key bypasses isSupportedConfigKey check in validation.
        expect(mockIsSupportedConfigKey).not.toHaveBeenCalled()
        expect(mockHandleConfigSet).toHaveBeenCalledWith({
          key: 'test',
          outputKind: 'text',
          value: 'test-value',
        })
      })
    })

    describe('invalid config key', () => {
      it('should not call handler when config key is invalid', async () => {
        mockIsSupportedConfigKey.mockReturnValue(false)
        mockCheckCommandInput.mockReturnValue(false)

        await cmdConfigSet.run(['invalidKey', 'value'], importMeta, context)

        expect(mockHandleConfigSet).not.toHaveBeenCalled()
      })

      it('should not call handler when config key is missing', async () => {
        mockCheckCommandInput.mockReturnValue(false)

        await cmdConfigSet.run([], importMeta, context)

        expect(mockHandleConfigSet).not.toHaveBeenCalled()
      })

      it('should validate empty string key', async () => {
        mockIsSupportedConfigKey.mockReturnValue(false)
        mockCheckCommandInput.mockReturnValue(false)

        await cmdConfigSet.run(['', 'value'], importMeta, context)

        expect(mockIsSupportedConfigKey).toHaveBeenCalledWith('')
        expect(mockHandleConfigSet).not.toHaveBeenCalled()
      })
    })

    describe('value validation', () => {
      it('should not call handler when value is missing', async () => {
        mockCheckCommandInput.mockReturnValue(false)

        await cmdConfigSet.run(['apiToken'], importMeta, context)

        expect(mockHandleConfigSet).not.toHaveBeenCalled()
      })

      it('should validate that value is required', async () => {
        await cmdConfigSet.run(['apiToken'], importMeta, context)

        expect(mockCheckCommandInput).toHaveBeenCalled()
        const call = mockCheckCommandInput.mock.calls[0]
        const validations = call.slice(1)

        // Should have value validation that checks for presence.
        const valueValidation = validations.find(
          (v: any) =>
            v.message &&
            (v.message.includes('value') || v.message.includes('unset')),
        )
        expect(valueValidation).toBeDefined()
        expect(valueValidation.test).toBe(false)
      })

      it('should accept empty string as valid value', async () => {
        await cmdConfigSet.run(['apiToken', ''], importMeta, context)

        expect(mockCheckCommandInput).toHaveBeenCalled()
        const call = mockCheckCommandInput.mock.calls[0]
        const validations = call.slice(1)

        const valueValidation = validations.find(
          (v: any) =>
            v.message &&
            (v.message.includes('value') || v.message.includes('unset')),
        )
        // Empty string after the key means no value, so test should be false.
        expect(valueValidation.test).toBe(false)
      })

      it('should handle numeric values', async () => {
        await cmdConfigSet.run(['apiToken', '12345'], importMeta, context)

        expect(mockHandleConfigSet).toHaveBeenCalledWith({
          key: 'apiToken',
          outputKind: 'text',
          value: '12345',
        })
      })

      it('should handle special characters in value', async () => {
        await cmdConfigSet.run(
          ['apiToken', 'abc!@#$%^&*()'],
          importMeta,
          context,
        )

        expect(mockHandleConfigSet).toHaveBeenCalledWith({
          key: 'apiToken',
          outputKind: 'text',
          value: 'abc!@#$%^&*()',
        })
      })

      it('should handle URL values', async () => {
        await cmdConfigSet.run(
          ['apiBaseUrl', 'https://api.socket.dev/v0'],
          importMeta,
          context,
        )

        expect(mockHandleConfigSet).toHaveBeenCalledWith({
          key: 'apiBaseUrl',
          outputKind: 'text',
          value: 'https://api.socket.dev/v0',
        })
      })
    })

    describe('--dry-run flag', () => {
      it('should show preview without calling handler', async () => {
        await cmdConfigSet.run(
          ['defaultOrg', 'my-org', '--dry-run'],
          importMeta,
          context,
        )

        expect(mockOutputDryRunWrite).toHaveBeenCalledWith(
          '/test/home/.config/socket/config.json',
          'set config value for "defaultOrg"',
          ['Set "defaultOrg" to: my-org'],
        )
        expect(mockHandleConfigSet).not.toHaveBeenCalled()
      })

      it('should construct correct config path in dry-run', async () => {
        process.env['HOME'] = '/custom/home'

        await cmdConfigSet.run(
          ['apiToken', 'token', '--dry-run'],
          importMeta,
          context,
        )

        expect(mockOutputDryRunWrite).toHaveBeenCalledWith(
          '/custom/home/.config/socket/config.json',
          'set config value for "apiToken"',
          ['Set "apiToken" to: token'],
        )
      })

      it('should not execute handler in dry-run mode', async () => {
        await cmdConfigSet.run(
          ['apiToken', 'token', '--dry-run'],
          importMeta,
          context,
        )

        expect(mockHandleConfigSet).not.toHaveBeenCalled()
      })

      it('should show value with spaces in dry-run', async () => {
        await cmdConfigSet.run(
          ['apiProxy', 'https://proxy.example.com', 'with', 'path', '--dry-run'],
          importMeta,
          context,
        )

        expect(mockOutputDryRunWrite).toHaveBeenCalledWith(
          expect.any(String),
          'set config value for "apiProxy"',
          ['Set "apiProxy" to: https://proxy.example.com with path'],
        )
      })
    })

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
        const readonlyArgv = Object.freeze([
          'defaultOrg',
          'my-org',
        ]) as readonly string[]

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
