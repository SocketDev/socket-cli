/**
 * Unit tests for config unset command --dry-run flag.
 *
 * Tests --dry-run flag support (preview with remove operations) for the
 * unset command.
 *
 * Test Coverage:
 *
 * - --dry-run flag support (preview with remove operations)
 * - Config path construction in dry-run mode
 * - Verification that the handler is not invoked in dry-run mode
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

    describe('--dry-run flag', () => {
      it('should show preview without calling handler', async () => {
        await cmdConfigUnset.run(
          ['defaultOrg', '--dry-run'],
          importMeta,
          context,
        )

        expect(mockOutputDryRunWrite).toHaveBeenCalledWith(
          '/test/home/.config/socket/config.json', // socket-lint: allow personal-path
          'unset config value for "defaultOrg"',
          ['Remove "defaultOrg" from config'],
        )
        expect(mockHandleConfigUnset).not.toHaveBeenCalled()
      })

      it('should construct correct config path in dry-run', async () => {
        process.env['HOME'] = '/custom/home'

        await cmdConfigUnset.run(['apiToken', '--dry-run'], importMeta, context)

        expect(mockOutputDryRunWrite).toHaveBeenCalledWith(
          '/custom/home/.config/socket/config.json', // socket-lint: allow personal-path
          'unset config value for "apiToken"',
          ['Remove "apiToken" from config'],
        )
      })

      it('should not execute handler in dry-run mode', async () => {
        await cmdConfigUnset.run(['apiToken', '--dry-run'], importMeta, context)

        expect(mockHandleConfigUnset).not.toHaveBeenCalled()
      })
    })
  })
})
