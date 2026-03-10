/**
 * Unit tests for raw-npx command.
 *
 * Tests the command that runs npx without the Socket wrapper.
 *
 * Test Coverage:
 * - Command metadata (description, hidden flag)
 * - --dry-run flag support
 * - npx binary path resolution
 * - Argument passing to npx
 * - Process spawning configuration
 * - Exit code handling
 * - Signal handling
 *
 * Testing Approach:
 * - Mock logger to capture output
 * - Mock meowOrExit to control flag values
 * - Mock spawn from @socketsecurity/lib/spawn
 * - Mock getNpxBinPath to return controlled path
 * - Mock outputDryRunExecute for dry-run testing
 * - Verify spawn configuration (shell, stdio, etc.)
 *
 * Related Files:
 * - src/commands/raw-npx/cmd-raw-npx.mts - Implementation
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

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

// Mock npx path utilities.
const mockGetNpxBinPath = vi.hoisted(() => vi.fn(() => '/usr/bin/npx'))

vi.mock('../../../../src/utils/npm/paths.mts', () => ({
  getNpxBinPath: mockGetNpxBinPath,
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
const { CMD_NAME, cmdRawNpx } = await import(
  '../../../../src/commands/raw-npx/cmd-raw-npx.mts'
)

describe('cmd-raw-npx', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
    mockGetNpxBinPath.mockReturnValue('/usr/bin/npx')
  })

  describe('command metadata', () => {
    it('should export CMD_NAME as raw-npx', () => {
      expect(CMD_NAME).toBe('raw-npx')
    })

    it('should have correct description', () => {
      expect(cmdRawNpx.description).toBe('Run npx without the Socket wrapper')
    })

    it('should not be hidden', () => {
      expect(cmdRawNpx.hidden).toBe(false)
    })
  })

  describe('run', () => {
    const importMeta = { url: 'file:///test/cmd-raw-npx.mts' }
    const context = { parentName: 'socket' }

    describe('--dry-run flag', () => {
      it('should show preview without spawning npx', async () => {
        await cmdRawNpx.run(['cowsay', '--dry-run'], importMeta, context)

        expect(mockOutputDryRunExecute).toHaveBeenCalledWith(
          '/usr/bin/npx',
          ['cowsay', '--dry-run'],
          'raw npx command',
        )
        expect(mockSpawn).not.toHaveBeenCalled()
      })

      it('should use npx path from getNpxBinPath in dry-run', async () => {
        mockGetNpxBinPath.mockReturnValue('/custom/path/to/npx')

        await cmdRawNpx.run(['cowsay', '--dry-run'], importMeta, context)

        expect(mockOutputDryRunExecute).toHaveBeenCalledWith(
          '/custom/path/to/npx',
          expect.any(Array),
          'raw npx command',
        )
      })

      it('should pass all arguments to dry-run output', async () => {
        await cmdRawNpx.run(
          ['prettier', '--check', '.', '--dry-run'],
          importMeta,
          context,
        )

        expect(mockOutputDryRunExecute).toHaveBeenCalledWith(
          expect.any(String),
          ['prettier', '--check', '.', '--dry-run'],
          'raw npx command',
        )
      })
    })

    describe('npx execution', () => {
      it('should spawn npx with correct path', async () => {
        mockGetNpxBinPath.mockReturnValue('/usr/local/bin/npx')

        await cmdRawNpx.run(['cowsay'], importMeta, context)

        expect(mockSpawn).toHaveBeenCalledWith(
          '/usr/local/bin/npx',
          ['cowsay'],
          expect.objectContaining({
            shell: false,
            stdio: 'inherit',
          }),
        )
      })

      it('should pass arguments to npx', async () => {
        await cmdRawNpx.run(['prettier', '--check', '.'], importMeta, context)

        expect(mockSpawn).toHaveBeenCalledWith(
          expect.any(String),
          ['prettier', '--check', '.'],
          expect.any(Object),
        )
      })

      it('should use stdio inherit mode', async () => {
        await cmdRawNpx.run(['cowsay'], importMeta, context)

        expect(mockSpawn).toHaveBeenCalledWith(
          expect.any(String),
          expect.any(Array),
          expect.objectContaining({
            stdio: 'inherit',
          }),
        )
      })

      it('should set shell to false on non-Windows', async () => {
        await cmdRawNpx.run(['cowsay'], importMeta, context)

        expect(mockSpawn).toHaveBeenCalledWith(
          expect.any(String),
          expect.any(Array),
          expect.objectContaining({
            shell: false,
          }),
        )
      })

      it('should set initial exit code to 1', async () => {
        await cmdRawNpx.run(['cowsay'], importMeta, context)

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

        await cmdRawNpx.run(['cowsay'], importMeta, context)

        expect(mockProcess.on).toHaveBeenCalledWith(
          'exit',
          expect.any(Function),
        )
      })
    })

    describe('argument handling', () => {
      it('should handle empty arguments', async () => {
        await cmdRawNpx.run([], importMeta, context)

        expect(mockSpawn).toHaveBeenCalledWith(
          expect.any(String),
          [],
          expect.any(Object),
        )
      })

      it('should handle single argument', async () => {
        await cmdRawNpx.run(['cowsay'], importMeta, context)

        expect(mockSpawn).toHaveBeenCalledWith(
          expect.any(String),
          ['cowsay'],
          expect.any(Object),
        )
      })

      it('should handle multiple arguments', async () => {
        await cmdRawNpx.run(
          ['typescript', '--version'],
          importMeta,
          context,
        )

        expect(mockSpawn).toHaveBeenCalledWith(
          expect.any(String),
          ['typescript', '--version'],
          expect.any(Object),
        )
      })

      it('should handle arguments with special characters', async () => {
        await cmdRawNpx.run(
          ['@angular/cli', 'new', 'my-app'],
          importMeta,
          context,
        )

        expect(mockSpawn).toHaveBeenCalledWith(
          expect.any(String),
          ['@angular/cli', 'new', 'my-app'],
          expect.any(Object),
        )
      })

      it('should handle package@version syntax', async () => {
        await cmdRawNpx.run(['cowsay@1.5.0', 'hello'], importMeta, context)

        expect(mockSpawn).toHaveBeenCalledWith(
          expect.any(String),
          ['cowsay@1.5.0', 'hello'],
          expect.any(Object),
        )
      })
    })

    describe('readonly arguments', () => {
      it('should handle readonly argv array', async () => {
        const readonlyArgv = Object.freeze(['cowsay']) as readonly string[]

        await cmdRawNpx.run(readonlyArgv, importMeta, context)

        expect(mockSpawn).toHaveBeenCalledWith(
          expect.any(String),
          ['cowsay'],
          expect.any(Object),
        )
      })

      it('should handle readonly argv in dry-run', async () => {
        const readonlyArgv = Object.freeze([
          'cowsay',
          '--dry-run',
        ]) as readonly string[]

        await cmdRawNpx.run(readonlyArgv, importMeta, context)

        expect(mockOutputDryRunExecute).toHaveBeenCalled()
      })
    })

    describe('edge cases', () => {
      it('should handle npx path with spaces', async () => {
        mockGetNpxBinPath.mockReturnValue('/Program Files/npx/npx.exe')

        await cmdRawNpx.run(['cowsay'], importMeta, context)

        expect(mockSpawn).toHaveBeenCalledWith(
          '/Program Files/npx/npx.exe',
          expect.any(Array),
          expect.any(Object),
        )
      })

      it('should handle complex npx commands', async () => {
        await cmdRawNpx.run(
          ['create-react-app', 'my-app', '--template', 'typescript'],
          importMeta,
          context,
        )

        expect(mockSpawn).toHaveBeenCalledWith(
          expect.any(String),
          ['create-react-app', 'my-app', '--template', 'typescript'],
          expect.any(Object),
        )
      })

      it('should handle binary executables from packages', async () => {
        await cmdRawNpx.run(['eslint', '--fix'], importMeta, context)

        expect(mockSpawn).toHaveBeenCalledWith(
          expect.any(String),
          ['eslint', '--fix'],
          expect.any(Object),
        )
      })
    })
  })
})
