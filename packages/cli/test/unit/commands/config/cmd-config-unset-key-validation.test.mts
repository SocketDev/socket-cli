/**
 * Unit tests for config unset command key validation.
 *
 * Tests config key validation for the unset command.
 *
 * Test Coverage:
 *
 * - Handler invocation for valid config keys (including the "test" key)
 * - Rejection of invalid, missing, and empty-string config keys
 *
 * Testing Approach:
 *
 * - Mock meowOrExit to control flag values and input parsing
 * - Mock handleConfigUnset to verify handler calls
 * - Mock config utilities (isSupportedConfigKey, getSupportedConfigEntries)
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
import type * as WithSubcommandsModule from '../../../../src/util/cli/with-subcommands.mjs'

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

        for (let i = 0, { length } = keys; i < length; i += 1) {
          const key = keys[i]
          vi.clearAllMocks()
          mockCheckCommandInput.mockReturnValue(true)

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
  })
})
