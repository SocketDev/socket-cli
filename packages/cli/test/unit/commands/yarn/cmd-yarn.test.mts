/**
 * Unit tests for yarn wrapper command.
 *
 * Tests the command entry point that wraps yarn with Socket Firewall security.
 * The wrapper intercepts yarn commands and forwards them to Socket Firewall (sfw)
 * for real-time security scanning.
 *
 * Test Coverage:
 * - Command metadata (description, visibility)
 * - Help text display
 * - Dry-run behavior
 * - Flag filtering (Socket CLI vs yarn flags)
 * - Subprocess spawning and exit handling
 * - Telemetry tracking
 * - Error handling
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

vi.mock('@socketsecurity/lib/logger', () => ({
  getDefaultLogger: () => mockLogger,
}))

// Mock spawnSfwDlx.
const mockSpawnSfwDlx = vi.hoisted(() => vi.fn())

vi.mock('../../../../src/utils/dlx/spawn.mts', () => ({
  spawnSfwDlx: mockSpawnSfwDlx,
}))

// Mock telemetry functions.
const mockTrackSubprocessExit = vi.hoisted(() => vi.fn())
const mockTrackSubprocessStart = vi.hoisted(() => vi.fn())

vi.mock('../../../../src/utils/telemetry/integration.mts', () => ({
  trackSubprocessExit: mockTrackSubprocessExit,
  trackSubprocessStart: mockTrackSubprocessStart,
}))

// Import after mocks.
const { cmdYarn } = await import('../../../../src/commands/yarn/cmd-yarn.mts')
const { YARN } = await import('@socketsecurity/lib/constants/agents')

describe('cmd-yarn', () => {
  interface MockChildProcess extends Partial<EventEmitter> {
    pid: number
  }

  const mockChildProcess: MockChildProcess = {
    on: vi.fn(),
    pid: 12345,
  }

  const createMockSpawnResult = (exitCode = 0, signal?: string) => {
    const result = {
      code: signal ? null : exitCode,
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

  describe('command metadata', () => {
    it('should have correct description', () => {
      expect(cmdYarn.description).toBe('Run yarn with Socket Firewall security')
    })

    it('should be hidden', () => {
      expect(cmdYarn.hidden).toBe(true)
    })
  })

  describe('run', () => {
    const importMeta = { url: 'file:///test/cmd-yarn.mts' }
    const context = { parentName: 'socket' }

    describe('help flag', () => {
      it('should display help text with --help flag', async () => {
        mockSpawnSfwDlx.mockResolvedValue(createMockSpawnResult(0))

        await expect(
          cmdYarn.run(['--help'], importMeta, context),
        ).rejects.toThrow()

        // Help should exit before spawning.
        expect(mockSpawnSfwDlx).not.toHaveBeenCalled()
      })
    })

    describe('dry-run behavior', () => {
      it('should show dry-run output without executing', async () => {
        await cmdYarn.run(['--dry-run'], importMeta, context)

        expect(mockLogger.error).toHaveBeenCalled()
        expect(mockSpawnSfwDlx).not.toHaveBeenCalled()

        // Verify dry-run message.
        const logCalls = mockLogger.error.mock.calls.flat()
        const hasDryRunMessage = logCalls.some(
          call => typeof call === 'string' && call.includes('Would execute'),
        )
        expect(hasDryRunMessage).toBe(true)
      })

      it('should show dry-run output with yarn install command', async () => {
        await cmdYarn.run(
          ['--dry-run', 'install', 'lodash'],
          importMeta,
          context,
        )

        expect(mockLogger.error).toHaveBeenCalled()
        expect(mockSpawnSfwDlx).not.toHaveBeenCalled()

        // Verify dry-run includes arguments.
        const logCalls = mockLogger.error.mock.calls.flat()
        const hasArgs = logCalls.some(
          call =>
            typeof call === 'string' &&
            (call.includes('install') || call.includes('lodash')),
        )
        expect(hasArgs).toBe(true)
      })

      it('should filter Socket flags in dry-run output', async () => {
        await cmdYarn.run(
          ['--dry-run', '--config', '{}', 'install', 'lodash'],
          importMeta,
          context,
        )

        // Should not spawn.
        expect(mockSpawnSfwDlx).not.toHaveBeenCalled()
      })
    })

    describe('flag filtering', () => {
      it('should filter out --dry-run flag when forwarding to sfw', async () => {
        mockSpawnSfwDlx.mockResolvedValue(createMockSpawnResult(0))

        await cmdYarn.run(['install', 'lodash'], importMeta, context)

        // Verify sfw was called with filtered flags.
        expect(mockSpawnSfwDlx).toHaveBeenCalledWith(
          ['yarn', 'install', 'lodash'],
          {
            stdio: 'inherit',
          },
        )
      })

      it('should filter out --config flag when forwarding to sfw', async () => {
        mockSpawnSfwDlx.mockResolvedValue(createMockSpawnResult(0))

        await cmdYarn.run(
          ['--config', '{}', 'install', 'lodash'],
          importMeta,
          context,
        )

        // --config should be filtered out.
        expect(mockSpawnSfwDlx).toHaveBeenCalledWith(
          ['yarn', 'install', 'lodash'],
          {
            stdio: 'inherit',
          },
        )
      })

      it('should filter out multiple Socket CLI flags', async () => {
        mockSpawnSfwDlx.mockResolvedValue(createMockSpawnResult(0))

        await cmdYarn.run(
          ['--config', '{}', '--no-banner', 'install', 'lodash'],
          importMeta,
          context,
        )

        // Both --config and --no-banner should be filtered.
        expect(mockSpawnSfwDlx).toHaveBeenCalledWith(
          ['yarn', 'install', 'lodash'],
          {
            stdio: 'inherit',
          },
        )
      })

      it('should preserve yarn flags while filtering Socket flags', async () => {
        mockSpawnSfwDlx.mockResolvedValue(createMockSpawnResult(0))

        await cmdYarn.run(
          ['--config', '{}', 'install', '--dev', 'lodash'],
          importMeta,
          context,
        )

        // yarn's --dev should be preserved.
        expect(mockSpawnSfwDlx).toHaveBeenCalledWith(
          ['yarn', 'install', '--dev', 'lodash'],
          {
            stdio: 'inherit',
          },
        )
      })

      it('should handle --no-banner flag', async () => {
        mockSpawnSfwDlx.mockResolvedValue(createMockSpawnResult(0))

        await cmdYarn.run(
          ['--no-banner', 'install', 'lodash'],
          importMeta,
          context,
        )

        // --no-banner should be filtered.
        expect(mockSpawnSfwDlx).toHaveBeenCalledWith(
          ['yarn', 'install', 'lodash'],
          {
            stdio: 'inherit',
          },
        )
      })
    })

    describe('command structure', () => {
      it('should forward yarn install command to sfw', async () => {
        mockSpawnSfwDlx.mockResolvedValue(createMockSpawnResult(0))

        await cmdYarn.run(['install', 'lodash'], importMeta, context)

        expect(mockSpawnSfwDlx).toHaveBeenCalledWith(
          ['yarn', 'install', 'lodash'],
          {
            stdio: 'inherit',
          },
        )
      })

      it('should forward yarn add command', async () => {
        mockSpawnSfwDlx.mockResolvedValue(createMockSpawnResult(0))

        await cmdYarn.run(['add', 'lodash'], importMeta, context)

        expect(mockSpawnSfwDlx).toHaveBeenCalledWith(
          ['yarn', 'add', 'lodash'],
          {
            stdio: 'inherit',
          },
        )
      })

      it('should forward yarn install with version specifier', async () => {
        mockSpawnSfwDlx.mockResolvedValue(createMockSpawnResult(0))

        await cmdYarn.run(['add', 'lodash@4.17.21'], importMeta, context)

        expect(mockSpawnSfwDlx).toHaveBeenCalledWith(
          ['yarn', 'add', 'lodash@4.17.21'],
          {
            stdio: 'inherit',
          },
        )
      })

      it('should forward yarn global add command', async () => {
        mockSpawnSfwDlx.mockResolvedValue(createMockSpawnResult(0))

        await cmdYarn.run(['global', 'add', 'cowsay'], importMeta, context)

        expect(mockSpawnSfwDlx).toHaveBeenCalledWith(
          ['yarn', 'global', 'add', 'cowsay'],
          {
            stdio: 'inherit',
          },
        )
      })

      it('should forward yarn remove command', async () => {
        mockSpawnSfwDlx.mockResolvedValue(createMockSpawnResult(0))

        await cmdYarn.run(['remove', 'lodash'], importMeta, context)

        expect(mockSpawnSfwDlx).toHaveBeenCalledWith(
          ['yarn', 'remove', 'lodash'],
          {
            stdio: 'inherit',
          },
        )
      })

      it('should forward yarn upgrade command', async () => {
        mockSpawnSfwDlx.mockResolvedValue(createMockSpawnResult(0))

        await cmdYarn.run(['upgrade', 'lodash'], importMeta, context)

        expect(mockSpawnSfwDlx).toHaveBeenCalledWith(
          ['yarn', 'upgrade', 'lodash'],
          {
            stdio: 'inherit',
          },
        )
      })

      it('should forward yarn with no arguments', async () => {
        mockSpawnSfwDlx.mockResolvedValue(createMockSpawnResult(0))

        await cmdYarn.run([], importMeta, context)

        expect(mockSpawnSfwDlx).toHaveBeenCalledWith(['yarn'], {
          stdio: 'inherit',
        })
      })

      it('should forward yarn add with multiple packages', async () => {
        mockSpawnSfwDlx.mockResolvedValue(createMockSpawnResult(0))

        await cmdYarn.run(
          ['add', 'lodash', 'express', 'react'],
          importMeta,
          context,
        )

        expect(mockSpawnSfwDlx).toHaveBeenCalledWith(
          ['yarn', 'add', 'lodash', 'express', 'react'],
          {
            stdio: 'inherit',
          },
        )
      })
    })

    describe('exit handling', () => {
      it('should set initial exitCode to 1', async () => {
        mockSpawnSfwDlx.mockResolvedValue(createMockSpawnResult(0))

        await cmdYarn.run(['install', 'lodash'], importMeta, context)

        // Should set exitCode to 1 initially (before subprocess completes).
        expect(process.exitCode).toBe(1)
      })

      it('should register exit event handler on child process', async () => {
        mockSpawnSfwDlx.mockResolvedValue(createMockSpawnResult(0))

        await cmdYarn.run(['install', 'lodash'], importMeta, context)

        // Should register 'exit' event handler.
        expect(mockChildProcess.on).toHaveBeenCalledWith(
          'exit',
          expect.any(Function),
        )
      })

      it('should use stdio inherit for process spawning', async () => {
        mockSpawnSfwDlx.mockResolvedValue(createMockSpawnResult(0))

        await cmdYarn.run(['install', 'lodash'], importMeta, context)

        expect(mockSpawnSfwDlx).toHaveBeenCalledWith(
          ['yarn', 'install', 'lodash'],
          {
            stdio: 'inherit',
          },
        )
      })
    })

    describe('telemetry tracking', () => {
      it('should track subprocess start', async () => {
        mockSpawnSfwDlx.mockResolvedValue(createMockSpawnResult(0))

        await cmdYarn.run(['install', 'lodash'], importMeta, context)

        expect(mockTrackSubprocessStart).toHaveBeenCalledWith(YARN)
      })

      it('should track subprocess start before spawning', async () => {
        let trackCalled = false
        mockTrackSubprocessStart.mockImplementation(async () => {
          trackCalled = true
          return Date.now()
        })

        mockSpawnSfwDlx.mockImplementation(async () => {
          expect(trackCalled).toBe(true)
          return createMockSpawnResult(0)
        })

        await cmdYarn.run(['install', 'lodash'], importMeta, context)

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
        mockSpawnSfwDlx.mockResolvedValue(createMockSpawnResult(0))
        mockTrackSubprocessExit.mockResolvedValue(undefined)

        await cmdYarn.run(['install', 'lodash'], importMeta, context)

        // Invoke the exit handler with a numeric code.
        exitHandler(42, null)

        // Wait for telemetry promise to resolve.
        await new Promise(resolve => setTimeout(resolve, 10))

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
        exitHandler(null, 'SIGTERM')

        // Wait for telemetry promise to resolve.
        await new Promise(resolve => setTimeout(resolve, 10))

        expect(mockTrackSubprocessExit).toHaveBeenCalledWith(
          YARN,
          expect.any(Number),
          null,
        )
        expect(mockProcessKill).toHaveBeenCalledWith(process.pid, 'SIGTERM')
      })

      it('should exit even if telemetry fails', async () => {
        mockSpawnSfwDlx.mockResolvedValue(createMockSpawnResult(0))
        mockTrackSubprocessExit.mockRejectedValue(new Error('Telemetry failed'))

        await cmdYarn.run(['install', 'lodash'], importMeta, context)

        // Invoke the exit handler with a numeric code.
        exitHandler(1, null)

        // Wait for telemetry promise to reject and catch handler to run.
        await new Promise(resolve => setTimeout(resolve, 10))

        // Should still exit even though telemetry failed.
        expect(mockProcessExit).toHaveBeenCalledWith(1)
      })

      it('should track subprocess exit with code', async () => {
        mockSpawnSfwDlx.mockResolvedValue(createMockSpawnResult(0))
        const startTime = 12345
        mockTrackSubprocessStart.mockResolvedValue(startTime)
        mockTrackSubprocessExit.mockResolvedValue(undefined)

        await cmdYarn.run(['install', 'lodash'], importMeta, context)

        // Invoke the exit handler.
        exitHandler(0, null)

        // Wait for telemetry promise to resolve.
        await new Promise(resolve => setTimeout(resolve, 10))

        expect(mockTrackSubprocessExit).toHaveBeenCalledWith(YARN, startTime, 0)
      })
    })

    describe('command name constant', () => {
      it('should use YARN constant as command name', async () => {
        const { CMD_NAME } =
          await import('../../../../src/commands/yarn/cmd-yarn.mts')
        expect(CMD_NAME).toBe(YARN)
        expect(CMD_NAME).toBe('yarn')
      })
    })
  })
})
