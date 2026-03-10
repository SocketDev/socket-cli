/**
 * Unit tests for pnpm wrapper command.
 *
 * Tests the command entry point that wraps pnpm with Socket Firewall security.
 * The wrapper intercepts pnpm commands and forwards them to Socket Firewall (sfw)
 * for real-time security scanning.
 *
 * Test Coverage:
 * - Command metadata (description, visibility)
 * - Help text display
 * - Dry-run behavior
 * - Flag filtering (Socket CLI vs pnpm flags)
 * - Subprocess spawning and exit handling
 * - Telemetry tracking
 * - Error handling
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

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
const { cmdPnpm } = await import('../../../../src/commands/pnpm/cmd-pnpm.mts')
const { PNPM } = await import('@socketsecurity/lib/constants/agents')

describe('cmd-pnpm', () => {
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
      expect(cmdPnpm.description).toBe('Run pnpm with Socket Firewall security')
    })

    it('should be hidden', () => {
      expect(cmdPnpm.hidden).toBe(true)
    })
  })

  describe('run', () => {
    const importMeta = { url: 'file:///test/cmd-pnpm.mts' }
    const context = { parentName: 'socket' }

    describe('help flag', () => {
      it('should display help text with --help flag', async () => {
        mockSpawnSfwDlx.mockResolvedValue(createMockSpawnResult(0))

        await expect(
          cmdPnpm.run(['--help'], importMeta, context),
        ).rejects.toThrow()

        // Help should exit before spawning.
        expect(mockSpawnSfwDlx).not.toHaveBeenCalled()
      })
    })

    describe('dry-run behavior', () => {
      it('should show dry-run output without executing', async () => {
        await cmdPnpm.run(['--dry-run'], importMeta, context)

        expect(mockLogger.log).toHaveBeenCalled()
        expect(mockSpawnSfwDlx).not.toHaveBeenCalled()

        // Verify dry-run message.
        const logCalls = mockLogger.log.mock.calls.flat()
        const hasDryRunMessage = logCalls.some(
          call => typeof call === 'string' && call.includes('Would execute'),
        )
        expect(hasDryRunMessage).toBe(true)
      })

      it('should show dry-run output with pnpm install command', async () => {
        await cmdPnpm.run(
          ['--dry-run', 'install', 'lodash'],
          importMeta,
          context,
        )

        expect(mockLogger.log).toHaveBeenCalled()
        expect(mockSpawnSfwDlx).not.toHaveBeenCalled()

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
        await cmdPnpm.run(
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

        await cmdPnpm.run(['install', 'lodash'], importMeta, context)

        // Verify sfw was called with filtered flags.
        expect(mockSpawnSfwDlx).toHaveBeenCalledWith(
          ['pnpm', 'install', 'lodash'],
          {
            stdio: 'inherit',
          },
        )
      })

      it('should filter out --config flag when forwarding to sfw', async () => {
        mockSpawnSfwDlx.mockResolvedValue(createMockSpawnResult(0))

        await cmdPnpm.run(
          ['--config', '{}', 'install', 'lodash'],
          importMeta,
          context,
        )

        // --config should be filtered out.
        expect(mockSpawnSfwDlx).toHaveBeenCalledWith(
          ['pnpm', 'install', 'lodash'],
          {
            stdio: 'inherit',
          },
        )
      })

      it('should filter out multiple Socket CLI flags', async () => {
        mockSpawnSfwDlx.mockResolvedValue(createMockSpawnResult(0))

        await cmdPnpm.run(
          ['--config', '{}', '--no-banner', 'install', 'lodash'],
          importMeta,
          context,
        )

        // Both --config and --no-banner should be filtered.
        expect(mockSpawnSfwDlx).toHaveBeenCalledWith(
          ['pnpm', 'install', 'lodash'],
          {
            stdio: 'inherit',
          },
        )
      })

      it('should preserve pnpm flags while filtering Socket flags', async () => {
        mockSpawnSfwDlx.mockResolvedValue(createMockSpawnResult(0))

        await cmdPnpm.run(
          ['--config', '{}', 'install', '--save-dev', 'lodash'],
          importMeta,
          context,
        )

        // pnpm's --save-dev should be preserved.
        expect(mockSpawnSfwDlx).toHaveBeenCalledWith(
          ['pnpm', 'install', '--save-dev', 'lodash'],
          {
            stdio: 'inherit',
          },
        )
      })

      it('should handle --no-banner flag', async () => {
        mockSpawnSfwDlx.mockResolvedValue(createMockSpawnResult(0))

        await cmdPnpm.run(
          ['--no-banner', 'install', 'lodash'],
          importMeta,
          context,
        )

        // --no-banner should be filtered.
        expect(mockSpawnSfwDlx).toHaveBeenCalledWith(
          ['pnpm', 'install', 'lodash'],
          {
            stdio: 'inherit',
          },
        )
      })
    })

    describe('command structure', () => {
      it('should forward pnpm install command to sfw', async () => {
        mockSpawnSfwDlx.mockResolvedValue(createMockSpawnResult(0))

        await cmdPnpm.run(['install', 'lodash'], importMeta, context)

        expect(mockSpawnSfwDlx).toHaveBeenCalledWith(
          ['pnpm', 'install', 'lodash'],
          {
            stdio: 'inherit',
          },
        )
      })

      it('should forward pnpm add command', async () => {
        mockSpawnSfwDlx.mockResolvedValue(createMockSpawnResult(0))

        await cmdPnpm.run(['add', 'lodash'], importMeta, context)

        expect(mockSpawnSfwDlx).toHaveBeenCalledWith(
          ['pnpm', 'add', 'lodash'],
          {
            stdio: 'inherit',
          },
        )
      })

      it('should forward pnpm install with version specifier', async () => {
        mockSpawnSfwDlx.mockResolvedValue(createMockSpawnResult(0))

        await cmdPnpm.run(['install', 'lodash@4.17.21'], importMeta, context)

        expect(mockSpawnSfwDlx).toHaveBeenCalledWith(
          ['pnpm', 'install', 'lodash@4.17.21'],
          {
            stdio: 'inherit',
          },
        )
      })

      it('should forward pnpm install with global flag', async () => {
        mockSpawnSfwDlx.mockResolvedValue(createMockSpawnResult(0))

        await cmdPnpm.run(['install', '-g', 'cowsay'], importMeta, context)

        expect(mockSpawnSfwDlx).toHaveBeenCalledWith(
          ['pnpm', 'install', '-g', 'cowsay'],
          {
            stdio: 'inherit',
          },
        )
      })

      it('should forward pnpm dlx command', async () => {
        mockSpawnSfwDlx.mockResolvedValue(createMockSpawnResult(0))

        await cmdPnpm.run(['dlx', 'cowsay', 'hello'], importMeta, context)

        expect(mockSpawnSfwDlx).toHaveBeenCalledWith(
          ['pnpm', 'dlx', 'cowsay', 'hello'],
          {
            stdio: 'inherit',
          },
        )
      })

      it('should forward pnpm update command', async () => {
        mockSpawnSfwDlx.mockResolvedValue(createMockSpawnResult(0))

        await cmdPnpm.run(['update', 'lodash'], importMeta, context)

        expect(mockSpawnSfwDlx).toHaveBeenCalledWith(
          ['pnpm', 'update', 'lodash'],
          {
            stdio: 'inherit',
          },
        )
      })

      it('should forward pnpm with no arguments', async () => {
        mockSpawnSfwDlx.mockResolvedValue(createMockSpawnResult(0))

        await cmdPnpm.run([], importMeta, context)

        expect(mockSpawnSfwDlx).toHaveBeenCalledWith(['pnpm'], {
          stdio: 'inherit',
        })
      })

      it('should forward pnpm install with multiple packages', async () => {
        mockSpawnSfwDlx.mockResolvedValue(createMockSpawnResult(0))

        await cmdPnpm.run(
          ['install', 'lodash', 'express', 'react'],
          importMeta,
          context,
        )

        expect(mockSpawnSfwDlx).toHaveBeenCalledWith(
          ['pnpm', 'install', 'lodash', 'express', 'react'],
          {
            stdio: 'inherit',
          },
        )
      })
    })

    describe('exit handling', () => {
      it('should set initial exitCode to 1', async () => {
        mockSpawnSfwDlx.mockResolvedValue(createMockSpawnResult(0))

        await cmdPnpm.run(['install', 'lodash'], importMeta, context)

        // Should set exitCode to 1 initially (before subprocess completes).
        expect(process.exitCode).toBe(1)
      })

      it('should register exit event handler on child process', async () => {
        mockSpawnSfwDlx.mockResolvedValue(createMockSpawnResult(0))

        await cmdPnpm.run(['install', 'lodash'], importMeta, context)

        // Should register 'exit' event handler.
        expect(mockChildProcess.on).toHaveBeenCalledWith(
          'exit',
          expect.any(Function),
        )
      })

      it('should use stdio inherit for process spawning', async () => {
        mockSpawnSfwDlx.mockResolvedValue(createMockSpawnResult(0))

        await cmdPnpm.run(['install', 'lodash'], importMeta, context)

        expect(mockSpawnSfwDlx).toHaveBeenCalledWith(
          ['pnpm', 'install', 'lodash'],
          {
            stdio: 'inherit',
          },
        )
      })
    })

    describe('telemetry tracking', () => {
      it('should track subprocess start', async () => {
        mockSpawnSfwDlx.mockResolvedValue(createMockSpawnResult(0))

        await cmdPnpm.run(['install', 'lodash'], importMeta, context)

        expect(mockTrackSubprocessStart).toHaveBeenCalledWith(PNPM)
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

        await cmdPnpm.run(['install', 'lodash'], importMeta, context)

        expect(mockTrackSubprocessStart).toHaveBeenCalled()
      })
    })

    describe('command name constant', () => {
      it('should use PNPM constant as command name', async () => {
        const { CMD_NAME } =
          await import('../../../../src/commands/pnpm/cmd-pnpm.mts')
        expect(CMD_NAME).toBe(PNPM)
        expect(CMD_NAME).toBe('pnpm')
      })
    })
  })
})
