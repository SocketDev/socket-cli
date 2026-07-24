/**
 * Unit tests for cargo wrapper command exit code and signal propagation.
 *
 * Covers process.exit() and process.kill() forwarding from the wrapped
 * cargo child process back through Socket Firewall's dlx spawn.
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

  describe('run', () => {
    const importMeta = { url: import.meta.url } as ImportMeta
    const context = { parentName: 'socket' }

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

        void cmdCargo.run(['build'], importMeta, context)

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

        void cmdCargo.run(['build'], importMeta, context)

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

        void cmdCargo.run(['build'], importMeta, context)

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

        void cmdCargo.run(['build'], importMeta, context)

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

        void cmdCargo.run(['build'], importMeta, context)

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

        void cmdCargo.run(['test'], importMeta, context)

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
  })
})
