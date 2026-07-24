/**
 * Unit tests for gem wrapper command.
 *
 * Tests the command entry point that wraps gem with Socket Firewall security.
 * The wrapper intercepts gem commands and forwards them to Socket Firewall
 * (sfw) for real-time security scanning.
 *
 * Test Coverage: - Command metadata (description, visibility) - Help text
 * display - Flag filtering (Socket CLI vs gem flags) - Exit code handling with
 * process.exit() - Signal propagation with process.kill()
 */

import EventEmitter from 'node:events'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { setupTestEnvironment } from '../../../helpers/index.mts'
import { cmdGem } from '../../../../src/commands/gem/cmd-gem.mts'

// Mock spawnSfwDlx.
const mockSpawnSfwDlx = vi.hoisted(() => vi.fn())
const mockMeowOrExit = vi.hoisted(() => vi.fn())
const mockFilterFlags = vi.hoisted(() => vi.fn())

vi.mock(import('../../../../src/util/dlx/spawn.mts'), () => ({
  spawnSfwDlx: mockSpawnSfwDlx,
}))

vi.mock(import('../../../../src/util/cli/with-subcommands.mjs'), () => ({
  meowOrExit: mockMeowOrExit,
}))

vi.mock(import('../../../../src/util/process/cmd.mts'), () => ({
  filterFlags: mockFilterFlags,
}))

describe('cmd-gem', () => {
  setupTestEnvironment()

  beforeEach(() => {
    mockFilterFlags.mockReturnValue([])
  })

  describe('command metadata', () => {
    it('should have correct description', () => {
      expect(cmdGem.description).toBe('Run gem with Socket Firewall security')
    })

    it('should not be hidden', () => {
      expect(cmdGem.hidden).toBe(false)
    })

    it('should have a run function', () => {
      expect(typeof cmdGem.run).toBe('function')
    })

    it('renders help text via the meow help callback', async () => {
      mockMeowOrExit.mockImplementation(args => {
        const helpText = args.config.help('socket gem')
        expect(helpText).toContain('socket gem')
        return {
          flags: {},
          help: helpText,
          input: [],
          pkg: {},
          showHelp: vi.fn(),
          showVersion: vi.fn(),
          unknownFlags: [],
        }
      })
      const mockChildProcess = new EventEmitter()
      const mockSpawnPromise = Promise.resolve({
        code: 0,
        signal: undefined,
        stderr: Buffer.from(''),
        stdout: Buffer.from(''),
      })
      mockSpawnPromise.process = mockChildProcess
      mockSpawnSfwDlx.mockResolvedValue({ spawnPromise: mockSpawnPromise })
      mockFilterFlags.mockReturnValue([])
      const runPromise = cmdGem.run(
        [],
        { url: import.meta.url },
        { parentName: 'socket' },
      )
      setImmediate(() => mockChildProcess.emit('exit', 0, undefined))
      await runPromise
      expect(mockMeowOrExit).toHaveBeenCalled()
    })
  })

  describe('run', () => {
    const importMeta = { url: import.meta.url } as ImportMeta
    const context = { parentName: 'socket' }

    it('should call meowOrExit with correct config', async () => {
      const mockChildProcess = new EventEmitter()
      const mockSpawnPromise = Promise.resolve({
        code: 0,
        signal: undefined,
        stderr: Buffer.from(''),
        stdout: Buffer.from(''),
      })
      ;(mockSpawnPromise as unknown).process = mockChildProcess

      mockSpawnSfwDlx.mockResolvedValue({
        spawnPromise: mockSpawnPromise,
      })

      mockFilterFlags.mockReturnValue(['install', 'rails'])

      const runPromise = cmdGem.run(['install', 'rails'], importMeta, context)

      // Simulate successful exit.
      setImmediate(() => {
        mockChildProcess.emit('exit', 0, undefined)
      })

      await runPromise

      expect(mockMeowOrExit).toHaveBeenCalledWith({
        argv: ['install', 'rails'],
        config: expect.objectContaining({
          commandName: 'gem',
          description: 'Run gem with Socket Firewall security',
          hidden: false,
        }),
        importMeta,
        parentName: 'socket',
      })
    })

    describe('flag filtering', () => {
      it('should filter out Socket CLI flags and forward gem flags', async () => {
        const mockChildProcess = new EventEmitter()
        const mockSpawnPromise = Promise.resolve({
          code: 0,
          signal: undefined,
          stderr: Buffer.from(''),
          stdout: Buffer.from(''),
        })
        ;(mockSpawnPromise as unknown).process = mockChildProcess

        mockSpawnSfwDlx.mockResolvedValue({
          spawnPromise: mockSpawnPromise,
        })

        // Filtered args (Socket CLI flags removed).
        mockFilterFlags.mockReturnValue(['install', '--no-document', 'rails'])

        const runPromise = cmdGem.run(
          ['--config', '{}', 'install', '--no-document', 'rails'],
          importMeta,
          context,
        )

        // Simulate successful exit.
        setImmediate(() => {
          mockChildProcess.emit('exit', 0, undefined)
        })

        await runPromise

        expect(mockFilterFlags).toHaveBeenCalled()
        expect(mockSpawnSfwDlx).toHaveBeenCalledWith(
          ['gem', 'install', '--no-document', 'rails'],
          {
            stdio: 'inherit',
          },
        )
      })
    })

    describe('exit handling', () => {
      it('should set default exit code to 1 before child process exits', async () => {
        const mockChildProcess = new EventEmitter()
        const mockSpawnPromise = Promise.resolve({
          code: 0,
          signal: undefined,
          stderr: Buffer.from(''),
          stdout: Buffer.from(''),
        })
        ;(mockSpawnPromise as unknown).process = mockChildProcess

        mockSpawnSfwDlx.mockResolvedValue({
          spawnPromise: mockSpawnPromise,
        })

        mockFilterFlags.mockReturnValue(['install', 'rails'])

        const mockExit = vi
          .spyOn(process, 'exit')
          .mockImplementation((() => {}) as unknown)

        process.exitCode = undefined

        void cmdGem.run(['install', 'rails'], importMeta, context)

        // Check that exit code was set to 1 before child process exits.
        await vi.waitFor(() => {
          expect(process.exitCode).toBe(1)
        })

        // Simulate successful exit.
        mockChildProcess.emit('exit', 0, undefined)

        // Wait for event handler to execute.
        await new Promise(resolve => {
          setImmediate(resolve)
        })

        expect(mockExit).toHaveBeenCalledWith(0)

        mockExit.mockRestore()
      })

      it('should call process.exit with child exit code', async () => {
        const mockChildProcess = new EventEmitter()
        const mockSpawnPromise = Promise.resolve({
          code: 0,
          signal: undefined,
          stderr: Buffer.from(''),
          stdout: Buffer.from(''),
        })
        ;(mockSpawnPromise as unknown).process = mockChildProcess

        mockSpawnSfwDlx.mockResolvedValue({
          spawnPromise: mockSpawnPromise,
        })

        mockFilterFlags.mockReturnValue(['install', 'rails'])

        const mockExit = vi
          .spyOn(process, 'exit')
          .mockImplementation((() => {}) as unknown)

        void cmdGem.run(['install', 'rails'], importMeta, context)

        // Wait for event listeners to be registered.
        await new Promise(resolve => {
          setImmediate(resolve)
        })

        // Simulate exit with code 0.
        mockChildProcess.emit('exit', 0, undefined)

        // Wait for event handler to execute.
        await new Promise(resolve => {
          setImmediate(resolve)
        })

        expect(mockExit).toHaveBeenCalledWith(0)

        mockExit.mockRestore()
      })

      it('should call process.exit with non-zero exit code on failure', async () => {
        const mockChildProcess = new EventEmitter()
        const mockSpawnPromise = Promise.resolve({
          code: 1,
          signal: undefined,
          stderr: Buffer.from(''),
          stdout: Buffer.from(''),
        })
        ;(mockSpawnPromise as unknown).process = mockChildProcess

        mockSpawnSfwDlx.mockResolvedValue({
          spawnPromise: mockSpawnPromise,
        })

        mockFilterFlags.mockReturnValue(['install', 'rails'])

        const mockExit = vi
          .spyOn(process, 'exit')
          .mockImplementation((() => {}) as unknown)

        void cmdGem.run(['install', 'rails'], importMeta, context)

        // Wait for event listeners to be registered.
        await new Promise(resolve => {
          setImmediate(resolve)
        })

        // Simulate exit with non-zero code.
        mockChildProcess.emit('exit', 1, undefined)

        // Wait for event handler to execute.
        await new Promise(resolve => {
          setImmediate(resolve)
        })

        expect(mockExit).toHaveBeenCalledWith(1)

        mockExit.mockRestore()
      })

      it('should call process.kill with signal when child receives signal', async () => {
        const mockChildProcess = new EventEmitter()
        const mockSpawnPromise = Promise.resolve({
          code: undefined,
          signal: 'SIGTERM',
          stderr: Buffer.from(''),
          stdout: Buffer.from(''),
        })
        ;(mockSpawnPromise as unknown).process = mockChildProcess

        mockSpawnSfwDlx.mockResolvedValue({
          spawnPromise: mockSpawnPromise,
        })

        mockFilterFlags.mockReturnValue(['install', 'rails'])

        const mockKill = vi
          .spyOn(process, 'kill')
          .mockImplementation((() => {}) as unknown)

        void cmdGem.run(['install', 'rails'], importMeta, context)

        // Wait for event listeners to be registered.
        await new Promise(resolve => {
          setImmediate(resolve)
        })

        // Simulate exit with signal.
        mockChildProcess.emit('exit', undefined, 'SIGTERM')

        // Wait for event handler to execute.
        await new Promise(resolve => {
          setImmediate(resolve)
        })

        expect(mockKill).toHaveBeenCalledWith(process.pid, 'SIGTERM')

        mockKill.mockRestore()
      })

      it('should propagate SIGINT signal from child process', async () => {
        const mockChildProcess = new EventEmitter()
        const mockSpawnPromise = Promise.resolve({
          code: undefined,
          signal: 'SIGINT',
          stderr: Buffer.from(''),
          stdout: Buffer.from(''),
        })
        ;(mockSpawnPromise as unknown).process = mockChildProcess

        mockSpawnSfwDlx.mockResolvedValue({
          spawnPromise: mockSpawnPromise,
        })

        mockFilterFlags.mockReturnValue(['list'])

        const mockKill = vi
          .spyOn(process, 'kill')
          .mockImplementation((() => {}) as unknown)

        void cmdGem.run(['list'], importMeta, context)

        // Wait for event listeners to be registered.
        await new Promise(resolve => {
          setImmediate(resolve)
        })

        // Simulate SIGINT.
        mockChildProcess.emit('exit', undefined, 'SIGINT')

        // Wait for event handler to execute.
        await new Promise(resolve => {
          setImmediate(resolve)
        })

        expect(mockKill).toHaveBeenCalledWith(process.pid, 'SIGINT')

        mockKill.mockRestore()
      })
    })

    describe('command forwarding', () => {
      it('should forward gem commands to sfw with correct args', async () => {
        const mockChildProcess = new EventEmitter()
        const mockSpawnPromise = Promise.resolve({
          code: 0,
          signal: undefined,
          stderr: Buffer.from(''),
          stdout: Buffer.from(''),
        })
        ;(mockSpawnPromise as unknown).process = mockChildProcess

        mockSpawnSfwDlx.mockResolvedValue({
          spawnPromise: mockSpawnPromise,
        })

        mockFilterFlags.mockReturnValue(['install', 'rails'])

        const mockExit = vi
          .spyOn(process, 'exit')
          .mockImplementation((() => {}) as unknown)

        void cmdGem.run(['install', 'rails'], importMeta, context)

        // Simulate successful exit.
        mockChildProcess.emit('exit', 0, undefined)

        // Wait for event handler to execute.
        await new Promise(resolve => {
          setImmediate(resolve)
        })

        expect(mockSpawnSfwDlx).toHaveBeenCalledWith(
          ['gem', 'install', 'rails'],
          {
            stdio: 'inherit',
          },
        )

        mockExit.mockRestore()
      })

      it('should handle empty arguments', async () => {
        const mockChildProcess = new EventEmitter()
        const mockSpawnPromise = Promise.resolve({
          code: 0,
          signal: undefined,
          stderr: Buffer.from(''),
          stdout: Buffer.from(''),
        })
        ;(mockSpawnPromise as unknown).process = mockChildProcess

        mockSpawnSfwDlx.mockResolvedValue({
          spawnPromise: mockSpawnPromise,
        })

        mockFilterFlags.mockReturnValue([])

        const mockExit = vi
          .spyOn(process, 'exit')
          .mockImplementation((() => {}) as unknown)

        void cmdGem.run([], importMeta, context)

        // Simulate successful exit.
        mockChildProcess.emit('exit', 0, undefined)

        // Wait for event handler to execute.
        await new Promise(resolve => {
          setImmediate(resolve)
        })

        expect(mockSpawnSfwDlx).toHaveBeenCalledWith(['gem'], {
          stdio: 'inherit',
        })

        mockExit.mockRestore()
      })
    })
  })
})
