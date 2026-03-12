/**
 * Unit tests for raw-npm command.
 *
 * Tests the command that runs npm without the Socket wrapper.
 *
 * Test Coverage:
 * - Command metadata (description, hidden flag)
 * - --dry-run flag support
 * - npm binary path resolution
 * - Argument passing to npm
 * - Process spawning configuration
 * - Exit code handling
 * - Signal handling
 *
 * Testing Approach:
 * - Mock logger to capture output
 * - Mock meowOrExit to control flag values
 * - Mock spawn from @socketsecurity/lib/spawn
 * - Mock getNpmBinPath to return controlled path
 * - Mock outputDryRunExecute for dry-run testing
 * - Verify spawn configuration (shell, stdio, etc.)
 *
 * Related Files:
 * - src/commands/raw-npm/cmd-raw-npm.mts - Implementation
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the logger.
const mockLogger = vi.hoisted(() => ({
  error: vi.fn(),
  fail: vi.fn(),
  info: vi.fn(),
  log: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
}))

vi.mock('@socketsecurity/lib/logger', async importOriginal => {
  const actual =
    await importOriginal<typeof import('@socketsecurity/lib/logger')>()
  return {
    ...actual,
    getDefaultLogger: () => mockLogger,
  }
})

// Mock spawn.
const mockSpawn = vi.hoisted(() => {
  const mockProcess = {
    on: vi.fn(),
    kill: vi.fn(),
    pid: 12345,
    stdin: null,
    stdout: null,
    stderr: null,
  }
  return vi.fn(() => {
    return Object.assign(Promise.resolve({ exitCode: 0 }), {
      process: mockProcess,
    })
  })
})

vi.mock('@socketsecurity/lib/spawn', () => ({
  spawn: mockSpawn,
}))

// Mock WIN32 constant.
const mockWIN32 = vi.hoisted(() => false)

vi.mock('@socketsecurity/lib/constants/platform', () => ({
  get WIN32() {
    return mockWIN32
  },
}))

// Mock npm path utilities.
const mockGetNpmBinPath = vi.hoisted(() => vi.fn(() => '/usr/bin/npm'))

vi.mock('../../../../src/utils/npm/paths.mts', () => ({
  getNpmBinPath: mockGetNpmBinPath,
}))

// Mock dry-run output.
const mockOutputDryRunExecute = vi.hoisted(() => vi.fn())

vi.mock('../../../../src/utils/dry-run/output.mts', () => ({
  outputDryRunExecute: mockOutputDryRunExecute,
}))

// Mock meowOrExit to prevent actual CLI parsing.
const mockMeowOrExit = vi.hoisted(() =>
  vi.fn((options: { argv: string[] | readonly string[] }) => {
    const argv = options.argv
    const flags: Record<string, unknown> = {}

    // Parse flags from argv.
    if (argv.includes('--dry-run')) {
      flags['dryRun'] = true
    }

    return {
      flags,
      help: '',
      input: [],
      pkg: {},
    }
  }),
)

vi.mock(
  '../../../../src/utils/cli/with-subcommands.mjs',
  async importOriginal => {
    const actual =
      await importOriginal<
        typeof import('../../../../src/utils/cli/with-subcommands.mjs')
      >()
    return {
      ...actual,
      meowOrExit: mockMeowOrExit,
    }
  },
)

// Import after mocks.
const { CMD_NAME, cmdRawNpm } =
  await import('../../../../src/commands/raw-npm/cmd-raw-npm.mts')

describe('cmd-raw-npm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
    mockGetNpmBinPath.mockReturnValue('/usr/bin/npm')
  })

  describe('command metadata', () => {
    it('should export CMD_NAME as raw-npm', () => {
      expect(CMD_NAME).toBe('raw-npm')
    })

    it('should have correct description', () => {
      expect(cmdRawNpm.description).toBe('Run npm without the Socket wrapper')
    })

    it('should not be hidden', () => {
      expect(cmdRawNpm.hidden).toBe(false)
    })
  })

  describe('run', () => {
    const importMeta = { url: 'file:///test/cmd-raw-npm.mts' }
    const context = { parentName: 'socket' }

    describe('--dry-run flag', () => {
      it('should show preview without spawning npm', async () => {
        await cmdRawNpm.run(
          ['install', 'cowsay', '--dry-run'],
          importMeta,
          context,
        )

        expect(mockOutputDryRunExecute).toHaveBeenCalledWith(
          '/usr/bin/npm',
          ['install', 'cowsay', '--dry-run'],
          'raw npm command',
        )
        expect(mockSpawn).not.toHaveBeenCalled()
      })

      it('should use npm path from getNpmBinPath in dry-run', async () => {
        mockGetNpmBinPath.mockReturnValue('/custom/path/to/npm')

        await cmdRawNpm.run(['install', '--dry-run'], importMeta, context)

        expect(mockOutputDryRunExecute).toHaveBeenCalledWith(
          '/custom/path/to/npm',
          expect.any(Array),
          'raw npm command',
        )
      })

      it('should pass all arguments to dry-run output', async () => {
        await cmdRawNpm.run(
          ['install', '-g', 'cowsay', '--dry-run'],
          importMeta,
          context,
        )

        expect(mockOutputDryRunExecute).toHaveBeenCalledWith(
          expect.any(String),
          ['install', '-g', 'cowsay', '--dry-run'],
          'raw npm command',
        )
      })
    })

    describe('npm execution', () => {
      it('should spawn npm with correct path', async () => {
        mockGetNpmBinPath.mockReturnValue('/usr/local/bin/npm')

        await cmdRawNpm.run(['install', 'cowsay'], importMeta, context)

        expect(mockSpawn).toHaveBeenCalledWith(
          '/usr/local/bin/npm',
          ['install', 'cowsay'],
          expect.objectContaining({
            shell: false,
            stdio: 'inherit',
          }),
        )
      })

      it('should pass arguments to npm', async () => {
        await cmdRawNpm.run(['install', '-g', 'cowsay'], importMeta, context)

        expect(mockSpawn).toHaveBeenCalledWith(
          expect.any(String),
          ['install', '-g', 'cowsay'],
          expect.any(Object),
        )
      })

      it('should use stdio inherit mode', async () => {
        await cmdRawNpm.run(['install'], importMeta, context)

        expect(mockSpawn).toHaveBeenCalledWith(
          expect.any(String),
          expect.any(Array),
          expect.objectContaining({
            stdio: 'inherit',
          }),
        )
      })

      it('should set shell to false on non-Windows', async () => {
        await cmdRawNpm.run(['install'], importMeta, context)

        expect(mockSpawn).toHaveBeenCalledWith(
          expect.any(String),
          expect.any(Array),
          expect.objectContaining({
            shell: false,
          }),
        )
      })

      it('should set initial exit code to 1', async () => {
        await cmdRawNpm.run(['install'], importMeta, context)

        expect(process.exitCode).toBe(1)
      })
    })

    describe('process event handling', () => {
      it('should register exit event handler', async () => {
        const mockProcess = {
          on: vi.fn(),
          kill: vi.fn(),
          pid: 12345,
          stdin: null,
          stdout: null,
          stderr: null,
        }

        mockSpawn.mockReturnValue(
          Object.assign(Promise.resolve({ exitCode: 0 }), {
            process: mockProcess,
          }),
        )

        await cmdRawNpm.run(['install'], importMeta, context)

        expect(mockProcess.on).toHaveBeenCalledWith(
          'exit',
          expect.any(Function),
        )
      })
    })

    describe('exit handler callback', () => {
      let exitHandler: (
        code: number | null,
        signal: NodeJS.Signals | null,
      ) => void
      let mockProcessKill: ReturnType<typeof vi.fn>
      let mockProcessExit: ReturnType<typeof vi.fn>
      let mockProcess: {
        on: ReturnType<typeof vi.fn>
        kill: ReturnType<typeof vi.fn>
        pid: number
        stdin: null
        stdout: null
        stderr: null
      }

      beforeEach(() => {
        mockProcess = {
          on: vi.fn(),
          kill: vi.fn(),
          pid: 12345,
          stdin: null,
          stdout: null,
          stderr: null,
        }

        // Capture the exit handler when it's registered.
        mockProcess.on.mockImplementation(
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

        mockSpawn.mockReturnValue(
          Object.assign(Promise.resolve({ exitCode: 0 }), {
            process: mockProcess,
          }),
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
        await cmdRawNpm.run(['install'], importMeta, context)

        // Invoke the exit handler with a numeric code.
        exitHandler(42, null)

        expect(mockProcessExit).toHaveBeenCalledWith(42)
      })

      it('should call process.kill with signal', async () => {
        await cmdRawNpm.run(['install'], importMeta, context)

        // Invoke the exit handler with a signal.
        exitHandler(null, 'SIGTERM')

        expect(mockProcessKill).toHaveBeenCalledWith(process.pid, 'SIGTERM')
      })

      it('should not call process.exit when code is null and no signal', async () => {
        await cmdRawNpm.run(['install'], importMeta, context)

        // Invoke the exit handler with null code and no signal.
        exitHandler(null, null)

        expect(mockProcessExit).not.toHaveBeenCalled()
        expect(mockProcessKill).not.toHaveBeenCalled()
      })
    })

    describe('argument handling', () => {
      it('should handle empty arguments', async () => {
        await cmdRawNpm.run([], importMeta, context)

        expect(mockSpawn).toHaveBeenCalledWith(
          expect.any(String),
          [],
          expect.any(Object),
        )
      })

      it('should handle single argument', async () => {
        await cmdRawNpm.run(['version'], importMeta, context)

        expect(mockSpawn).toHaveBeenCalledWith(
          expect.any(String),
          ['version'],
          expect.any(Object),
        )
      })

      it('should handle multiple arguments', async () => {
        await cmdRawNpm.run(
          ['install', 'lodash', 'express', '--save'],
          importMeta,
          context,
        )

        expect(mockSpawn).toHaveBeenCalledWith(
          expect.any(String),
          ['install', 'lodash', 'express', '--save'],
          expect.any(Object),
        )
      })

      it('should handle arguments with special characters', async () => {
        await cmdRawNpm.run(
          ['install', '@types/node', '--save-dev'],
          importMeta,
          context,
        )

        expect(mockSpawn).toHaveBeenCalledWith(
          expect.any(String),
          ['install', '@types/node', '--save-dev'],
          expect.any(Object),
        )
      })
    })

    describe('readonly arguments', () => {
      it('should handle readonly argv array', async () => {
        const readonlyArgv = Object.freeze([
          'install',
          'cowsay',
        ]) as readonly string[]

        await cmdRawNpm.run(readonlyArgv, importMeta, context)

        expect(mockSpawn).toHaveBeenCalledWith(
          expect.any(String),
          ['install', 'cowsay'],
          expect.any(Object),
        )
      })

      it('should handle readonly argv in dry-run', async () => {
        const readonlyArgv = Object.freeze([
          'install',
          '--dry-run',
        ]) as readonly string[]

        await cmdRawNpm.run(readonlyArgv, importMeta, context)

        expect(mockOutputDryRunExecute).toHaveBeenCalled()
      })
    })

    describe('edge cases', () => {
      it('should handle npm path with spaces', async () => {
        mockGetNpmBinPath.mockReturnValue('/Program Files/npm/npm.exe')

        await cmdRawNpm.run(['install'], importMeta, context)

        expect(mockSpawn).toHaveBeenCalledWith(
          '/Program Files/npm/npm.exe',
          expect.any(Array),
          expect.any(Object),
        )
      })

      it('should handle complex npm commands', async () => {
        await cmdRawNpm.run(
          ['run', 'build', '--', '--production'],
          importMeta,
          context,
        )

        expect(mockSpawn).toHaveBeenCalledWith(
          expect.any(String),
          ['run', 'build', '--', '--production'],
          expect.any(Object),
        )
      })
    })
  })
})
