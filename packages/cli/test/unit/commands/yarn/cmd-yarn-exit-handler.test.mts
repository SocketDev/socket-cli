/**
 * Unit tests for yarn wrapper command exit handler callback.
 *
 * Tests the command entry point that wraps yarn with Socket Firewall security.
 * The wrapper intercepts yarn commands and forwards them to Socket Firewall
 * (sfw) for real-time security scanning.
 *
 * Test Coverage: - Subprocess exit and signal handling - Telemetry tracking on
 * exit.
 */

import { YARN } from '@socketsecurity/lib-stable/constants/agents'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { tolerantSleep } from '../../../../../../test/fleet/_shared/lib/timing.mts'
import { cmdYarn } from '../../../../src/commands/yarn/cmd-yarn.mts'

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

// Mock spawnSfwDlx.
const mockSpawnSfwDlx = vi.hoisted(() => vi.fn())

vi.mock(import('../../../../src/util/dlx/spawn.mts'), () => ({
  spawnSfwDlx: mockSpawnSfwDlx,
}))

// Mock telemetry functions.
const mockTrackSubprocessExit = vi.hoisted(() => vi.fn())
const mockTrackSubprocessStart = vi.hoisted(() => vi.fn())

vi.mock(import('../../../../src/util/telemetry/integration.mts'), () => ({
  trackSubprocessExit: mockTrackSubprocessExit,
  trackSubprocessStart: mockTrackSubprocessStart,
}))

describe('cmd-yarn', () => {
  interface MockChildProcess extends Partial<EventEmitter> {
    pid: number
  }

  const mockChildProcess: MockChildProcess = {
    on: vi.fn(),
    pid: 12_345,
  }

  const createMockSpawnResult = (exitCode = 0, signal?: string | undefined) => {
    const result = {
      code: signal ? undefined : exitCode,
      signal,
      success: exitCode === 0 && !signal,
    }
    const spawnPromise = Object.assign(Promise.resolve(result), {
      process: mockChildProcess,
    })
    return { spawnPromise }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
    mockTrackSubprocessStart.mockResolvedValue(Date.now())
    mockTrackSubprocessExit.mockResolvedValue(undefined)
  })

  describe('run', () => {
    const importMeta = { url: 'file:///test/cmd-yarn.mts' }
    const context = { parentName: 'socket' }

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
        mockSpawnSfwDlx.mockResolvedValue(createMockSpawnResult(0))
        mockTrackSubprocessExit.mockResolvedValue(undefined)

        await cmdYarn.run(['install', 'lodash'], importMeta, context)

        // Invoke the exit handler with a numeric code.
        exitHandler(42, undefined)

        // Wait for telemetry promise to resolve.
        await new Promise(resolve => setTimeout(resolve, tolerantSleep(10)))

        expect(mockTrackSubprocessExit).toHaveBeenCalledWith(
          YARN,
          expect.any(Number),
          42,
        )
        expect(mockProcessExit).toHaveBeenCalledWith(42)
      })

      it('should call process.kill with signal', async () => {
        mockSpawnSfwDlx.mockResolvedValue(createMockSpawnResult(0))
        mockTrackSubprocessExit.mockResolvedValue(undefined)

        await cmdYarn.run(['install', 'lodash'], importMeta, context)

        // Invoke the exit handler with a signal.
        exitHandler(undefined, 'SIGTERM')

        // Wait for telemetry promise to resolve.
        await new Promise(resolve => setTimeout(resolve, tolerantSleep(10)))

        expect(mockTrackSubprocessExit).toHaveBeenCalledWith(
          YARN,
          expect.any(Number),
          undefined,
        )
        expect(mockProcessKill).toHaveBeenCalledWith(process.pid, 'SIGTERM')
      })

      it('should exit even if telemetry fails', async () => {
        mockSpawnSfwDlx.mockResolvedValue(createMockSpawnResult(0))
        mockTrackSubprocessExit.mockRejectedValue(new Error('Telemetry failed'))

        await cmdYarn.run(['install', 'lodash'], importMeta, context)

        // Invoke the exit handler with a numeric code.
        exitHandler(1, undefined)

        // Wait for telemetry promise to reject and catch handler to run.
        await new Promise(resolve => setTimeout(resolve, tolerantSleep(10)))

        // Should still exit even though telemetry failed.
        expect(mockProcessExit).toHaveBeenCalledWith(1)
      })

      it('skips exit/kill when both code and signal are null', async () => {
        mockSpawnSfwDlx.mockResolvedValue(createMockSpawnResult(0))
        mockTrackSubprocessExit.mockResolvedValue(undefined)

        await cmdYarn.run(['install', 'lodash'], importMeta, context)
        exitHandler(undefined, undefined)
        await new Promise(resolve => setTimeout(resolve, tolerantSleep(10)))
        expect(mockProcessExit).not.toHaveBeenCalled()
        expect(mockProcessKill).not.toHaveBeenCalled()
      })

      it('should track subprocess exit with code', async () => {
        mockSpawnSfwDlx.mockResolvedValue(createMockSpawnResult(0))
        const startTime = 12_345
        mockTrackSubprocessStart.mockResolvedValue(startTime)
        mockTrackSubprocessExit.mockResolvedValue(undefined)

        await cmdYarn.run(['install', 'lodash'], importMeta, context)

        // Invoke the exit handler.
        exitHandler(0, undefined)

        // Wait for telemetry promise to resolve.
        await new Promise(resolve => setTimeout(resolve, tolerantSleep(10)))

        expect(mockTrackSubprocessExit).toHaveBeenCalledWith(YARN, startTime, 0)
      })
    })
  })
})
