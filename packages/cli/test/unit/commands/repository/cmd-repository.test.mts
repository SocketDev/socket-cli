/**
 * Unit tests for repository parent command.
 *
 * Tests the parent command that routes to repository management subcommands.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { cmdRepository } from '../../../../src/commands/repository/cmd-repository.mts'
import { cmdRepositoryCreate } from '../../../../src/commands/repository/cmd-repository-create.mts'
import { cmdRepositoryDel } from '../../../../src/commands/repository/cmd-repository-del.mts'
import { cmdRepositoryList } from '../../../../src/commands/repository/cmd-repository-list.mts'
import { cmdRepositoryUpdate } from '../../../../src/commands/repository/cmd-repository-update.mts'
import { cmdRepositoryView } from '../../../../src/commands/repository/cmd-repository-view.mts'

const mockLogger = vi.hoisted(() => ({
  error: vi.fn(),
  fail: vi.fn(),
  info: vi.fn(),
  log: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
}))

vi.mock(import('@socketsecurity/lib-stable/logger/default'), () => ({
  getDefaultLogger: () => mockLogger,
}))

const mockMeowWithSubcommands = vi.hoisted(() => vi.fn())

vi.mock(import('../../../../src/util/cli/with-subcommands.mts'), () => ({
  meowWithSubcommands: mockMeowWithSubcommands,
}))

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
      const [config, callOptions] = mockMeowWithSubcommands.mock.calls[0]
      expect(config).toMatchObject({
        argv: ['list'],
        name: 'socket repository',
      })
      expect(config.importMeta === importMeta).toBe(true)
      // Subcommand identity (each entry IS the imported src module instance)
      // is asserted in the "include all subcommands" test below.
      expect(Object.keys(config.subcommands).toSorted()).toEqual([
        'create',
        'del',
        'list',
        'update',
        'view',
      ])
      expect(callOptions).toEqual({
        description: 'Manage registered repositories',
      })
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

      // Reference-identity checks (=== inside the expect(actual) call): the
      // routed subcommand must BE the imported src module instance, so the
      // -stable alias (a different module instance) can't stand in here.
      expect(subcommands.create === cmdRepositoryCreate).toBe(true)
      expect(subcommands.view === cmdRepositoryView).toBe(true)
      expect(subcommands.list === cmdRepositoryList).toBe(true)
      expect(subcommands.del === cmdRepositoryDel).toBe(true)
      expect(subcommands.update === cmdRepositoryUpdate).toBe(true)
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
        cmdRepository.run(
          [],
          { url: 'file:///test' },
          { parentName: 'socket' },
        ),
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
