/**
 * Unit tests for repository parent command.
 *
 * Tests the parent command that routes to repository management subcommands.
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
const { cmdRepository } = await import(
  '../../../../src/commands/repository/cmd-repository.mts'
)
const { cmdRepositoryCreate } = await import(
  '../../../../src/commands/repository/cmd-repository-create.mts'
)
const { cmdRepositoryDel } = await import(
  '../../../../src/commands/repository/cmd-repository-del.mts'
)
const { cmdRepositoryList } = await import(
  '../../../../src/commands/repository/cmd-repository-list.mts'
)
const { cmdRepositoryUpdate } = await import(
  '../../../../src/commands/repository/cmd-repository-update.mts'
)
const { cmdRepositoryView } = await import(
  '../../../../src/commands/repository/cmd-repository-view.mts'
)

describe('cmd-repository', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('command metadata', () => {
    it('should have correct description', () => {
      expect(cmdRepository.description).toBe('Manage registered repositories')
    })

    it('should not have hidden property set to true', () => {
      expect(cmdRepository.hidden).toBeUndefined()
    })

    it('should have a run method', () => {
      expect(typeof cmdRepository.run).toBe('function')
    })
  })

  describe('subcommand routing', () => {
    const importMeta = { url: 'file:///test/cmd-repository.mts' }
    const context = { parentName: 'socket' }

    it('should call meowWithSubcommands with correct configuration', async () => {
      mockMeowWithSubcommands.mockResolvedValue(undefined)

      await cmdRepository.run(['list'], importMeta, context)

      expect(mockMeowWithSubcommands).toHaveBeenCalledTimes(1)
      expect(mockMeowWithSubcommands).toHaveBeenCalledWith(
        {
          argv: ['list'],
          importMeta,
          name: 'socket repository',
          subcommands: {
            create: cmdRepositoryCreate,
            del: cmdRepositoryDel,
            list: cmdRepositoryList,
            update: cmdRepositoryUpdate,
            view: cmdRepositoryView,
          },
        },
        {
          description: 'Manage registered repositories',
        },
      )
    })

    it('should construct correct command name from parent', async () => {
      mockMeowWithSubcommands.mockResolvedValue(undefined)

      await cmdRepository.run(['view'], importMeta, {
        parentName: 'custom-parent',
      })

      expect(mockMeowWithSubcommands).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'custom-parent repository',
        }),
        expect.anything(),
      )
    })

    it('should include all subcommands', async () => {
      mockMeowWithSubcommands.mockResolvedValue(undefined)

      await cmdRepository.run([], importMeta, context)

      const call = mockMeowWithSubcommands.mock.calls[0]
      const subcommands = call[0].subcommands

      expect(Object.keys(subcommands)).toEqual([
        'create',
        'view',
        'list',
        'del',
        'update',
      ])
    })

    it('should pass through argv unchanged', async () => {
      mockMeowWithSubcommands.mockResolvedValue(undefined)
      const argv = ['create', 'owner/repo', '--json']

      await cmdRepository.run(argv, importMeta, context)

      expect(mockMeowWithSubcommands).toHaveBeenCalledWith(
        expect.objectContaining({
          argv,
        }),
        expect.anything(),
      )
    })

    it('should handle readonly argv', async () => {
      mockMeowWithSubcommands.mockResolvedValue(undefined)
      const argv = Object.freeze(['list']) as readonly string[]

      await cmdRepository.run(argv, importMeta, context)

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

      await cmdRepository.run(
        [],
        { url: 'file:///test' },
        { parentName: 'socket' },
      )

      const call = mockMeowWithSubcommands.mock.calls[0]
      const subcommands = call[0].subcommands

      expect(subcommands.create).toBe(cmdRepositoryCreate)
      expect(subcommands.view).toBe(cmdRepositoryView)
      expect(subcommands.list).toBe(cmdRepositoryList)
      expect(subcommands.del).toBe(cmdRepositoryDel)
      expect(subcommands.update).toBe(cmdRepositoryUpdate)
    })
  })

  describe('subcommand ordering', () => {
    it('should maintain consistent subcommand order', async () => {
      mockMeowWithSubcommands.mockResolvedValue(undefined)

      await cmdRepository.run(
        [],
        { url: 'file:///test' },
        { parentName: 'socket' },
      )

      const call = mockMeowWithSubcommands.mock.calls[0]
      const subcommandKeys = Object.keys(call[0].subcommands)

      expect(subcommandKeys).toEqual([
        'create',
        'view',
        'list',
        'del',
        'update',
      ])
    })
  })

  describe('error handling', () => {
    it('should propagate errors from meowWithSubcommands', async () => {
      const testError = new Error('Subcommand error')
      mockMeowWithSubcommands.mockRejectedValue(testError)

      await expect(
        cmdRepository.run([], { url: 'file:///test' }, { parentName: 'socket' }),
      ).rejects.toThrow('Subcommand error')
    })
  })

  describe('options configuration', () => {
    it('should pass description in options', async () => {
      mockMeowWithSubcommands.mockResolvedValue(undefined)

      await cmdRepository.run(
        [],
        { url: 'file:///test' },
        { parentName: 'socket' },
      )

      const call = mockMeowWithSubcommands.mock.calls[0]
      const options = call[1]

      expect(options.description).toBe('Manage registered repositories')
    })

    it('should not include aliases', async () => {
      mockMeowWithSubcommands.mockResolvedValue(undefined)

      await cmdRepository.run(
        [],
        { url: 'file:///test' },
        { parentName: 'socket' },
      )

      const call = mockMeowWithSubcommands.mock.calls[0]
      const options = call[1]

      expect(options.aliases).toBeUndefined()
    })
  })
})
