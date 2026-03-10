/**
 * Unit tests for uninstall parent command.
 *
 * Tests the root command that provides access to subcommands for uninstalling
 * Socket CLI features like tab completion.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock meowWithSubcommands.
const mockMeowWithSubcommands = vi.hoisted(() => vi.fn())

vi.mock('../../../../src/utils/cli/with-subcommands.mjs', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../../src/utils/cli/with-subcommands.mjs')>()
  return {
    ...actual,
    meowWithSubcommands: mockMeowWithSubcommands,
  }
})

// Import after mocks.
const { cmdUninstall } = await import(
  '../../../../src/commands/uninstall/cmd-uninstall.mts'
)

describe('cmd-uninstall', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('command metadata', () => {
    it('should have correct description', () => {
      expect(cmdUninstall.description).toBe('Uninstall Socket CLI tab completion')
    })

    it('should not be hidden', () => {
      expect(cmdUninstall.hidden).toBe(false)
    })
  })

  describe('run', () => {
    const importMeta = { url: 'file:///test/cmd-uninstall.mts' }
    const context = { parentName: 'socket' }

    it('should call meowWithSubcommands with correct parameters', async () => {
      const argv = ['completion']

      await cmdUninstall.run(argv, importMeta, context)

      expect(mockMeowWithSubcommands).toHaveBeenCalledTimes(1)

      const [meowConfig, options] = mockMeowWithSubcommands.mock.calls[0]

      // Verify config structure.
      expect(meowConfig).toMatchObject({
        argv,
        name: 'socket uninstall',
        importMeta,
        subcommands: expect.objectContaining({
          completion: expect.objectContaining({
            description: expect.any(String),
            hidden: expect.any(Boolean),
            run: expect.any(Function),
          }),
        }),
      })

      // Verify options.
      expect(options).toMatchObject({
        description: 'Uninstall Socket CLI tab completion',
      })
    })

    it('should include completion subcommand', async () => {
      await cmdUninstall.run([], importMeta, context)

      const [meowConfig] = mockMeowWithSubcommands.mock.calls[0]

      expect(meowConfig.subcommands).toHaveProperty('completion')
      expect(meowConfig.subcommands.completion).toMatchObject({
        description: expect.any(String),
        hidden: expect.any(Boolean),
        run: expect.any(Function),
      })
    })

    it('should construct correct command name from parentName', async () => {
      const customContext = { parentName: 'custom-socket' }

      await cmdUninstall.run([], importMeta, customContext)

      const [meowConfig] = mockMeowWithSubcommands.mock.calls[0]

      expect(meowConfig.name).toBe('custom-socket uninstall')
    })

    it('should pass through argv to meowWithSubcommands', async () => {
      const customArgv = ['completion', '--help']

      await cmdUninstall.run(customArgv, importMeta, context)

      const [meowConfig] = mockMeowWithSubcommands.mock.calls[0]

      expect(meowConfig.argv).toBe(customArgv)
    })

    it('should pass through importMeta to meowWithSubcommands', async () => {
      const customImportMeta = { url: 'file:///custom/path.mts' }

      await cmdUninstall.run([], customImportMeta, context)

      const [meowConfig] = mockMeowWithSubcommands.mock.calls[0]

      expect(meowConfig.importMeta).toBe(customImportMeta)
    })
  })
})
