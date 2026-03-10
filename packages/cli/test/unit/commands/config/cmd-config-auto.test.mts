/**
 * Unit tests for config auto command.
 *
 * Tests the command that automatically discovers and sets correct config values.
 *
 * Test Coverage:
 * - Command metadata (description, hidden flag)
 * - Config key validation
 * - Flag combinations (--json, --markdown)
 * - --dry-run flag support
 * - Handler invocation with correct parameters
 *
 * Testing Approach:
 * - Mock logger to capture output
 * - Mock meowOrExit to control flag values
 * - Mock handleConfigAuto to verify handler is called correctly
 * - Mock config utilities (isSupportedConfigKey, getSupportedConfigEntries)
 * - Mock dry-run output utilities
 * - Mock output mode utilities
 * - Mock validation utilities
 *
 * Related Files:
 * - src/commands/config/cmd-config-auto.mts - Implementation
 * - src/commands/config/handle-config-auto.mts - Handler
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
const mockHandleConfigAuto = vi.hoisted(() => vi.fn())

vi.mock('../../../../src/commands/config/handle-config-auto.mts', () => ({
  handleConfigAuto: mockHandleConfigAuto,
}))

// Mock config utilities.
const mockIsSupportedConfigKey = vi.hoisted(() => vi.fn(() => true))
const mockGetSupportedConfigEntries = vi.hoisted(() =>
  vi.fn(() => [
    ['defaultOrg', 'Default organization slug'],
    ['apiToken', 'API authentication token'],
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
const { CMD_NAME, cmdConfigAuto } = await import(
  '../../../../src/commands/config/cmd-config-auto.mts'
)

describe('cmd-config-auto', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
    mockIsSupportedConfigKey.mockReturnValue(true)
    mockCheckCommandInput.mockReturnValue(true)
    mockGetOutputKind.mockReturnValue('text')
  })

  describe('command metadata', () => {
    it('should export CMD_NAME as auto', () => {
      expect(CMD_NAME).toBe('auto')
    })

    it('should have correct description', () => {
      expect(cmdConfigAuto.description).toBe(
        'Automatically discover and set the correct value config item',
      )
    })

    it('should not be hidden', () => {
      expect(cmdConfigAuto.hidden).toBe(false)
    })
  })

  describe('run', () => {
    const importMeta = { url: 'file:///test/cmd-config-auto.mts' }
    const context = { parentName: 'socket config' }

    describe('valid config key', () => {
      it('should call handler with correct parameters', async () => {
        await cmdConfigAuto.run(['defaultOrg'], importMeta, context)

        expect(mockHandleConfigAuto).toHaveBeenCalledWith({
          key: 'defaultOrg',
          outputKind: 'text',
        })
      })

      it('should validate config key', async () => {
        await cmdConfigAuto.run(['defaultOrg'], importMeta, context)

        expect(mockIsSupportedConfigKey).toHaveBeenCalledWith('defaultOrg')
      })

      it('should call handler when validation passes', async () => {
        mockCheckCommandInput.mockReturnValue(true)

        await cmdConfigAuto.run(['apiToken'], importMeta, context)

        expect(mockHandleConfigAuto).toHaveBeenCalledWith({
          key: 'apiToken',
          outputKind: 'text',
        })
      })
    })

    describe('invalid config key', () => {
      it('should not call handler when config key is invalid', async () => {
        mockIsSupportedConfigKey.mockReturnValue(false)
        mockCheckCommandInput.mockReturnValue(false)

        await cmdConfigAuto.run(['invalidKey'], importMeta, context)

        expect(mockHandleConfigAuto).not.toHaveBeenCalled()
      })

      it('should not call handler when config key is missing', async () => {
        mockCheckCommandInput.mockReturnValue(false)

        await cmdConfigAuto.run([], importMeta, context)

        expect(mockHandleConfigAuto).not.toHaveBeenCalled()
      })

      it('should not call handler when config key is "test"', async () => {
        mockCheckCommandInput.mockReturnValue(false)

        await cmdConfigAuto.run(['test'], importMeta, context)

        expect(mockHandleConfigAuto).not.toHaveBeenCalled()
      })
    })

    describe('--dry-run flag', () => {
      it('should show preview without calling handler', async () => {
        await cmdConfigAuto.run(
          ['defaultOrg', '--dry-run'],
          importMeta,
          context,
        )

        expect(mockOutputDryRunWrite).toHaveBeenCalledWith(
          expect.stringContaining('/.config/socket/config.json'),
          'auto-discover and set config value for "defaultOrg"',
          [
            'Discover the correct value for config key: defaultOrg',
            'Update config file with discovered value',
          ],
        )
        expect(mockHandleConfigAuto).not.toHaveBeenCalled()
      })

      it('should construct correct config path in dry-run', async () => {
        const originalHome = process.env['HOME']
        process.env['HOME'] = '/test/home'

        await cmdConfigAuto.run(
          ['defaultOrg', '--dry-run'],
          importMeta,
          context,
        )

        expect(mockOutputDryRunWrite).toHaveBeenCalledWith(
          '/test/home/.config/socket/config.json',
          'auto-discover and set config value for "defaultOrg"',
          expect.any(Array),
        )

        process.env['HOME'] = originalHome
      })

      it('should not execute handler in dry-run mode', async () => {
        await cmdConfigAuto.run(['apiToken', '--dry-run'], importMeta, context)

        expect(mockHandleConfigAuto).not.toHaveBeenCalled()
      })
    })

    describe('output formats', () => {
      it('should pass text output kind when no format flag provided', async () => {
        mockGetOutputKind.mockReturnValue('text')

        await cmdConfigAuto.run(['defaultOrg'], importMeta, context)

        expect(mockGetOutputKind).toHaveBeenCalledWith(false, false)
        expect(mockHandleConfigAuto).toHaveBeenCalledWith({
          key: 'defaultOrg',
          outputKind: 'text',
        })
      })

      it('should pass json output kind when --json flag provided', async () => {
        mockGetOutputKind.mockReturnValue('json')

        await cmdConfigAuto.run(['defaultOrg', '--json'], importMeta, context)

        expect(mockGetOutputKind).toHaveBeenCalledWith(true, false)
        expect(mockHandleConfigAuto).toHaveBeenCalledWith({
          key: 'defaultOrg',
          outputKind: 'json',
        })
      })

      it('should pass markdown output kind when --markdown flag provided', async () => {
        mockGetOutputKind.mockReturnValue('markdown')

        await cmdConfigAuto.run(
          ['defaultOrg', '--markdown'],
          importMeta,
          context,
        )

        expect(mockGetOutputKind).toHaveBeenCalledWith(false, true)
        expect(mockHandleConfigAuto).toHaveBeenCalledWith({
          key: 'defaultOrg',
          outputKind: 'markdown',
        })
      })
    })

    describe('flag validation', () => {
      it('should validate that --json and --markdown are not used together', async () => {
        await cmdConfigAuto.run(
          ['defaultOrg', '--json', '--markdown'],
          importMeta,
          context,
        )

        expect(mockCheckCommandInput).toHaveBeenCalled()
        const call = mockCheckCommandInput.mock.calls[0]
        expect(call[0]).toBe('text')
        expect(call[1]).toMatchObject({
          message: 'Config key should be the first arg',
        })
        expect(call[2]).toMatchObject({
          nook: true,
          test: false,
          message:
            'The `--json` and `--markdown` flags can not be used at the same time',
          fail: 'bad',
        })
      })

      it('should not call handler when flag validation fails', async () => {
        mockCheckCommandInput.mockReturnValue(false)

        await cmdConfigAuto.run(
          ['defaultOrg', '--json', '--markdown'],
          importMeta,
          context,
        )

        expect(mockHandleConfigAuto).not.toHaveBeenCalled()
      })
    })

    describe('edge cases', () => {
      it('should handle readonly argv array', async () => {
        const readonlyArgv = Object.freeze([
          'defaultOrg',
        ]) as readonly string[]

        await cmdConfigAuto.run(readonlyArgv, importMeta, context)

        expect(mockHandleConfigAuto).toHaveBeenCalledWith({
          key: 'defaultOrg',
          outputKind: 'text',
        })
      })

      it('should handle missing HOME environment variable in dry-run', async () => {
        const originalHome = process.env['HOME']
        delete process.env['HOME']

        await cmdConfigAuto.run(
          ['defaultOrg', '--dry-run'],
          importMeta,
          context,
        )

        expect(mockOutputDryRunWrite).toHaveBeenCalledWith(
          expect.stringContaining('config.json'),
          expect.any(String),
          expect.any(Array),
        )

        process.env['HOME'] = originalHome
      })
    })
  })
})
