/* max-file-lines: test — comprehensive test suite for one command/module; splitting would fragment closely related assertions. */
/**
 * Unit tests for cargo wrapper command.
 *
 * Tests the command entry point that wraps cargo with Socket Firewall security.
 * The wrapper intercepts cargo commands and forwards them to Socket Firewall
 * (sfw) for real-time security scanning.
 *
 * Test Coverage: - Command metadata (description, visibility) - Help text
 * display - Flag filtering (Socket CLI vs cargo flags) - Exit code handling
 * with process.exit() - Signal propagation with process.kill()
 */

import EventEmitter from 'node:events'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { cmdCargo } from '../../../../src/commands/cargo/cmd-cargo.mts'
import { setupTestEnvironment } from '../../../helpers/index.mts'

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

describe('cmd-cargo', () => {
  setupTestEnvironment()

  beforeEach(() => {
    mockFilterFlags.mockReturnValue([])
  })

  describe('command metadata', () => {
    it('should have correct description', () => {
      expect(cmdCargo.description).toBe(
        'Run cargo with Socket Firewall security',
      )
    })

    it('should not be hidden', () => {
      expect(cmdCargo.hidden).toBe(false)
    })

    it('should have a run function', () => {
      expect(typeof cmdCargo.run).toBe('function')
    })

    it('renders help text via the meow help callback', async () => {
      mockMeowOrExit.mockImplementation((args: unknown) => {
        // Invoke the help callback so coverage records its lines.
        const helpText = args.config.help('socket cargo')
        expect(helpText).toContain('socket cargo')
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
      // run() will fall through to spawning sfw; mock that to avoid
      // touching the real binary.
      const mockChildProcess = new EventEmitter()
      const mockSpawnPromise = Promise.resolve({
        code: 0,
        signal: undefined,
        stderr: Buffer.from(''),
        stdout: Buffer.from(''),
      })
      ;(mockSpawnPromise as unknown).process = mockChildProcess
      mockSpawnSfwDlx.mockResolvedValue({ spawnPromise: mockSpawnPromise })
      mockFilterFlags.mockReturnValue([])
      const runPromise = cmdCargo.run(
        [],
        { url: import.meta.url } as ImportMeta,
        {
          parentName: 'socket',
        },
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

      mockFilterFlags.mockReturnValue(['install', 'ripgrep'])

      const runPromise = cmdCargo.run(
        ['install', 'ripgrep'],
        importMeta,
        context,
      )

      // Simulate successful exit.
      setImmediate(() => {
        mockChildProcess.emit('exit', 0, undefined)
      })

      await runPromise

      expect(mockMeowOrExit).toHaveBeenCalledWith({
        argv: ['install', 'ripgrep'],
        config: expect.objectContaining({
          commandName: 'cargo',
          description: 'Run cargo with Socket Firewall security',
          hidden: false,
        }),
        importMeta,
        parentName: 'socket',
      })
    })

    describe('flag filtering', () => {
      it('should filter out Socket CLI flags and forward cargo flags', async () => {
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
        mockFilterFlags.mockReturnValue(['build', '--release'])

        const runPromise = cmdCargo.run(
          ['--config', '{}', 'build', '--release'],
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
          ['cargo', 'build', '--release'],
          {
            stdio: 'inherit',
          },
        )
      })
    })

    describe('exit handling', () => {
      it('skips exit/kill when both code and signal are null', async () => {
        const mockChildProcess = new EventEmitter()
        const mockSpawnPromise = Promise.resolve({
          code: undefined,
          signal: undefined,
          stderr: Buffer.from(''),
          stdout: Buffer.from(''),
        })
        ;(mockSpawnPromise as unknown).process = mockChildProcess

        mockSpawnSfwDlx.mockResolvedValue({
          spawnPromise: mockSpawnPromise,
        })

        mockFilterFlags.mockReturnValue(['build'])

        const mockExit = vi
          .spyOn(process, 'exit')
          .mockImplementation((() => {}) as unknown)
        mockExit.mockClear()
        const mockKill = vi
          .spyOn(process, 'kill')
          .mockImplementation((() => {}) as unknown)
        mockKill.mockClear()

        cmdCargo.run(['build'], importMeta, context)

        // Wait for handler registration.
        await new Promise(resolve => {
          setImmediate(resolve)
        })
        const exitCallsBefore = mockExit.mock.calls.length
        const killCallsBefore = mockKill.mock.calls.length

        // Emit exit with both code and signal as null.
        mockChildProcess.emit('exit', undefined, undefined)

        // Wait for event handler.
        await new Promise(resolve => {
          setImmediate(resolve)
        })

        // Neither exit nor kill call count should increase.
        expect(mockExit.mock.calls.length).toBe(exitCallsBefore)
        expect(mockKill.mock.calls.length).toBe(killCallsBefore)

        mockExit.mockRestore()
        mockKill.mockRestore()
      })

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

        mockFilterFlags.mockReturnValue(['build'])

        const mockExit = vi
          .spyOn(process, 'exit')
          .mockImplementation((() => {}) as unknown)

        process.exitCode = undefined

        cmdCargo.run(['build'], importMeta, context)

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

        mockFilterFlags.mockReturnValue(['build'])

        const mockExit = vi
          .spyOn(process, 'exit')
          .mockImplementation((() => {}) as unknown)

        cmdCargo.run(['build'], importMeta, context)

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

        mockFilterFlags.mockReturnValue(['build'])

        const mockExit = vi
          .spyOn(process, 'exit')
          .mockImplementation((() => {}) as unknown)

        cmdCargo.run(['build'], importMeta, context)

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

        mockFilterFlags.mockReturnValue(['build'])

        const mockKill = vi
          .spyOn(process, 'kill')
          .mockImplementation((() => {}) as unknown)

        cmdCargo.run(['build'], importMeta, context)

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

        mockFilterFlags.mockReturnValue(['test'])

        const mockKill = vi
          .spyOn(process, 'kill')
          .mockImplementation((() => {}) as unknown)

        cmdCargo.run(['test'], importMeta, context)

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
      it('should forward cargo commands to sfw with correct args', async () => {
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

        mockFilterFlags.mockReturnValue(['install', 'ripgrep'])

        const mockExit = vi
          .spyOn(process, 'exit')
          .mockImplementation((() => {}) as unknown)

        cmdCargo.run(['install', 'ripgrep'], importMeta, context)

        // Simulate successful exit.
        mockChildProcess.emit('exit', 0, undefined)

        // Wait for event handler to execute.
        await new Promise(resolve => {
          setImmediate(resolve)
        })

        expect(mockSpawnSfwDlx).toHaveBeenCalledWith(
          ['cargo', 'install', 'ripgrep'],
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

        cmdCargo.run([], importMeta, context)

        // Simulate successful exit.
        mockChildProcess.emit('exit', 0, undefined)

        // Wait for event handler to execute.
        await new Promise(resolve => {
          setImmediate(resolve)
        })

        expect(mockSpawnSfwDlx).toHaveBeenCalledWith(['cargo'], {
          stdio: 'inherit',
        })

        mockExit.mockRestore()
      })
    })
  })
})
