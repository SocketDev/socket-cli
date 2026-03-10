/**
 * Unit Tests: Socket UV Command
 *
 * Purpose:
 * Tests the uv wrapper command that forwards uv operations to Socket Firewall (sfw).
 * Validates argument forwarding, flag filtering, exit code handling, and signal propagation.
 *
 * Test Coverage:
 * - Command metadata (description, hidden status)
 * - Argument forwarding to sfw via spawnSfwDlx
 * - Socket CLI flag filtering (removes --config, --org, etc.)
 * - Exit code defaults and handling
 * - Signal propagation from child process
 * - Integration with meowOrExit for --help handling
 *
 * Testing Approach:
 * Mocks spawnSfwDlx to simulate child process behavior without actual execution.
 * Uses EventEmitter to simulate process exit events and signal handling.
 * Validates that Socket CLI flags are filtered out before forwarding to sfw.
 *
 * Related Files:
 * - src/commands/uv/cmd-uv.mts - UV wrapper command implementation
 * - src/utils/dlx/spawn.mts - DLX spawn utilities
 * - src/utils/process/cmd.mts - Flag filtering utilities
 */

import EventEmitter from 'node:events'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { setupTestEnvironment } from '../../../helpers/index.mts'

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

const { cmdUv } = await import('../../../../src/commands/uv/cmd-uv.mts')

describe('cmd-uv', () => {
  setupTestEnvironment()

  beforeEach(() => {
    mockFilterFlags.mockReturnValue([])
  })

  describe('command metadata', () => {
    it('should have correct description', () => {
      expect(cmdUv.description).toBe('Run uv with Socket Firewall security')
    })

    it('should not be hidden', () => {
      expect(cmdUv.hidden).toBe(false)
    })

    it('should have a run function', () => {
      expect(typeof cmdUv.run).toBe('function')
    })
  })

  describe('run', () => {
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

      mockFilterFlags.mockReturnValue(['pip', 'install', 'flask'])

      const runPromise = cmdUv.run(
        ['pip', 'install', 'flask'],
        { url: import.meta.url } as ImportMeta,
        { parentName: 'socket' },
      )

      // Simulate successful exit.
      setImmediate(() => {
        mockChildProcess.emit('exit', 0, null)
      })

      await runPromise

      expect(mockMeowOrExit).toHaveBeenCalledWith({
        argv: ['pip', 'install', 'flask'],
        config: expect.objectContaining({
          commandName: 'uv',
          description: 'Run uv with Socket Firewall security',
          hidden: false,
        }),
        importMeta: { url: import.meta.url },
        parentName: 'socket',
      })
    })

    it('should forward filtered arguments to spawnSfwDlx', async () => {
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

      mockFilterFlags.mockReturnValue(['pip', 'sync'])

      const runPromise = cmdUv.run(
        ['pip', 'sync', '--config', 'socket.config.json'],
        { url: import.meta.url } as ImportMeta,
        { parentName: 'socket' },
      )

      // Simulate successful exit.
      setImmediate(() => {
        mockChildProcess.emit('exit', 0, null)
      })

      await runPromise

      expect(mockSpawnSfwDlx).toHaveBeenCalledWith(['uv', 'pip', 'sync'], {
        stdio: 'inherit',
      })
    })

    it('should filter out Socket CLI flags', async () => {
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

      const filteredArgs = ['run', 'script.py']
      mockFilterFlags.mockReturnValue(filteredArgs)

      const runPromise = cmdUv.run(
        ['run', 'script.py', '--org', 'my-org'],
        { url: import.meta.url } as ImportMeta,
        { parentName: 'socket' },
      )

      // Simulate successful exit.
      setImmediate(() => {
        mockChildProcess.emit('exit', 0, null)
      })

      await runPromise

      expect(mockFilterFlags).toHaveBeenCalled()
      expect(mockSpawnSfwDlx).toHaveBeenCalledWith(['uv', ...filteredArgs], {
        stdio: 'inherit',
      })
    })

    it('should set default exit code to 1', async () => {
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

      mockFilterFlags.mockReturnValue(['pip', 'install', 'flask'])

      const mockExit = vi
        .spyOn(process, 'exit')
        .mockImplementation((() => {}) as any)

      process.exitCode = undefined

      cmdUv.run(
        ['pip', 'install', 'flask'],
        { url: import.meta.url } as ImportMeta,
        { parentName: 'socket' },
      )

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

    it('should handle child process exit with code', async () => {
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

      mockFilterFlags.mockReturnValue(['pip', 'install', 'flask'])

      const mockExit = vi
        .spyOn(process, 'exit')
        .mockImplementation((() => {}) as any)

      cmdUv.run(
        ['pip', 'install', 'flask'],
        { url: import.meta.url } as ImportMeta,
        { parentName: 'socket' },
      )

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

    it('should handle child process exit with signal', async () => {
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

      mockFilterFlags.mockReturnValue(['pip', 'install', 'flask'])

      const mockKill = vi
        .spyOn(process, 'kill')
        .mockImplementation((() => {}) as any)

      cmdUv.run(
        ['pip', 'install', 'flask'],
        { url: import.meta.url } as ImportMeta,
        { parentName: 'socket' },
      )

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

      cmdUv.run([], { url: import.meta.url } as ImportMeta, {
        parentName: 'socket',
      })

      // Simulate successful exit.
      mockChildProcess.emit('exit', 0, null)

      // Wait for event handler to execute.
      await new Promise(resolve => {
        setImmediate(resolve)
      })

      expect(mockSpawnSfwDlx).toHaveBeenCalledWith(['uv'], { stdio: 'inherit' })

      mockExit.mockRestore()
    })

    it('should handle context with parentName', async () => {
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

      mockFilterFlags.mockReturnValue(['--version'])

      const mockExit = vi
        .spyOn(process, 'exit')
        .mockImplementation((() => {}) as any)

      cmdUv.run(['--version'], { url: import.meta.url } as ImportMeta, {
        parentName: 'socket',
      })

      // Simulate successful exit.
      mockChildProcess.emit('exit', 0, null)

      // Wait for event handler to execute.
      await new Promise(resolve => {
        setImmediate(resolve)
      })

      expect(mockMeowOrExit).toHaveBeenCalledWith(
        expect.objectContaining({
          parentName: 'socket',
        }),
      )

      mockExit.mockRestore()
    })
  })
})
