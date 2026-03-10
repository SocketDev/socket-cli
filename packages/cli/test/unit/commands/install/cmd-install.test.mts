/**
 * Unit tests for install parent command.
 *
 * Tests the root command that provides access to subcommands for installing
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
const { cmdInstall } = await import(
  '../../../../src/commands/install/cmd-install.mts'
)

describe('cmd-install', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('command metadata', () => {
    it('should have correct description', () => {
      expect(cmdInstall.description).toBe('Install Socket CLI tab completion')
    })

    it('should not be hidden', () => {
      expect(cmdInstall.hidden).toBe(false)
    })
  })

  describe('run', () => {
    const importMeta = { url: 'file:///test/cmd-install.mts' }
    const context = { parentName: 'socket' }

    it('should call meowWithSubcommands with correct parameters', async () => {
      const argv = ['completion']

      await cmdInstall.run(argv, importMeta, context)

      expect(mockMeowWithSubcommands).toHaveBeenCalledTimes(1)

      const [meowConfig, options] = mockMeowWithSubcommands.mock.calls[0]

      // Verify config structure.
      expect(meowConfig).toMatchObject({
        argv,
        name: 'socket install',
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
        description: 'Install Socket CLI tab completion',
      })
    })

    it('should include completion subcommand', async () => {
      await cmdInstall.run([], importMeta, context)

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

      await cmdInstall.run([], importMeta, customContext)

      const [meowConfig] = mockMeowWithSubcommands.mock.calls[0]

      expect(meowConfig.name).toBe('custom-socket install')
    })

    it('should pass through argv to meowWithSubcommands', async () => {
      const customArgv = ['completion', '--help']

      await cmdInstall.run(customArgv, importMeta, context)

      const [meowConfig] = mockMeowWithSubcommands.mock.calls[0]

      expect(meowConfig.argv).toBe(customArgv)
    })

    it('should pass through importMeta to meowWithSubcommands', async () => {
      const customImportMeta = { url: 'file:///custom/path.mts' }

      await cmdInstall.run([], customImportMeta, context)

      const [meowConfig] = mockMeowWithSubcommands.mock.calls[0]

      expect(meowConfig.importMeta).toBe(customImportMeta)
    })
  })
})
