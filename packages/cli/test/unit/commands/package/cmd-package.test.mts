/**
 * Unit tests for package parent command.
 *
 * Tests the parent command that routes to package analysis subcommands.
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
const { cmdPackage } = await import(
  '../../../../src/commands/package/cmd-package.mts'
)
const { cmdPackageScore } = await import(
  '../../../../src/commands/package/cmd-package-score.mts'
)
const { cmdPackageShallow } = await import(
  '../../../../src/commands/package/cmd-package-shallow.mts'
)

describe('cmd-package', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('command metadata', () => {
    it('should have correct description', () => {
      expect(cmdPackage.description).toBe('Look up published package details')
    })

    it('should not be hidden', () => {
      expect(cmdPackage.hidden).toBe(false)
    })

    it('should have a run method', () => {
      expect(typeof cmdPackage.run).toBe('function')
    })
  })

  describe('subcommand routing', () => {
    const importMeta = { url: 'file:///test/cmd-package.mts' }
    const context = { parentName: 'socket' }

    it('should call meowWithSubcommands with correct configuration', async () => {
      mockMeowWithSubcommands.mockResolvedValue(undefined)

      await cmdPackage.run(['score'], importMeta, context)

      expect(mockMeowWithSubcommands).toHaveBeenCalledTimes(1)
      expect(mockMeowWithSubcommands).toHaveBeenCalledWith(
        {
          argv: ['score'],
          importMeta,
          name: 'socket package',
          subcommands: {
            score: cmdPackageScore,
            shallow: cmdPackageShallow,
          },
        },
        {
          aliases: {
            deep: {
              argv: ['score'],
              description: 'Look up published package details',
              hidden: true,
            },
          },
          description: 'Look up published package details',
        },
      )
    })

    it('should construct correct command name from parent', async () => {
      mockMeowWithSubcommands.mockResolvedValue(undefined)

      await cmdPackage.run(['shallow'], importMeta, {
        parentName: 'custom-parent',
      })

      expect(mockMeowWithSubcommands).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'custom-parent package',
        }),
        expect.anything(),
      )
    })

    it('should include all subcommands', async () => {
      mockMeowWithSubcommands.mockResolvedValue(undefined)

      await cmdPackage.run([], importMeta, context)

      const call = mockMeowWithSubcommands.mock.calls[0]
      const subcommands = call[0].subcommands

      expect(Object.keys(subcommands)).toEqual(['score', 'shallow'])
    })

    it('should pass through argv unchanged', async () => {
      mockMeowWithSubcommands.mockResolvedValue(undefined)
      const argv = ['score', 'npm/lodash', '--json']

      await cmdPackage.run(argv, importMeta, context)

      expect(mockMeowWithSubcommands).toHaveBeenCalledWith(
        expect.objectContaining({
          argv,
        }),
        expect.anything(),
      )
    })

    it('should handle readonly argv', async () => {
      mockMeowWithSubcommands.mockResolvedValue(undefined)
      const argv = Object.freeze(['shallow', 'npm/react']) as readonly string[]

      await cmdPackage.run(argv, importMeta, context)

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

      await cmdPackage.run(
        [],
        { url: 'file:///test' },
        { parentName: 'socket' },
      )

      const call = mockMeowWithSubcommands.mock.calls[0]
      const subcommands = call[0].subcommands

      expect(subcommands.score).toBe(cmdPackageScore)
      expect(subcommands.shallow).toBe(cmdPackageShallow)
    })
  })

  describe('aliases configuration', () => {
    it('should configure deep alias for score', async () => {
      mockMeowWithSubcommands.mockResolvedValue(undefined)

      await cmdPackage.run([], { url: 'file:///test' }, { parentName: 'socket' })

      const call = mockMeowWithSubcommands.mock.calls[0]
      const aliases = call[1].aliases

      expect(aliases.deep).toEqual({
        argv: ['score'],
        description: 'Look up published package details',
        hidden: true,
      })
    })

    it('should mark deep alias as hidden', async () => {
      mockMeowWithSubcommands.mockResolvedValue(undefined)

      await cmdPackage.run([], { url: 'file:///test' }, { parentName: 'socket' })

      const call = mockMeowWithSubcommands.mock.calls[0]
      const aliases = call[1].aliases

      expect(aliases.deep.hidden).toBe(true)
    })
  })

  describe('error handling', () => {
    it('should propagate errors from meowWithSubcommands', async () => {
      const testError = new Error('Subcommand error')
      mockMeowWithSubcommands.mockRejectedValue(testError)

      await expect(
        cmdPackage.run([], { url: 'file:///test' }, { parentName: 'socket' }),
      ).rejects.toThrow('Subcommand error')
    })
  })

  describe('options configuration', () => {
    it('should pass description in options', async () => {
      mockMeowWithSubcommands.mockResolvedValue(undefined)

      await cmdPackage.run([], { url: 'file:///test' }, { parentName: 'socket' })

      const call = mockMeowWithSubcommands.mock.calls[0]
      const options = call[1]

      expect(options.description).toBe('Look up published package details')
    })
  })
})
