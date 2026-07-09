/**
 * Unit tests for scan parent command.
 *
 * Tests the parent command that routes to scan management subcommands.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { cmdScan } from '../../../../src/commands/scan/cmd-scan.mts'
import { cmdScanCreate } from '../../../../src/commands/scan/cmd-scan-create.mts'
import { cmdScanDel } from '../../../../src/commands/scan/cmd-scan-del.mts'
import { cmdScanDiff } from '../../../../src/commands/scan/cmd-scan-diff.mts'
import { cmdScanGithub } from '../../../../src/commands/scan/cmd-scan-github.mts'
import { cmdScanList } from '../../../../src/commands/scan/cmd-scan-list.mts'
import { cmdScanMetadata } from '../../../../src/commands/scan/cmd-scan-metadata.mts'
import { cmdScanReach } from '../../../../src/commands/scan/cmd-scan-reach.mts'
import { cmdScanReport } from '../../../../src/commands/scan/cmd-scan-report.mts'
import { cmdScanSetup } from '../../../../src/commands/scan/cmd-scan-setup.mts'
import { cmdScanView } from '../../../../src/commands/scan/cmd-scan-view.mts'

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

describe('cmd-scan', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('command metadata', () => {
    it('should have correct description', () => {
      expect(cmdScan.description).toBe('Manage Socket scans')
    })

    it('should not have hidden property set to true', () => {
      expect(cmdScan.hidden).toBeUndefined()
    })

    it('should have a run method', () => {
      expect(typeof cmdScan.run).toBe('function')
    })
  })

  describe('subcommand routing', () => {
    const importMeta = { url: 'file:///test/cmd-scan.mts' }
    const context = { parentName: 'socket' }

    it('should call meowWithSubcommands with correct configuration', async () => {
      mockMeowWithSubcommands.mockResolvedValue(undefined)

      await cmdScan.run(['list'], importMeta, context)

      expect(mockMeowWithSubcommands).toHaveBeenCalledTimes(1)
      expect(mockMeowWithSubcommands).toHaveBeenCalledWith(
        {
          argv: ['list'],
          importMeta,
          name: 'socket scan',
          subcommands: {
            create: cmdScanCreate,
            del: cmdScanDel,
            diff: cmdScanDiff,
            github: cmdScanGithub,
            list: cmdScanList,
            metadata: cmdScanMetadata,
            reach: cmdScanReach,
            report: cmdScanReport,
            setup: cmdScanSetup,
            view: cmdScanView,
          },
        },
        {
          aliases: {
            meta: {
              argv: ['metadata'],
              description: cmdScanMetadata.description,
              hidden: true,
            },
            reachability: {
              argv: ['reach'],
              description: cmdScanReach.description,
              hidden: true,
            },
          },
          description: 'Manage Socket scans',
        },
      )
    })

    it('should construct correct command name from parent', async () => {
      mockMeowWithSubcommands.mockResolvedValue(undefined)

      await cmdScan.run(['create'], importMeta, {
        parentName: 'custom-parent',
      })

      expect(mockMeowWithSubcommands).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'custom-parent scan',
        }),
        expect.anything(),
      )
    })

    it('should include all subcommands', async () => {
      mockMeowWithSubcommands.mockResolvedValue(undefined)

      await cmdScan.run([], importMeta, context)

      const call = mockMeowWithSubcommands.mock.calls[0]
      const subcommands = call[0].subcommands

      expect(Object.keys(subcommands)).toEqual([
        'create',
        'del',
        'diff',
        'github',
        'list',
        'metadata',
        'reach',
        'report',
        'setup',
        'view',
      ])
    })

    it('should pass through argv unchanged', async () => {
      mockMeowWithSubcommands.mockResolvedValue(undefined)
      const argv = ['create', 'package.json', '--json']

      await cmdScan.run(argv, importMeta, context)

      expect(mockMeowWithSubcommands).toHaveBeenCalledWith(
        expect.objectContaining({
          argv,
        }),
        expect.anything(),
      )
    })

    it('should handle readonly argv', async () => {
      mockMeowWithSubcommands.mockResolvedValue(undefined)
      const argv = Object.freeze(['view', 'scan-id']) as readonly string[]

      await cmdScan.run(argv, importMeta, context)

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

      await cmdScan.run([], { url: 'file:///test' }, { parentName: 'socket' })

      const call = mockMeowWithSubcommands.mock.calls[0]
      const subcommands = call[0].subcommands

      // Reference-identity checks (=== inside the expect(actual) call): the
      // routed subcommand must BE the imported src module instance, so the
      // -stable alias (a different module instance) can't stand in here.
      expect(subcommands.create === cmdScanCreate).toBe(true)
      expect(subcommands.del === cmdScanDel).toBe(true)
      expect(subcommands.diff === cmdScanDiff).toBe(true)
      expect(subcommands.github === cmdScanGithub).toBe(true)
      expect(subcommands.list === cmdScanList).toBe(true)
      expect(subcommands.metadata === cmdScanMetadata).toBe(true)
      expect(subcommands.reach === cmdScanReach).toBe(true)
      expect(subcommands.report === cmdScanReport).toBe(true)
      expect(subcommands.setup === cmdScanSetup).toBe(true)
      expect(subcommands.view === cmdScanView).toBe(true)
    })
  })

  describe('aliases configuration', () => {
    it('should configure meta alias for metadata', async () => {
      mockMeowWithSubcommands.mockResolvedValue(undefined)

      await cmdScan.run([], { url: 'file:///test' }, { parentName: 'socket' })

      const call = mockMeowWithSubcommands.mock.calls[0]
      const aliases = call[1].aliases

      expect(aliases.meta).toEqual({
        argv: ['metadata'],
        description: cmdScanMetadata.description,
        hidden: true,
      })
    })

    it('should configure reachability alias for reach', async () => {
      mockMeowWithSubcommands.mockResolvedValue(undefined)

      await cmdScan.run([], { url: 'file:///test' }, { parentName: 'socket' })

      const call = mockMeowWithSubcommands.mock.calls[0]
      const aliases = call[1].aliases

      expect(aliases.reachability).toEqual({
        argv: ['reach'],
        description: cmdScanReach.description,
        hidden: true,
      })
    })

    it('should mark all aliases as hidden', async () => {
      mockMeowWithSubcommands.mockResolvedValue(undefined)

      await cmdScan.run([], { url: 'file:///test' }, { parentName: 'socket' })

      const call = mockMeowWithSubcommands.mock.calls[0]
      const aliases = call[1].aliases

      expect(aliases.meta.hidden).toBe(true)
      expect(aliases.reachability.hidden).toBe(true)
    })
  })

  describe('subcommand ordering', () => {
    it('should maintain consistent subcommand order', async () => {
      mockMeowWithSubcommands.mockResolvedValue(undefined)

      await cmdScan.run([], { url: 'file:///test' }, { parentName: 'socket' })

      const call = mockMeowWithSubcommands.mock.calls[0]
      const subcommandKeys = Object.keys(call[0].subcommands)

      expect(subcommandKeys).toEqual([
        'create',
        'del',
        'diff',
        'github',
        'list',
        'metadata',
        'reach',
        'report',
        'setup',
        'view',
      ])
    })
  })

  describe('error handling', () => {
    it('should propagate errors from meowWithSubcommands', async () => {
      const testError = new Error('Subcommand error')
      mockMeowWithSubcommands.mockRejectedValue(testError)

      await expect(
        cmdScan.run([], { url: 'file:///test' }, { parentName: 'socket' }),
      ).rejects.toThrow('Subcommand error')
    })
  })

  describe('options configuration', () => {
    it('should pass description in options', async () => {
      mockMeowWithSubcommands.mockResolvedValue(undefined)

      await cmdScan.run([], { url: 'file:///test' }, { parentName: 'socket' })

      const call = mockMeowWithSubcommands.mock.calls[0]
      const options = call[1]

      expect(options.description).toBe('Manage Socket scans')
    })
  })
})
