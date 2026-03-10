/**
 * Unit tests for bundler wrapper command.
 *
 * Tests the command entry point that wraps bundler with Socket Firewall security.
 * The wrapper intercepts bundler commands and forwards them to Socket Firewall (sfw)
 * for real-time security scanning.
 *
 * Test Coverage:
 * - Command metadata (description, visibility)
 * - Help text display
 * - Flag filtering (Socket CLI vs bundler flags)
 * - Exit code handling with process.exit()
 * - Signal propagation with process.kill()
 */

import EventEmitter from 'node:events'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { setupTestEnvironment } from '../../../helpers/index.mts'

// Mock spawnSfwDlx.
const mockSpawnSfwDlx = vi.hoisted(() => vi.fn())
const mockMeowOrExit = vi.hoisted(() => vi.fn())
const mockFilterFlags = vi.hoisted(() => vi.fn())

vi.mock('../../../../src/utils/dlx/spawn.mts', () => ({
  spawnSfwDlx: mockSpawnSfwDlx,
}))

vi.mock('../../../../src/utils/cli/with-subcommands.mjs', () => ({
  meowOrExit: mockMeowOrExit,
}))

vi.mock('../../../../src/utils/process/cmd.mts', () => ({
  filterFlags: mockFilterFlags,
}))

// Import after mocks.
const { cmdBundler } =
  await import('../../../../src/commands/bundler/cmd-bundler.mts')

describe('cmd-bundler', () => {
  setupTestEnvironment()

  beforeEach(() => {
    mockFilterFlags.mockReturnValue([])
  })

  describe('command metadata', () => {
    it('should have correct description', () => {
      expect(cmdBundler.description).toBe(
        'Run bundler with Socket Firewall security',
      )
    })

    it('should not be hidden', () => {
      expect(cmdBundler.hidden).toBe(false)
    })

    it('should have a run function', () => {
      expect(typeof cmdBundler.run).toBe('function')
    })
  })

  describe('run', () => {
    const importMeta = { url: import.meta.url } as ImportMeta
    const context = { parentName: 'socket' }

    it('should call meowOrExit with correct config', async () => {
      const mockChildProcess = new EventEmitter()
      const mockSpawnPromise = Promise.resolve({
        code: 0,
        signal: null,
        stderr: Buffer.from(''),
        stdout: Buffer.from(''),
      })
      ;(mockSpawnPromise as any).process = mockChildProcess

      mockSpawnSfwDlx.mockResolvedValue({
        spawnPromise: mockSpawnPromise,
      })

      mockFilterFlags.mockReturnValue(['install'])

      const runPromise = cmdBundler.run(['install'], importMeta, context)

      // Simulate successful exit.
      setImmediate(() => {
        mockChildProcess.emit('exit', 0, null)
      })

      await runPromise

      expect(mockMeowOrExit).toHaveBeenCalledWith({
        argv: ['install'],
        config: expect.objectContaining({
          commandName: 'bundler',
          description: 'Run bundler with Socket Firewall security',
          hidden: false,
        }),
        importMeta,
        parentName: 'socket',
      })
    })

    describe('flag filtering', () => {
      it('should filter out Socket CLI flags and forward bundler flags', async () => {
        const mockChildProcess = new EventEmitter()
        const mockSpawnPromise = Promise.resolve({
          code: 0,
          signal: null,
          stderr: Buffer.from(''),
          stdout: Buffer.from(''),
        })
        ;(mockSpawnPromise as any).process = mockChildProcess

        mockSpawnSfwDlx.mockResolvedValue({
          spawnPromise: mockSpawnPromise,
        })

        // Filtered args (Socket CLI flags removed).
        mockFilterFlags.mockReturnValue(['install', '--jobs', '4'])

        const runPromise = cmdBundler.run(
          ['--config', '{}', 'install', '--jobs', '4'],
          importMeta,
          context,
        )

        // Simulate successful exit.
        setImmediate(() => {
          mockChildProcess.emit('exit', 0, null)
        })

        await runPromise

        expect(mockFilterFlags).toHaveBeenCalled()
        expect(mockSpawnSfwDlx).toHaveBeenCalledWith(
          ['bundler', 'install', '--jobs', '4'],
          { stdio: 'inherit' },
        )
      })
    })

    describe('exit handling', () => {
      it('should set default exit code to 1 before child process exits', async () => {
        const mockChildProcess = new EventEmitter()
        const mockSpawnPromise = Promise.resolve({
          code: 0,
          signal: null,
          stderr: Buffer.from(''),
          stdout: Buffer.from(''),
        })
        ;(mockSpawnPromise as any).process = mockChildProcess

        mockSpawnSfwDlx.mockResolvedValue({
          spawnPromise: mockSpawnPromise,
        })

        mockFilterFlags.mockReturnValue(['install'])

        const mockExit = vi
          .spyOn(process, 'exit')
          .mockImplementation((() => {}) as any)

        process.exitCode = undefined

        cmdBundler.run(['install'], importMeta, context)

        // Check that exit code was set to 1 before child process exits.
        await vi.waitFor(() => {
          expect(process.exitCode).toBe(1)
        })

        // Simulate successful exit.
        mockChildProcess.emit('exit', 0, null)

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
          signal: null,
          stderr: Buffer.from(''),
          stdout: Buffer.from(''),
        })
        ;(mockSpawnPromise as any).process = mockChildProcess

        mockSpawnSfwDlx.mockResolvedValue({
          spawnPromise: mockSpawnPromise,
        })

        mockFilterFlags.mockReturnValue(['install'])

        const mockExit = vi
          .spyOn(process, 'exit')
          .mockImplementation((() => {}) as any)

        cmdBundler.run(['install'], importMeta, context)

        // Wait for event listeners to be registered.
        await new Promise(resolve => {
          setImmediate(resolve)
        })

        // Simulate exit with code 0.
        mockChildProcess.emit('exit', 0, null)

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
          signal: null,
          stderr: Buffer.from(''),
          stdout: Buffer.from(''),
        })
        ;(mockSpawnPromise as any).process = mockChildProcess

        mockSpawnSfwDlx.mockResolvedValue({
          spawnPromise: mockSpawnPromise,
        })

        mockFilterFlags.mockReturnValue(['install'])

        const mockExit = vi
          .spyOn(process, 'exit')
          .mockImplementation((() => {}) as any)

        cmdBundler.run(['install'], importMeta, context)

        // Wait for event listeners to be registered.
        await new Promise(resolve => {
          setImmediate(resolve)
        })

        // Simulate exit with non-zero code.
        mockChildProcess.emit('exit', 1, null)

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
          code: null,
          signal: 'SIGTERM',
          stderr: Buffer.from(''),
          stdout: Buffer.from(''),
        })
        ;(mockSpawnPromise as any).process = mockChildProcess

        mockSpawnSfwDlx.mockResolvedValue({
          spawnPromise: mockSpawnPromise,
        })

        mockFilterFlags.mockReturnValue(['install'])

        const mockKill = vi
          .spyOn(process, 'kill')
          .mockImplementation((() => {}) as any)

        cmdBundler.run(['install'], importMeta, context)

        // Wait for event listeners to be registered.
        await new Promise(resolve => {
          setImmediate(resolve)
        })

        // Simulate exit with signal.
        mockChildProcess.emit('exit', null, 'SIGTERM')

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
          code: null,
          signal: 'SIGINT',
          stderr: Buffer.from(''),
          stdout: Buffer.from(''),
        })
        ;(mockSpawnPromise as any).process = mockChildProcess

        mockSpawnSfwDlx.mockResolvedValue({
          spawnPromise: mockSpawnPromise,
        })

        mockFilterFlags.mockReturnValue(['check'])

        const mockKill = vi
          .spyOn(process, 'kill')
          .mockImplementation((() => {}) as any)

        cmdBundler.run(['check'], importMeta, context)

        // Wait for event listeners to be registered.
        await new Promise(resolve => {
          setImmediate(resolve)
        })

        // Simulate SIGINT.
        mockChildProcess.emit('exit', null, 'SIGINT')

        // Wait for event handler to execute.
        await new Promise(resolve => {
          setImmediate(resolve)
        })

        expect(mockKill).toHaveBeenCalledWith(process.pid, 'SIGINT')

        mockKill.mockRestore()
      })
    })

    describe('command forwarding', () => {
      it('should forward bundler commands to sfw with correct args', async () => {
        const mockChildProcess = new EventEmitter()
        const mockSpawnPromise = Promise.resolve({
          code: 0,
          signal: null,
          stderr: Buffer.from(''),
          stdout: Buffer.from(''),
        })
        ;(mockSpawnPromise as any).process = mockChildProcess

        mockSpawnSfwDlx.mockResolvedValue({
          spawnPromise: mockSpawnPromise,
        })

        mockFilterFlags.mockReturnValue(['install'])

        const mockExit = vi
          .spyOn(process, 'exit')
          .mockImplementation((() => {}) as any)

        cmdBundler.run(['install'], importMeta, context)

        // Simulate successful exit.
        mockChildProcess.emit('exit', 0, null)

        // Wait for event handler to execute.
        await new Promise(resolve => {
          setImmediate(resolve)
        })

        expect(mockSpawnSfwDlx).toHaveBeenCalledWith(['bundler', 'install'], {
          stdio: 'inherit',
        })

        mockExit.mockRestore()
      })

      it('should handle empty arguments', async () => {
        const mockChildProcess = new EventEmitter()
        const mockSpawnPromise = Promise.resolve({
          code: 0,
          signal: null,
          stderr: Buffer.from(''),
          stdout: Buffer.from(''),
        })
        ;(mockSpawnPromise as any).process = mockChildProcess

        mockSpawnSfwDlx.mockResolvedValue({
          spawnPromise: mockSpawnPromise,
        })

        mockFilterFlags.mockReturnValue([])

        const mockExit = vi
          .spyOn(process, 'exit')
          .mockImplementation((() => {}) as any)

        cmdBundler.run([], importMeta, context)

        // Simulate successful exit.
        mockChildProcess.emit('exit', 0, null)

        // Wait for event handler to execute.
        await new Promise(resolve => {
          setImmediate(resolve)
        })

        expect(mockSpawnSfwDlx).toHaveBeenCalledWith(['bundler'], {
          stdio: 'inherit',
        })

        mockExit.mockRestore()
      })
    })
  })
})
