/**
 * Unit tests for npm wrapper command — exit handling and telemetry.
 *
 * Tests the command entry point that wraps npm with Socket Firewall security.
 * The wrapper intercepts npm commands and forwards them to Socket Firewall
 * (sfw) for real-time security scanning.
 *
 * Test Coverage: - Subprocess exit handling - Telemetry tracking - Exit
 * handler callback behavior - Command name constant.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { NPM } from '@socketsecurity/lib-stable/constants/agents'

import { cmdNpm } from '../../../../src/commands/npm/cmd-npm.mts'

import type { EventEmitter } from 'node:events'

// Mock the logger.
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

// Mock spawnSfw.
const mockSpawnSfw = vi.hoisted(() => vi.fn())

vi.mock(import('../../../../src/util/dlx/spawn.mts'), () => ({
  spawnSfw: mockSpawnSfw,
}))

// Mock telemetry functions.
const mockTrackSubprocessExit = vi.hoisted(() => vi.fn())
const mockTrackSubprocessStart = vi.hoisted(() => vi.fn())

vi.mock(import('../../../../src/util/telemetry/integration.mts'), () => ({
  trackSubprocessExit: mockTrackSubprocessExit,
  trackSubprocessStart: mockTrackSubprocessStart,
}))

describe('cmd-npm', () => {
  interface MockChildProcess extends Partial<EventEmitter> {
    pid: number
  }

  const mockChildProcess: MockChildProcess = {
    on: vi.fn(),
    pid: 12_345,
  }

  const createMockSpawnResult = (exitCode = 0, signal?: string) => {
    const result = {
      code: signal ? undefined : exitCode,
      signal,
      success: exitCode === 0 && !signal,
    }
    const spawnPromise = Promise.resolve(result)
    Object.assign(spawnPromise, { process: mockChildProcess })
    return { spawnPromise }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
    mockTrackSubprocessStart.mockResolvedValue(Date.now())
    mockTrackSubprocessExit.mockResolvedValue(undefined)
  })

  describe('run', () => {
    const importMeta = { url: 'file:///test/cmd-npm.mts' }
    const context = { parentName: 'socket' }

    describe('exit handling', () => {
      it('should set initial exitCode to 1', async () => {
        mockSpawnSfw.mockResolvedValue(createMockSpawnResult(0))

        await cmdNpm.run(['install', 'lodash'], importMeta, context)

        // Should set exitCode to 1 initially (before subprocess completes).
        expect(process.exitCode).toBe(1)
      })

      it('should register exit event handler on child process', async () => {
        mockSpawnSfw.mockResolvedValue(createMockSpawnResult(0))

        await cmdNpm.run(['install', 'lodash'], importMeta, context)

        // Should register 'exit' event handler.
        expect(mockChildProcess.on).toHaveBeenCalledWith(
          'exit',
          expect.any(Function),
        )
      })

      it('should use stdio inherit for process spawning', async () => {
        mockSpawnSfw.mockResolvedValue(createMockSpawnResult(0))

        await cmdNpm.run(['install', 'lodash'], importMeta, context)

        expect(mockSpawnSfw).toHaveBeenCalledWith(
          ['npm', 'install', 'lodash'],
          {
            stdio: 'inherit',
          },
        )
      })
    })

    describe('telemetry tracking', () => {
      it('should track subprocess start', async () => {
        mockSpawnSfw.mockResolvedValue(createMockSpawnResult(0))

        await cmdNpm.run(['install', 'lodash'], importMeta, context)

        expect(mockTrackSubprocessStart).toHaveBeenCalledWith(NPM)
      })

      it('should track subprocess start before spawning', async () => {
        let trackCalled = false
        mockTrackSubprocessStart.mockImplementation(async () => {
          trackCalled = true
          return Date.now()
        })

        mockSpawnSfw.mockImplementation(async () => {
          expect(trackCalled).toBe(true)
          return createMockSpawnResult(0)
        })

        await cmdNpm.run(['install', 'lodash'], importMeta, context)

        expect(mockTrackSubprocessStart).toHaveBeenCalled()
      })
    })

    describe('exit handler callback', () => {
      let exitHandler: (
        code: number | null,
        signal: NodeJS.Signals | null,
      ) => void
      let mockProcessKill: ReturnType<typeof vi.fn>
      let mockProcessExit: ReturnType<typeof vi.fn>

      beforeEach(() => {
        // Capture the exit handler when it's registered.
        ;(mockChildProcess.on as ReturnType<typeof vi.fn>).mockImplementation(
          (
            event: string,
            handler: (
              code: number | null,
              signal: NodeJS.Signals | null,
            ) => void,
          ) => {
            if (event === 'exit') {
              exitHandler = handler
            }
          },
        )
        // Mock process.kill and process.exit.
        mockProcessKill = vi.fn()
        mockProcessExit = vi.fn()
        vi.stubGlobal('process', {
          ...process,
          kill: mockProcessKill,
          exit: mockProcessExit,
          pid: process.pid,
          exitCode: undefined,
        })
      })

      afterEach(() => {
        vi.unstubAllGlobals()
      })

      it('should call process.exit with numeric exit code', async () => {
        mockSpawnSfw.mockResolvedValue(createMockSpawnResult(0))
        mockTrackSubprocessExit.mockResolvedValue(undefined)

        await cmdNpm.run(['install', 'lodash'], importMeta, context)

        // Invoke the exit handler with a numeric code.
        exitHandler(42, undefined)

        // Wait for telemetry promise to resolve.
        await new Promise(resolve => setTimeout(resolve, 10))

        expect(mockTrackSubprocessExit).toHaveBeenCalledWith(
          NPM,
          expect.any(Number),
          42,
        )
        expect(mockProcessExit).toHaveBeenCalledWith(42)
      })

      it('should call process.kill with signal', async () => {
        mockSpawnSfw.mockResolvedValue(createMockSpawnResult(0))
        mockTrackSubprocessExit.mockResolvedValue(undefined)

        await cmdNpm.run(['install', 'lodash'], importMeta, context)

        // Invoke the exit handler with a signal.
        exitHandler(undefined, 'SIGTERM')

        // Wait for telemetry promise to resolve.
        await new Promise(resolve => setTimeout(resolve, 10))

        expect(mockTrackSubprocessExit).toHaveBeenCalledWith(
          NPM,
          expect.any(Number),
          undefined,
        )
        expect(mockProcessKill).toHaveBeenCalledWith(process.pid, 'SIGTERM')
      })

      it('should exit even if telemetry fails', async () => {
        mockSpawnSfw.mockResolvedValue(createMockSpawnResult(0))
        mockTrackSubprocessExit.mockRejectedValue(new Error('Telemetry failed'))

        await cmdNpm.run(['install', 'lodash'], importMeta, context)

        // Invoke the exit handler with a numeric code.
        exitHandler(1, undefined)

        // Wait for telemetry promise to reject and catch handler to run.
        await new Promise(resolve => setTimeout(resolve, 10))

        // Should still exit even though telemetry failed.
        expect(mockProcessExit).toHaveBeenCalledWith(1)
      })

      it('skips exit/kill when both code and signal are null', async () => {
        mockSpawnSfw.mockResolvedValue(createMockSpawnResult(0))
        mockTrackSubprocessExit.mockResolvedValue(undefined)

        await cmdNpm.run(['install', 'lodash'], importMeta, context)

        // Invoke the exit handler with both null.
        exitHandler(undefined, undefined)

        // Wait for telemetry promise to resolve.
        await new Promise(resolve => setTimeout(resolve, 10))

        expect(mockProcessExit).not.toHaveBeenCalled()
        expect(mockProcessKill).not.toHaveBeenCalled()
      })

      it('should track subprocess exit with code', async () => {
        mockSpawnSfw.mockResolvedValue(createMockSpawnResult(0))
        const startTime = 12_345
        mockTrackSubprocessStart.mockResolvedValue(startTime)
        mockTrackSubprocessExit.mockResolvedValue(undefined)

        await cmdNpm.run(['install', 'lodash'], importMeta, context)

        // Invoke the exit handler.
        exitHandler(0, undefined)

        // Wait for telemetry promise to resolve.
        await new Promise(resolve => setTimeout(resolve, 10))

        expect(mockTrackSubprocessExit).toHaveBeenCalledWith(NPM, startTime, 0)
      })
    })

    describe('command name constant', () => {
      it('should use NPM constant as command name', async () => {
        const { CMD_NAME } =
          await import('../../../../src/commands/npm/cmd-npm.mts')
        expect(CMD_NAME).toBe(NPM)
        expect(CMD_NAME).toBe('npm')
      })
    })
  })
})
