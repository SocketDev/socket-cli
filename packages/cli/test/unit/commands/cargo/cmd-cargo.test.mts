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

        void cmdCargo.run(['install', 'ripgrep'], importMeta, context)

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

        void cmdCargo.run([], importMeta, context)

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
