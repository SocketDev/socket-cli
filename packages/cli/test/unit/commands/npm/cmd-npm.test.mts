/**
 * Unit tests for npm wrapper command.
 *
 * Tests the command entry point that wraps npm with Socket Firewall security.
 * The wrapper intercepts npm commands and forwards them to Socket Firewall (sfw)
 * for real-time security scanning.
 *
 * Test Coverage:
 * - Command metadata (description, visibility)
 * - Help text display
 * - Dry-run behavior
 * - Flag filtering (Socket CLI vs npm flags)
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

// Mock spawnSfw.
const mockSpawnSfw = vi.hoisted(() => vi.fn())

vi.mock('../../../../src/utils/dlx/spawn.mts', () => ({
  spawnSfw: mockSpawnSfw,
}))

// Mock telemetry functions.
const mockTrackSubprocessExit = vi.hoisted(() => vi.fn())
const mockTrackSubprocessStart = vi.hoisted(() => vi.fn())

vi.mock('../../../../src/utils/telemetry/integration.mts', () => ({
  trackSubprocessExit: mockTrackSubprocessExit,
  trackSubprocessStart: mockTrackSubprocessStart,
}))

// Import after mocks.
const { cmdNpm } = await import('../../../../src/commands/npm/cmd-npm.mts')
const { NPM } = await import('@socketsecurity/lib/constants/agents')

describe('cmd-npm', () => {
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
      expect(cmdNpm.description).toBe('Run npm with Socket Firewall security')
    })

    it('should not be hidden', () => {
      expect(cmdNpm.hidden).toBe(false)
    })
  })

  describe('run', () => {
    const importMeta = { url: 'file:///test/cmd-npm.mts' }
    const context = { parentName: 'socket' }

    describe('help flag', () => {
      it('should display help text with --help flag', async () => {
        mockSpawnSfw.mockResolvedValue(createMockSpawnResult(0))

        await expect(
          cmdNpm.run(['--help'], importMeta, context),
        ).rejects.toThrow()

        // Help should exit before spawning.
        expect(mockSpawnSfw).not.toHaveBeenCalled()
      })
    })

    describe('dry-run behavior', () => {
      it('should show dry-run output without executing', async () => {
        await cmdNpm.run(['--dry-run'], importMeta, context)

        expect(mockLogger.log).toHaveBeenCalled()
        expect(mockSpawnSfw).not.toHaveBeenCalled()

        // Verify dry-run message.
        const logCalls = mockLogger.log.mock.calls.flat()
        const hasDryRunMessage = logCalls.some(
          call =>
            typeof call === 'string' &&
            call.includes('Would execute npm with Socket security scanning'),
        )
        expect(hasDryRunMessage).toBe(true)
      })

      it('should show dry-run output with npm install command', async () => {
        await cmdNpm.run(
          ['--dry-run', 'install', 'lodash'],
          importMeta,
          context,
        )

        expect(mockLogger.log).toHaveBeenCalled()
        expect(mockSpawnSfw).not.toHaveBeenCalled()

        // Verify dry-run includes arguments.
        const logCalls = mockLogger.log.mock.calls.flat()
        const hasArgs = logCalls.some(
          call =>
            typeof call === 'string' &&
            (call.includes('install') || call.includes('lodash')),
        )
        expect(hasArgs).toBe(true)
      })

      it('should filter Socket flags in dry-run output', async () => {
        await cmdNpm.run(
          ['--dry-run', '--config', '{}', 'install', 'lodash'],
          importMeta,
          context,
        )

        // Should not spawn.
        expect(mockSpawnSfw).not.toHaveBeenCalled()
      })
    })

    describe('flag filtering', () => {
      it('should filter out --dry-run flag when forwarding to sfw', async () => {
        mockSpawnSfw.mockResolvedValue(createMockSpawnResult(0))

        await cmdNpm.run(['install', 'lodash'], importMeta, context)

        // Verify sfw was called with filtered flags.
        expect(mockSpawnSfw).toHaveBeenCalledWith(
          ['npm', 'install', 'lodash'],
          {
            stdio: 'inherit',
          },
        )
      })

      it('should filter out --config flag when forwarding to sfw', async () => {
        mockSpawnSfw.mockResolvedValue(createMockSpawnResult(0))

        await cmdNpm.run(
          ['--config', '{}', 'install', 'lodash'],
          importMeta,
          context,
        )

        // --config should be filtered out.
        expect(mockSpawnSfw).toHaveBeenCalledWith(
          ['npm', 'install', 'lodash'],
          {
            stdio: 'inherit',
          },
        )
      })

      it('should filter out multiple Socket CLI flags', async () => {
        mockSpawnSfw.mockResolvedValue(createMockSpawnResult(0))

        await cmdNpm.run(
          ['--config', '{}', '--no-banner', 'install', 'lodash'],
          importMeta,
          context,
        )

        // Both --config and --no-banner should be filtered.
        expect(mockSpawnSfw).toHaveBeenCalledWith(
          ['npm', 'install', 'lodash'],
          {
            stdio: 'inherit',
          },
        )
      })

      it('should preserve npm flags while filtering Socket flags', async () => {
        mockSpawnSfw.mockResolvedValue(createMockSpawnResult(0))

        await cmdNpm.run(
          ['--config', '{}', 'install', '--save-dev', 'lodash'],
          importMeta,
          context,
        )

        // npm's --save-dev should be preserved.
        expect(mockSpawnSfw).toHaveBeenCalledWith(
          ['npm', 'install', '--save-dev', 'lodash'],
          {
            stdio: 'inherit',
          },
        )
      })

      it('should handle --no-banner flag', async () => {
        mockSpawnSfw.mockResolvedValue(createMockSpawnResult(0))

        await cmdNpm.run(
          ['--no-banner', 'install', 'lodash'],
          importMeta,
          context,
        )

        // --no-banner should be filtered.
        expect(mockSpawnSfw).toHaveBeenCalledWith(
          ['npm', 'install', 'lodash'],
          {
            stdio: 'inherit',
          },
        )
      })
    })

    describe('command structure', () => {
      it('should forward npm install command to sfw', async () => {
        mockSpawnSfw.mockResolvedValue(createMockSpawnResult(0))

        await cmdNpm.run(['install', 'lodash'], importMeta, context)

        expect(mockSpawnSfw).toHaveBeenCalledWith(
          ['npm', 'install', 'lodash'],
          {
            stdio: 'inherit',
          },
        )
      })

      it('should forward npm install with version specifier', async () => {
        mockSpawnSfw.mockResolvedValue(createMockSpawnResult(0))

        await cmdNpm.run(['install', 'lodash@4.17.21'], importMeta, context)

        expect(mockSpawnSfw).toHaveBeenCalledWith(
          ['npm', 'install', 'lodash@4.17.21'],
          {
            stdio: 'inherit',
          },
        )
      })

      it('should forward npm install with global flag', async () => {
        mockSpawnSfw.mockResolvedValue(createMockSpawnResult(0))

        await cmdNpm.run(['install', '-g', 'cowsay'], importMeta, context)

        expect(mockSpawnSfw).toHaveBeenCalledWith(
          ['npm', 'install', '-g', 'cowsay'],
          {
            stdio: 'inherit',
          },
        )
      })

      it('should forward npm exec command', async () => {
        mockSpawnSfw.mockResolvedValue(createMockSpawnResult(0))

        await cmdNpm.run(['exec', 'cowsay', 'hello'], importMeta, context)

        expect(mockSpawnSfw).toHaveBeenCalledWith(
          ['npm', 'exec', 'cowsay', 'hello'],
          {
            stdio: 'inherit',
          },
        )
      })

      it('should forward npm update command', async () => {
        mockSpawnSfw.mockResolvedValue(createMockSpawnResult(0))

        await cmdNpm.run(['update', 'lodash'], importMeta, context)

        expect(mockSpawnSfw).toHaveBeenCalledWith(['npm', 'update', 'lodash'], {
          stdio: 'inherit',
        })
      })

      it('should forward npm with no arguments', async () => {
        mockSpawnSfw.mockResolvedValue(createMockSpawnResult(0))

        await cmdNpm.run([], importMeta, context)

        expect(mockSpawnSfw).toHaveBeenCalledWith(['npm'], {
          stdio: 'inherit',
        })
      })

      it('should forward npm install with multiple packages', async () => {
        mockSpawnSfw.mockResolvedValue(createMockSpawnResult(0))

        await cmdNpm.run(
          ['install', 'lodash', 'express', 'react'],
          importMeta,
          context,
        )

        expect(mockSpawnSfw).toHaveBeenCalledWith(
          ['npm', 'install', 'lodash', 'express', 'react'],
          {
            stdio: 'inherit',
          },
        )
      })
    })

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
        exitHandler(42, null)

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
        exitHandler(null, 'SIGTERM')

        // Wait for telemetry promise to resolve.
        await new Promise(resolve => setTimeout(resolve, 10))

        expect(mockTrackSubprocessExit).toHaveBeenCalledWith(
          NPM,
          expect.any(Number),
          null,
        )
        expect(mockProcessKill).toHaveBeenCalledWith(process.pid, 'SIGTERM')
      })

      it('should exit even if telemetry fails', async () => {
        mockSpawnSfw.mockResolvedValue(createMockSpawnResult(0))
        mockTrackSubprocessExit.mockRejectedValue(new Error('Telemetry failed'))

        await cmdNpm.run(['install', 'lodash'], importMeta, context)

        // Invoke the exit handler with a numeric code.
        exitHandler(1, null)

        // Wait for telemetry promise to reject and catch handler to run.
        await new Promise(resolve => setTimeout(resolve, 10))

        // Should still exit even though telemetry failed.
        expect(mockProcessExit).toHaveBeenCalledWith(1)
      })

      it('should track subprocess exit with code', async () => {
        mockSpawnSfw.mockResolvedValue(createMockSpawnResult(0))
        const startTime = 12345
        mockTrackSubprocessStart.mockResolvedValue(startTime)
        mockTrackSubprocessExit.mockResolvedValue(undefined)

        await cmdNpm.run(['install', 'lodash'], importMeta, context)

        // Invoke the exit handler.
        exitHandler(0, null)

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
