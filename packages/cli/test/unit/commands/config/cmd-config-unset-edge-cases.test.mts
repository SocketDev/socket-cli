/**
 * Unit tests for config unset command edge cases.
 *
 * Tests edge cases such as readonly argv, extra arguments, missing HOME,
 * and unusual config key shapes for the unset command.
 *
 * Test Coverage:
 *
 * - Readonly argv array support
 * - Extra arguments after the key are ignored
 * - Missing HOME environment variable in dry-run mode
 * - Config keys with special characters or numeric shape
 *
 * Testing Approach:
 *
 * - Mock meowOrExit to control flag values and input parsing
 * - Mock handleConfigUnset to verify handler calls
 * - Mock config utilities (isSupportedConfigKey, getSupportedConfigEntries)
 * - Mock dry-run output utilities
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

    describe('edge cases', () => {
      it('should handle readonly argv array', async () => {
        const readonlyArgv = Object.freeze(['defaultOrg']) as readonly string[]

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
  })
})
