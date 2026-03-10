/**
 * Unit tests for config parent command.
 *
 * Tests the parent command that routes to configuration management subcommands.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockLogger = vi.hoisted(() => ({
  error: vi.fn(),
  fail: vi.fn(),
  info: vi.fn(),
  log: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
}))

vi.mock('@socketsecurity/lib/logger', () => ({
  getDefaultLogger: () => mockLogger,
}))

const mockMeowWithSubcommands = vi.hoisted(() => vi.fn())

vi.mock('../../../../src/utils/cli/with-subcommands.mts', () => ({
  meowWithSubcommands: mockMeowWithSubcommands,
}))

// Import after mocks.
const { cmdConfig } =
  await import('../../../../src/commands/config/cmd-config.mts')
const { cmdConfigAuto } =
  await import('../../../../src/commands/config/cmd-config-auto.mts')
const { cmdConfigGet } =
  await import('../../../../src/commands/config/cmd-config-get.mts')
const { cmdConfigList } =
  await import('../../../../src/commands/config/cmd-config-list.mts')
const { cmdConfigSet } =
  await import('../../../../src/commands/config/cmd-config-set.mts')
const { cmdConfigUnset } =
  await import('../../../../src/commands/config/cmd-config-unset.mts')

describe('cmd-config', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('command metadata', () => {
    it('should have correct description', () => {
      expect(cmdConfig.description).toBe('Manage Socket CLI configuration')
    })

    it('should not be hidden', () => {
      expect(cmdConfig.hidden).toBe(false)
    })

    it('should have a run method', () => {
      expect(typeof cmdConfig.run).toBe('function')
    })
  })

  describe('subcommand routing', () => {
    const importMeta = { url: 'file:///test/cmd-config.mts' }
    const context = { parentName: 'socket' }

    it('should call meowWithSubcommands with correct configuration', async () => {
      mockMeowWithSubcommands.mockResolvedValue(undefined)

      await cmdConfig.run(['auto'], importMeta, context)

      expect(mockMeowWithSubcommands).toHaveBeenCalledTimes(1)
      expect(mockMeowWithSubcommands).toHaveBeenCalledWith(
        {
          argv: ['auto'],
          importMeta,
          name: 'socket config',
          subcommands: {
            auto: cmdConfigAuto,
            get: cmdConfigGet,
            list: cmdConfigList,
            set: cmdConfigSet,
            unset: cmdConfigUnset,
          },
        },
        {
          description: 'Manage Socket CLI configuration',
        },
      )
    })

    it('should construct correct command name from parent', async () => {
      mockMeowWithSubcommands.mockResolvedValue(undefined)

      await cmdConfig.run(['list'], importMeta, {
        parentName: 'custom-parent',
      })

      expect(mockMeowWithSubcommands).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'custom-parent config',
        }),
        expect.anything(),
      )
    })

    it('should include all subcommands', async () => {
      mockMeowWithSubcommands.mockResolvedValue(undefined)

      await cmdConfig.run([], importMeta, context)

      const call = mockMeowWithSubcommands.mock.calls[0]
      const subcommands = call[0].subcommands

      expect(Object.keys(subcommands)).toEqual([
        'auto',
        'get',
        'list',
        'set',
        'unset',
      ])
    })

    it('should pass through argv unchanged', async () => {
      mockMeowWithSubcommands.mockResolvedValue(undefined)
      const argv = ['set', 'apiToken', 'test-value', '--dry-run']

      await cmdConfig.run(argv, importMeta, context)

      expect(mockMeowWithSubcommands).toHaveBeenCalledWith(
        expect.objectContaining({
          argv,
        }),
        expect.anything(),
      )
    })

    it('should handle readonly argv', async () => {
      mockMeowWithSubcommands.mockResolvedValue(undefined)
      const argv = Object.freeze(['get', 'apiToken']) as readonly string[]

      await cmdConfig.run(argv, importMeta, context)

      expect(mockMeowWithSubcommands).toHaveBeenCalledWith(
        expect.objectContaining({
          argv,
        }),
        expect.anything(),
      )
    })
  })

  describe('subcommand validation', () => {
    it('should reference correct subcommand objects', async () => {
      mockMeowWithSubcommands.mockResolvedValue(undefined)

      await cmdConfig.run([], { url: 'file:///test' }, { parentName: 'socket' })

      const call = mockMeowWithSubcommands.mock.calls[0]
      const subcommands = call[0].subcommands

      expect(subcommands.auto).toBe(cmdConfigAuto)
      expect(subcommands.get).toBe(cmdConfigGet)
      expect(subcommands.list).toBe(cmdConfigList)
      expect(subcommands.set).toBe(cmdConfigSet)
      expect(subcommands.unset).toBe(cmdConfigUnset)
    })
  })

  describe('error handling', () => {
    it('should propagate errors from meowWithSubcommands', async () => {
      const testError = new Error('Subcommand error')
      mockMeowWithSubcommands.mockRejectedValue(testError)

      await expect(
        cmdConfig.run([], { url: 'file:///test' }, { parentName: 'socket' }),
      ).rejects.toThrow('Subcommand error')
    })
  })

  describe('options configuration', () => {
    it('should pass description in options', async () => {
      mockMeowWithSubcommands.mockResolvedValue(undefined)

      await cmdConfig.run([], { url: 'file:///test' }, { parentName: 'socket' })

      const call = mockMeowWithSubcommands.mock.calls[0]
      const options = call[1]

      expect(options.description).toBe('Manage Socket CLI configuration')
    })
  })
})
