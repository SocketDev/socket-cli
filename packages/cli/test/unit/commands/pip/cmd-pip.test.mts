import * as binModule from '@socketsecurity/lib-stable/bin/which'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { cmdPip } from '../../../../src/commands/pip/cmd-pip.mts'
import * as meowModule from '../../../../src/util/cli/with-subcommands.mjs'
import * as spawnModule from '../../../../src/util/dlx/spawn.mts'
import * as cmdModule from '../../../../src/util/process/cmd.mts'

import type { CliCommandContext } from '../../../../src/util/cli/with-subcommands.mts'

// Mock dependencies before imports.
vi.mock(import('@socketsecurity/lib-stable/bin/which'), () => ({
  whichReal: vi.fn(),
}))

vi.mock(import('../../../../src/util/dlx/spawn.mts'), () => ({
  spawnSfwDlx: vi.fn(),
}))

vi.mock(import('../../../../src/util/process/cmd.mts'), () => ({
  filterFlags: vi.fn(argv => argv),
}))

vi.mock(import('../../../../src/util/cli/with-subcommands.mjs'), () => ({
  meowOrExit: vi.fn(),
}))

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
    pid: 12_345,
  }

  // Create a proper promise-like object for spawnPromise.
  const createMockSpawnResult = (
    exitCode = 0,
    signal?: NodeJS.Signals | undefined,
  ) => {
    const promise: unknown = Promise.resolve({
      success: exitCode === 0 && !signal,
      code: signal ? undefined : exitCode,
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
    mockFilterFlags.mockImplementation(argv => argv)
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

      expect(mockFilterFlags).toHaveBeenCalledWith(argv, expect.any(Object), [])

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
})
