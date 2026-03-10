import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CliCommandContext } from '../../../../src/utils/cli/with-subcommands.mts'

// Mock dependencies before imports.
vi.mock('@socketsecurity/lib/bin', () => ({
  whichReal: vi.fn(),
}))

vi.mock('../../../../src/utils/dlx/spawn.mts', () => ({
  spawnSfwDlx: vi.fn(),
}))

vi.mock('../../../../src/utils/process/cmd.mts', () => ({
  filterFlags: vi.fn((argv) => argv),
}))

vi.mock('../../../../src/utils/cli/with-subcommands.mjs', () => ({
  meowOrExit: vi.fn(),
}))

// Import modules after mocks are set up.
const { cmdPip } = await import('../../../../src/commands/pip/cmd-pip.mts')
const binModule = await import('@socketsecurity/lib/bin')
const spawnModule = await import('../../../../src/utils/dlx/spawn.mts')
const cmdModule = await import('../../../../src/utils/process/cmd.mts')
const meowModule = await import('../../../../src/utils/cli/with-subcommands.mjs')

const mockWhichReal = vi.mocked(binModule.whichReal)
const mockSpawnSfwDlx = vi.mocked(spawnModule.spawnSfwDlx)
const mockFilterFlags = vi.mocked(cmdModule.filterFlags)
const mockMeowOrExit = vi.mocked(meowModule.meowOrExit)

// Mock process methods.
const mockProcessExit = vi
  .spyOn(process, 'exit')
  .mockImplementation(() => undefined as never)
const mockProcessKill = vi.spyOn(process, 'kill').mockImplementation(() => true)

describe('cmd-pip', () => {
  const mockChildProcess = {
    on: vi.fn(),
    pid: 12345,
  }

  // Create a proper promise-like object for spawnPromise.
  const createMockSpawnResult = (exitCode = 0, signal?: NodeJS.Signals) => {
    const promise: any = Promise.resolve({
      success: exitCode === 0 && !signal,
      code: signal ? null : exitCode,
      signal: signal || undefined,
    })
    promise.process = mockChildProcess
    return {
      spawnPromise: promise,
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()

    // Reset process properties.
    process.exitCode = undefined

    // Setup default mock implementations.
    mockSpawnSfwDlx.mockResolvedValue(createMockSpawnResult(0))
    mockWhichReal.mockResolvedValue('/usr/bin/pip')
    mockFilterFlags.mockImplementation((argv) => argv)
    mockChildProcess.on.mockImplementation((event, handler) => {
      // Simulate immediate successful exit by default.
      if (event === 'exit') {
        // Don't call handler here, let the test control when exit is called.
      }
      return mockChildProcess
    })
  })

  describe('command structure', () => {
    it('should export cmdPip with correct structure', () => {
      expect(cmdPip).toBeDefined()
      expect(cmdPip.description).toBe('Run pip with Socket Firewall security')
      expect(cmdPip.hidden).toBe(false)
      expect(typeof cmdPip.run).toBe('function')
    })
  })

  describe('--help flag', () => {
    it('should call meowOrExit with correct config for help display', async () => {
      const argv = ['--help']
      const importMeta = { url: import.meta.url } as ImportMeta
      const context: CliCommandContext = {
        parentName: 'socket',
      }

      // Mock meowOrExit to prevent actual execution.
      mockMeowOrExit.mockImplementation(() => ({
        flags: {},
        input: [],
        pkg: {},
        help: '',
      }))

      await cmdPip.run(argv, importMeta, context)

      expect(mockMeowOrExit).toHaveBeenCalledWith({
        argv,
        config: expect.objectContaining({
          commandName: 'pip',
          description: 'Run pip with Socket Firewall security',
          hidden: false,
        }),
        importMeta,
        parentName: 'socket',
      })
    })

    it('should include help text with usage examples', async () => {
      const argv = ['--help']
      const importMeta = { url: import.meta.url } as ImportMeta
      const context: CliCommandContext = {
        parentName: 'socket',
      }

      mockMeowOrExit.mockImplementation(() => ({
        flags: {},
        input: [],
        pkg: {},
        help: '',
      }))

      await cmdPip.run(argv, importMeta, context)

      const callArgs = mockMeowOrExit.mock.calls[0]?.[0]
      const config = callArgs?.config
      const help = config?.help?.('socket pip')

      expect(help).toContain('Usage')
      expect(help).toContain('$ socket pip ...')
      expect(help).toContain('Socket Firewall')
      expect(help).toContain('install flask')
      expect(help).toContain('install -r requirements.txt')
      expect(help).toContain('list')
    })
  })

  describe('flag filtering', () => {
    it('should filter out Socket CLI flags before forwarding to sfw', async () => {
      const argv = ['install', 'flask', '--config', 'test.json', '--dry-run']
      const importMeta = { url: import.meta.url } as ImportMeta
      const context: CliCommandContext = {
        parentName: 'socket',
      }

      mockFilterFlags.mockReturnValue(['install', 'flask'])

      await cmdPip.run(argv, importMeta, context)

      expect(mockFilterFlags).toHaveBeenCalledWith(
        argv,
        expect.any(Object),
        [],
      )

      expect(mockSpawnSfwDlx).toHaveBeenCalledWith(
        ['pip', 'install', 'flask'],
        expect.objectContaining({
          stdio: 'inherit',
        }),
      )
    })

    it('should pass all flags to filterFlags', async () => {
      const argv = ['install', 'requests']
      const importMeta = { url: import.meta.url } as ImportMeta
      const context: CliCommandContext = {
        parentName: 'socket',
      }

      await cmdPip.run(argv, importMeta, context)

      const callArgs = mockFilterFlags.mock.calls[0]
      expect(callArgs?.[0]).toEqual(argv)
      expect(callArgs?.[1]).toMatchObject({
        animateHeader: expect.any(Object),
        banner: expect.any(Object),
        config: expect.any(Object),
        dryRun: expect.any(Object),
        help: expect.any(Object),
        spinner: expect.any(Object),
      })
      expect(callArgs?.[2]).toEqual([])
    })
  })

  describe('binary detection (getPipBinName)', () => {
    it('should use pip when invoked as socket pip and pip exists', async () => {
      const argv = ['install', 'flask']
      const importMeta = { url: import.meta.url } as ImportMeta
      const context: CliCommandContext = {
        parentName: 'socket',
        invokedAs: undefined,
      }

      mockWhichReal.mockResolvedValue('/usr/bin/pip')

      await cmdPip.run(argv, importMeta, context)

      expect(mockWhichReal).toHaveBeenCalledWith('pip', { nothrow: true })
      expect(mockSpawnSfwDlx).toHaveBeenCalledWith(
        ['pip', 'install', 'flask'],
        expect.any(Object),
      )
    })

    it('should use pip3 when invoked as socket pip3', async () => {
      const argv = ['install', 'requests']
      const importMeta = { url: import.meta.url } as ImportMeta
      const context: CliCommandContext = {
        parentName: 'socket',
        invokedAs: 'pip3',
      }

      mockWhichReal.mockResolvedValue('/usr/bin/pip3')

      await cmdPip.run(argv, importMeta, context)

      expect(mockWhichReal).toHaveBeenCalledWith('pip3', { nothrow: true })
      expect(mockSpawnSfwDlx).toHaveBeenCalledWith(
        ['pip3', 'install', 'requests'],
        expect.any(Object),
      )
    })

    it('should fallback to pip3 when pip does not exist', async () => {
      const argv = ['install', 'numpy']
      const importMeta = { url: import.meta.url } as ImportMeta
      const context: CliCommandContext = {
        parentName: 'socket',
      }

      mockWhichReal
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce('/usr/bin/pip3')

      await cmdPip.run(argv, importMeta, context)

      expect(mockWhichReal).toHaveBeenCalledWith('pip', { nothrow: true })
      expect(mockWhichReal).toHaveBeenCalledWith('pip3', { nothrow: true })
      expect(mockSpawnSfwDlx).toHaveBeenCalledWith(
        ['pip3', 'install', 'numpy'],
        expect.any(Object),
      )
    })

    it('should fallback to pip when pip3 does not exist but requested', async () => {
      const argv = ['install', 'pandas']
      const importMeta = { url: import.meta.url } as ImportMeta
      const context: CliCommandContext = {
        parentName: 'socket',
        invokedAs: 'pip3',
      }

      mockWhichReal
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce('/usr/bin/pip')

      await cmdPip.run(argv, importMeta, context)

      expect(mockWhichReal).toHaveBeenCalledWith('pip3', { nothrow: true })
      expect(mockWhichReal).toHaveBeenCalledWith('pip', { nothrow: true })
      expect(mockSpawnSfwDlx).toHaveBeenCalledWith(
        ['pip', 'install', 'pandas'],
        expect.any(Object),
      )
    })

    it('should use requested binary when neither pip nor pip3 exist', async () => {
      const argv = ['install', 'scipy']
      const importMeta = { url: import.meta.url } as ImportMeta
      const context: CliCommandContext = {
        parentName: 'socket',
      }

      mockWhichReal.mockResolvedValue(undefined)

      await cmdPip.run(argv, importMeta, context)

      expect(mockWhichReal).toHaveBeenCalledWith('pip', { nothrow: true })
      expect(mockWhichReal).toHaveBeenCalledWith('pip3', { nothrow: true })
      expect(mockSpawnSfwDlx).toHaveBeenCalledWith(
        ['pip', 'install', 'scipy'],
        expect.any(Object),
      )
    })
  })

  describe('spawn behavior', () => {
    it('should set initial exit code to 1', async () => {
      const argv = ['install', 'flask']
      const importMeta = { url: import.meta.url } as ImportMeta
      const context: CliCommandContext = {
        parentName: 'socket',
      }

      const promise = cmdPip.run(argv, importMeta, context)
      // Wait a tick for the exit code to be set.
      await new Promise(resolve => process.nextTick(resolve))
      expect(process.exitCode).toBe(1)
      await promise
    })

    it('should call spawnSfwDlx with correct arguments', async () => {
      const argv = ['install', 'django', '--upgrade']
      const importMeta = { url: import.meta.url } as ImportMeta
      const context: CliCommandContext = {
        parentName: 'socket',
      }

      mockFilterFlags.mockReturnValue(['install', 'django', '--upgrade'])

      await cmdPip.run(argv, importMeta, context)

      expect(mockSpawnSfwDlx).toHaveBeenCalledWith(
        ['pip', 'install', 'django', '--upgrade'],
        {
          stdio: 'inherit',
        },
      )
    })

    it('should forward all arguments to sfw', async () => {
      const argv = [
        'install',
        '-r',
        'requirements.txt',
        '--no-cache-dir',
        '--user',
      ]
      const importMeta = { url: import.meta.url } as ImportMeta
      const context: CliCommandContext = {
        parentName: 'socket',
      }

      mockFilterFlags.mockReturnValue([
        'install',
        '-r',
        'requirements.txt',
        '--no-cache-dir',
        '--user',
      ])

      await cmdPip.run(argv, importMeta, context)

      expect(mockSpawnSfwDlx).toHaveBeenCalledWith(
        [
          'pip',
          'install',
          '-r',
          'requirements.txt',
          '--no-cache-dir',
          '--user',
        ],
        expect.objectContaining({
          stdio: 'inherit',
        }),
      )
    })

    it('should handle empty arguments array', async () => {
      const argv: string[] = []
      const importMeta = { url: import.meta.url } as ImportMeta
      const context: CliCommandContext = {
        parentName: 'socket',
      }

      mockFilterFlags.mockReturnValue([])

      await cmdPip.run(argv, importMeta, context)

      expect(mockSpawnSfwDlx).toHaveBeenCalledWith(['pip'], {
        stdio: 'inherit',
      })
    })

    it('should use stdio inherit for process communication', async () => {
      const argv = ['list']
      const importMeta = { url: import.meta.url } as ImportMeta
      const context: CliCommandContext = {
        parentName: 'socket',
      }

      await cmdPip.run(argv, importMeta, context)

      expect(mockSpawnSfwDlx).toHaveBeenCalledWith(
        ['pip', 'list'],
        expect.objectContaining({
          stdio: 'inherit',
        }),
      )
    })

    it('should wait for spawn promise completion', async () => {
      const argv = ['--version']
      const importMeta = { url: import.meta.url } as ImportMeta
      const context: CliCommandContext = {
        parentName: 'socket',
      }

      await cmdPip.run(argv, importMeta, context)

      expect(mockSpawnSfwDlx).toHaveBeenCalled()
    })
  })

  describe('process exit handling', () => {
    it('should handle process exit with numeric code 0', async () => {
      const argv = ['install', 'flask']
      const importMeta = { url: import.meta.url } as ImportMeta
      const context: CliCommandContext = {
        parentName: 'socket',
      }

      let exitHandler: (code: number | null, signal: NodeJS.Signals | null) => void
      mockChildProcess.on.mockImplementation((event, handler) => {
        if (event === 'exit') {
          exitHandler = handler as any
        }
        return mockChildProcess
      })

      const promise = cmdPip.run(argv, importMeta, context)

      // Wait a tick for the event handler to be registered.
      await new Promise(resolve => process.nextTick(resolve))

      // Trigger exit event.
      exitHandler!(0, null)

      await promise

      expect(mockProcessExit).toHaveBeenCalledWith(0)
    })

    it('should handle process exit with numeric code 1', async () => {
      const argv = ['install', 'nonexistent-package']
      const importMeta = { url: import.meta.url } as ImportMeta
      const context: CliCommandContext = {
        parentName: 'socket',
      }

      mockSpawnSfwDlx.mockResolvedValue(createMockSpawnResult(1))

      let exitHandler: (code: number | null, signal: NodeJS.Signals | null) => void
      mockChildProcess.on.mockImplementation((event, handler) => {
        if (event === 'exit') {
          exitHandler = handler as any
        }
        return mockChildProcess
      })

      const promise = cmdPip.run(argv, importMeta, context)

      // Wait a tick for the event handler to be registered.
      await new Promise(resolve => process.nextTick(resolve))

      // Trigger exit event.
      exitHandler!(1, null)

      await promise

      expect(mockProcessExit).toHaveBeenCalledWith(1)
    })

    it('should handle process exit with SIGTERM signal', async () => {
      const argv = ['install', 'flask']
      const importMeta = { url: import.meta.url } as ImportMeta
      const context: CliCommandContext = {
        parentName: 'socket',
      }

      mockSpawnSfwDlx.mockResolvedValue(createMockSpawnResult(0, 'SIGTERM'))

      let exitHandler: (code: number | null, signal: NodeJS.Signals | null) => void
      mockChildProcess.on.mockImplementation((event, handler) => {
        if (event === 'exit') {
          exitHandler = handler as any
        }
        return mockChildProcess
      })

      const promise = cmdPip.run(argv, importMeta, context)

      // Wait a tick for the event handler to be registered.
      await new Promise(resolve => process.nextTick(resolve))

      // Trigger exit event with signal.
      exitHandler!(null, 'SIGTERM')

      await promise

      expect(mockProcessKill).toHaveBeenCalledWith(process.pid, 'SIGTERM')
    })

    it('should handle process exit with SIGINT signal', async () => {
      const argv = ['install', 'requests']
      const importMeta = { url: import.meta.url } as ImportMeta
      const context: CliCommandContext = {
        parentName: 'socket',
      }

      mockSpawnSfwDlx.mockResolvedValue(createMockSpawnResult(0, 'SIGINT'))

      let exitHandler: (code: number | null, signal: NodeJS.Signals | null) => void
      mockChildProcess.on.mockImplementation((event, handler) => {
        if (event === 'exit') {
          exitHandler = handler as any
        }
        return mockChildProcess
      })

      const promise = cmdPip.run(argv, importMeta, context)

      // Wait a tick for the event handler to be registered.
      await new Promise(resolve => process.nextTick(resolve))

      // Trigger exit event with signal.
      exitHandler!(null, 'SIGINT')

      await promise

      expect(mockProcessKill).toHaveBeenCalledWith(process.pid, 'SIGINT')
    })
  })

  describe('context handling', () => {
    it('should handle context with parentName', async () => {
      const argv = ['install', 'flask']
      const importMeta = { url: import.meta.url } as ImportMeta
      const context: CliCommandContext = {
        parentName: 'socket',
      }

      await cmdPip.run(argv, importMeta, context)

      expect(mockMeowOrExit).toHaveBeenCalledWith(
        expect.objectContaining({
          parentName: 'socket',
        }),
      )
    })

    it('should handle context with invokedAs', async () => {
      const argv = ['install', 'numpy']
      const importMeta = { url: import.meta.url } as ImportMeta
      const context: CliCommandContext = {
        parentName: 'socket',
        invokedAs: 'pip3',
      }

      mockWhichReal.mockResolvedValue('/usr/bin/pip3')

      await cmdPip.run(argv, importMeta, context)

      expect(mockWhichReal).toHaveBeenCalledWith('pip3', { nothrow: true })
    })

    it('should handle context without invokedAs', async () => {
      const argv = ['install', 'pandas']
      const importMeta = { url: import.meta.url } as ImportMeta
      const context: CliCommandContext = {
        parentName: 'socket',
      }

      mockWhichReal.mockResolvedValue('/usr/bin/pip')

      await cmdPip.run(argv, importMeta, context)

      expect(mockWhichReal).toHaveBeenCalledWith('pip', { nothrow: true })
    })
  })

  describe('common pip operations', () => {
    it('should handle pip install', async () => {
      const argv = ['install', 'requests']
      const importMeta = { url: import.meta.url } as ImportMeta
      const context: CliCommandContext = {
        parentName: 'socket',
      }

      mockFilterFlags.mockReturnValue(['install', 'requests'])

      await cmdPip.run(argv, importMeta, context)

      expect(mockSpawnSfwDlx).toHaveBeenCalledWith(
        ['pip', 'install', 'requests'],
        expect.any(Object),
      )
    })

    it('should handle pip list', async () => {
      const argv = ['list']
      const importMeta = { url: import.meta.url } as ImportMeta
      const context: CliCommandContext = {
        parentName: 'socket',
      }

      mockFilterFlags.mockReturnValue(['list'])

      await cmdPip.run(argv, importMeta, context)

      expect(mockSpawnSfwDlx).toHaveBeenCalledWith(
        ['pip', 'list'],
        expect.any(Object),
      )
    })

    it('should handle pip freeze', async () => {
      const argv = ['freeze']
      const importMeta = { url: import.meta.url } as ImportMeta
      const context: CliCommandContext = {
        parentName: 'socket',
      }

      mockFilterFlags.mockReturnValue(['freeze'])

      await cmdPip.run(argv, importMeta, context)

      expect(mockSpawnSfwDlx).toHaveBeenCalledWith(
        ['pip', 'freeze'],
        expect.any(Object),
      )
    })

    it('should handle pip uninstall', async () => {
      const argv = ['uninstall', 'flask', '-y']
      const importMeta = { url: import.meta.url } as ImportMeta
      const context: CliCommandContext = {
        parentName: 'socket',
      }

      mockFilterFlags.mockReturnValue(['uninstall', 'flask', '-y'])

      await cmdPip.run(argv, importMeta, context)

      expect(mockSpawnSfwDlx).toHaveBeenCalledWith(
        ['pip', 'uninstall', 'flask', '-y'],
        expect.any(Object),
      )
    })

    it('should handle pip install with requirements.txt', async () => {
      const argv = ['install', '-r', 'requirements.txt']
      const importMeta = { url: import.meta.url } as ImportMeta
      const context: CliCommandContext = {
        parentName: 'socket',
      }

      mockFilterFlags.mockReturnValue(['install', '-r', 'requirements.txt'])

      await cmdPip.run(argv, importMeta, context)

      expect(mockSpawnSfwDlx).toHaveBeenCalledWith(
        ['pip', 'install', '-r', 'requirements.txt'],
        expect.any(Object),
      )
    })
  })
})
