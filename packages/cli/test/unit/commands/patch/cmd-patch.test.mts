/**
 * Unit tests for patch command.
 *
 * Tests the command that manages CVE patches for dependencies.
 * This command forwards subcommands to socket-patch via DLX.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock meowOrExit.
const mockMeowOrExit = vi.hoisted(() => vi.fn().mockReturnValue({ flags: {} }))

// Mock spawnSocketPatchDlx.
const mockSpawnSocketPatchDlx = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    spawnPromise: Promise.resolve({ code: 0, signal: null }),
  }),
)

vi.mock('../../../../src/utils/cli/with-subcommands.mts', async importOriginal => {
  const actual =
    await importOriginal<
      typeof import('../../../../src/utils/cli/with-subcommands.mts')
    >()
  return {
    ...actual,
    meowOrExit: mockMeowOrExit,
  }
})

vi.mock('../../../../src/utils/dlx/spawn.mjs', () => ({
  spawnSocketPatchDlx: mockSpawnSocketPatchDlx,
}))

// Import after mocks.
const { cmdPatch, CMD_NAME } = await import(
  '../../../../src/commands/patch/cmd-patch.mts'
)

describe('cmd-patch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
  })

  describe('command metadata', () => {
    it('should export CMD_NAME as patch', () => {
      expect(CMD_NAME).toBe('patch')
    })

    it('should have correct description', () => {
      expect(cmdPatch.description).toBe('Manage CVE patches for dependencies')
    })

    it('should not be hidden', () => {
      expect(cmdPatch.hidden).toBe(false)
    })
  })

  describe('help path (no subcommand)', () => {
    const importMeta = { url: 'file:///test/cmd-patch.mts' }
    const context = { parentName: 'socket' }

    it('should call meowOrExit when only flags provided', async () => {
      await cmdPatch.run(['--help'], importMeta, context)

      expect(mockMeowOrExit).toHaveBeenCalledWith(
        expect.objectContaining({
          argv: ['--help'],
          parentName: 'socket',
          config: expect.objectContaining({
            commandName: 'patch',
            description: 'Manage CVE patches for dependencies',
            hidden: false,
            flags: {},
          }),
        }),
      )
    })

    it('should call meowOrExit when no arguments provided', async () => {
      await cmdPatch.run([], importMeta, context)

      expect(mockMeowOrExit).toHaveBeenCalledWith(
        expect.objectContaining({
          argv: [],
          parentName: 'socket',
        }),
      )
    })

    it('should include help text with usage examples', async () => {
      await cmdPatch.run(['--version'], importMeta, context)

      const callArgs = mockMeowOrExit.mock.calls[0]?.[0]
      const helpText = callArgs?.config?.help?.('socket patch')

      expect(helpText).toContain('Usage')
      expect(helpText).toContain('$ socket patch ...')
      expect(helpText).toContain('Examples')
      expect(helpText).toContain('$ socket patch list')
      expect(helpText).toContain('$ socket patch get <package>')
      expect(helpText).toContain('$ socket patch apply')
    })

    it('should still forward to socket-patch after help path', async () => {
      await cmdPatch.run(['--json'], importMeta, context)

      // Both meowOrExit and spawnSocketPatchDlx should be called.
      expect(mockMeowOrExit).toHaveBeenCalled()
      expect(mockSpawnSocketPatchDlx).toHaveBeenCalledWith(
        ['--json'],
        expect.objectContaining({ stdio: 'inherit' }),
      )
    })
  })

  describe('subcommand forwarding', () => {
    const importMeta = { url: 'file:///test/cmd-patch.mts' }
    const context = { parentName: 'socket' }

    it('should forward list subcommand to socket-patch', async () => {
      await cmdPatch.run(['list'], importMeta, context)

      expect(mockMeowOrExit).not.toHaveBeenCalled()
      expect(mockSpawnSocketPatchDlx).toHaveBeenCalledWith(
        ['list'],
        expect.objectContaining({ stdio: 'inherit' }),
      )
    })

    it('should forward get subcommand with package argument', async () => {
      await cmdPatch.run(['get', 'lodash'], importMeta, context)

      expect(mockMeowOrExit).not.toHaveBeenCalled()
      expect(mockSpawnSocketPatchDlx).toHaveBeenCalledWith(
        ['get', 'lodash'],
        expect.objectContaining({ stdio: 'inherit' }),
      )
    })

    it('should forward apply subcommand to socket-patch', async () => {
      await cmdPatch.run(['apply'], importMeta, context)

      expect(mockMeowOrExit).not.toHaveBeenCalled()
      expect(mockSpawnSocketPatchDlx).toHaveBeenCalledWith(
        ['apply'],
        expect.objectContaining({ stdio: 'inherit' }),
      )
    })

    it('should forward subcommand with flags combined', async () => {
      await cmdPatch.run(['list', '--json', '--verbose'], importMeta, context)

      expect(mockMeowOrExit).not.toHaveBeenCalled()
      expect(mockSpawnSocketPatchDlx).toHaveBeenCalledWith(
        ['list', '--json', '--verbose'],
        expect.objectContaining({ stdio: 'inherit' }),
      )
    })

    it('should forward subcommand with directory argument', async () => {
      await cmdPatch.run(['list', '/path/to/project'], importMeta, context)

      expect(mockMeowOrExit).not.toHaveBeenCalled()
      expect(mockSpawnSocketPatchDlx).toHaveBeenCalledWith(
        ['list', '/path/to/project'],
        expect.objectContaining({ stdio: 'inherit' }),
      )
    })

    it('should forward download subcommand with purl', async () => {
      await cmdPatch.run(
        ['download', 'pkg:npm/lodash@4.17.21'],
        importMeta,
        context,
      )

      expect(mockMeowOrExit).not.toHaveBeenCalled()
      expect(mockSpawnSocketPatchDlx).toHaveBeenCalledWith(
        ['download', 'pkg:npm/lodash@4.17.21'],
        expect.objectContaining({ stdio: 'inherit' }),
      )
    })

    it('should forward info subcommand to socket-patch', async () => {
      await cmdPatch.run(['info', 'lodash'], importMeta, context)

      expect(mockMeowOrExit).not.toHaveBeenCalled()
      expect(mockSpawnSocketPatchDlx).toHaveBeenCalledWith(
        ['info', 'lodash'],
        expect.objectContaining({ stdio: 'inherit' }),
      )
    })

    it('should forward rm subcommand to socket-patch', async () => {
      await cmdPatch.run(['rm', 'lodash'], importMeta, context)

      expect(mockMeowOrExit).not.toHaveBeenCalled()
      expect(mockSpawnSocketPatchDlx).toHaveBeenCalledWith(
        ['rm', 'lodash'],
        expect.objectContaining({ stdio: 'inherit' }),
      )
    })

    it('should forward cleanup subcommand to socket-patch', async () => {
      await cmdPatch.run(['cleanup'], importMeta, context)

      expect(mockMeowOrExit).not.toHaveBeenCalled()
      expect(mockSpawnSocketPatchDlx).toHaveBeenCalledWith(
        ['cleanup'],
        expect.objectContaining({ stdio: 'inherit' }),
      )
    })
  })

  describe('exit code handling', () => {
    const importMeta = { url: 'file:///test/cmd-patch.mts' }
    const context = { parentName: 'socket' }

    it('should set exit code to 0 on success', async () => {
      mockSpawnSocketPatchDlx.mockResolvedValueOnce({
        spawnPromise: Promise.resolve({ code: 0, signal: null }),
      })

      await cmdPatch.run(['list'], importMeta, context)

      expect(process.exitCode).toBe(0)
    })

    it('should set exit code to 1 on failure', async () => {
      mockSpawnSocketPatchDlx.mockResolvedValueOnce({
        spawnPromise: Promise.resolve({ code: 1, signal: null }),
      })

      await cmdPatch.run(['list'], importMeta, context)

      expect(process.exitCode).toBe(1)
    })

    it('should propagate specific exit code from socket-patch', async () => {
      mockSpawnSocketPatchDlx.mockResolvedValueOnce({
        spawnPromise: Promise.resolve({ code: 42, signal: null }),
      })

      await cmdPatch.run(['apply'], importMeta, context)

      expect(process.exitCode).toBe(42)
    })

    it('should handle null exit code (signal termination)', async () => {
      mockSpawnSocketPatchDlx.mockResolvedValueOnce({
        spawnPromise: Promise.resolve({ code: null, signal: 'SIGTERM' }),
      })

      await cmdPatch.run(['apply'], importMeta, context)

      // When code is null and not 0, exitCode remains the default (1 from start).
      expect(process.exitCode).toBe(1)
    })

    it('should initialize exitCode to 1 before spawning', async () => {
      // Create a mock that captures exitCode during execution.
      let exitCodeDuringSpawn: number | undefined
      mockSpawnSocketPatchDlx.mockImplementationOnce(() => {
        exitCodeDuringSpawn = process.exitCode
        return Promise.resolve({
          spawnPromise: Promise.resolve({ code: 0, signal: null }),
        })
      })

      await cmdPatch.run(['list'], importMeta, context)

      expect(exitCodeDuringSpawn).toBe(1)
      expect(process.exitCode).toBe(0)
    })
  })

  describe('context handling', () => {
    const importMeta = { url: 'file:///test/cmd-patch.mts' }

    it('should use parentName from context', async () => {
      await cmdPatch.run([], importMeta, { parentName: 'custom-cli' })

      expect(mockMeowOrExit).toHaveBeenCalledWith(
        expect.objectContaining({
          parentName: 'custom-cli',
        }),
      )
    })

    it('should handle empty context object', async () => {
      await cmdPatch.run(['list'], importMeta, {})

      expect(mockSpawnSocketPatchDlx).toHaveBeenCalledWith(
        ['list'],
        expect.objectContaining({ stdio: 'inherit' }),
      )
    })

    it('should handle context with additional properties', async () => {
      await cmdPatch.run([], importMeta, {
        parentName: 'socket',
        extraProp: 'ignored',
      } as any)

      expect(mockMeowOrExit).toHaveBeenCalledWith(
        expect.objectContaining({
          parentName: 'socket',
        }),
      )
    })
  })

  describe('edge cases', () => {
    const importMeta = { url: 'file:///test/cmd-patch.mts' }
    const context = { parentName: 'socket' }

    it('should treat path starting with . as subcommand', async () => {
      await cmdPatch.run(['.'], importMeta, context)

      // Path "." doesn't start with "-", so it's treated as a subcommand.
      expect(mockMeowOrExit).not.toHaveBeenCalled()
      expect(mockSpawnSocketPatchDlx).toHaveBeenCalledWith(
        ['.'],
        expect.objectContaining({ stdio: 'inherit' }),
      )
    })

    it('should treat path starting with / as subcommand', async () => {
      await cmdPatch.run(['/path/to/dir'], importMeta, context)

      expect(mockMeowOrExit).not.toHaveBeenCalled()
      expect(mockSpawnSocketPatchDlx).toHaveBeenCalledWith(
        ['/path/to/dir'],
        expect.objectContaining({ stdio: 'inherit' }),
      )
    })

    it('should handle readonly argv array', async () => {
      const readonlyArgv = Object.freeze(['list', '--json']) as readonly string[]

      await cmdPatch.run(readonlyArgv, importMeta, context)

      expect(mockSpawnSocketPatchDlx).toHaveBeenCalledWith(
        ['list', '--json'],
        expect.objectContaining({ stdio: 'inherit' }),
      )
    })

    it('should handle mixed flags and subcommands', async () => {
      await cmdPatch.run(['--json', 'list', '--verbose'], importMeta, context)

      // "list" is a non-flag argument, so hasSubcommand is true.
      expect(mockMeowOrExit).not.toHaveBeenCalled()
      expect(mockSpawnSocketPatchDlx).toHaveBeenCalledWith(
        ['--json', 'list', '--verbose'],
        expect.objectContaining({ stdio: 'inherit' }),
      )
    })
  })
})
