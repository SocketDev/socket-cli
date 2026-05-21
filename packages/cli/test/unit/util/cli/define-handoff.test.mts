/**
 * Unit tests for `defineHandoffCommand`.
 *
 * Locks in the contract that the factory builds the same shape every existing
 * hand-off wrapper used to build by hand: a CliSubcommand with `description`,
 * `hidden`, and `run` — where `run` parses flags, filters Socket-only flags,
 * picks the binary, optionally renders dry-run, optionally tracks telemetry,
 * spawns sfw, and forwards the child's exit code or signal.
 */

import EventEmitter from 'node:events'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockMeowOrExit = vi.hoisted(() => vi.fn())
const mockFilterFlags = vi.hoisted(() => vi.fn())
const mockSpawnSfw = vi.hoisted(() => vi.fn())
const mockSpawnSfwDlx = vi.hoisted(() => vi.fn())
const mockOutputDryRunExecute = vi.hoisted(() => vi.fn())
const mockTrackSubprocessStart = vi.hoisted(() => vi.fn())
const mockTrackSubprocessExit = vi.hoisted(() => vi.fn())

vi.mock('../../../../src/util/cli/with-subcommands.mts', () => ({
  meowOrExit: mockMeowOrExit,
}))

vi.mock('../../../../src/util/dlx/spawn.mts', () => ({
  spawnSfw: mockSpawnSfw,
  spawnSfwDlx: mockSpawnSfwDlx,
}))

vi.mock('../../../../src/util/dry-run/output.mts', () => ({
  outputDryRunExecute: mockOutputDryRunExecute,
}))

vi.mock('../../../../src/util/process/cmd.mts', () => ({
  filterFlags: mockFilterFlags,
}))

vi.mock('../../../../src/util/telemetry/integration.mts', () => ({
  trackSubprocessStart: mockTrackSubprocessStart,
  trackSubprocessExit: mockTrackSubprocessExit,
}))

import { defineHandoffCommand } from '../../../../src/util/cli/define-handoff.mts'

function makeChildProcess() {
  const child = new EventEmitter()
  const spawnPromise: unknown = Promise.resolve({
    code: 0,
    signal: undefined,
    stderr: Buffer.from(''),
    stdout: Buffer.from(''),
  })
  spawnPromise.process = child
  return { child, spawnPromise }
}

describe('defineHandoffCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFilterFlags.mockReturnValue([])
    mockMeowOrExit.mockReturnValue({
      flags: {},
      input: [],
      pkg: {},
      showHelp: vi.fn(),
      showVersion: vi.fn(),
      unknownFlags: [],
    })
    mockTrackSubprocessStart.mockResolvedValue(123)
    mockTrackSubprocessExit.mockResolvedValue(undefined)
  })

  describe('CliSubcommand shape', () => {
    it('returns an object with description, hidden, and run', () => {
      const cmd = defineHandoffCommand({
        name: 'cargo',
        description: 'Run cargo with sfw',
        spawnMode: 'dlx',
        examples: ['build'],
      })
      expect(cmd.description).toBe('Run cargo with sfw')
      expect(cmd.hidden).toBe(false)
      expect(typeof cmd.run).toBe('function')
    })

    it('respects hidden=true', () => {
      const cmd = defineHandoffCommand({
        name: 'yarn',
        description: 'Run yarn with sfw',
        spawnMode: 'dlx',
        hidden: true,
        examples: [],
      })
      expect(cmd.hidden).toBe(true)
    })
  })

  describe('spawn mode dispatch', () => {
    it('uses spawnSfwDlx when spawnMode is "dlx"', async () => {
      const { child, spawnPromise } = makeChildProcess()
      mockSpawnSfwDlx.mockResolvedValue({ spawnPromise })
      mockFilterFlags.mockReturnValue(['build'])

      const cmd = defineHandoffCommand({
        name: 'cargo',
        description: 'Run cargo',
        spawnMode: 'dlx',
        examples: [],
        trackTelemetry: false,
        supportDryRun: false,
      })

      const runPromise = cmd.run(
        ['build'],
        { url: import.meta.url } as ImportMeta,
        {
          parentName: 'socket',
        },
      )
      setImmediate(() => child.emit('exit', 0, undefined))
      const mockExit = vi
        .spyOn(process, 'exit')
        .mockImplementation((() => {}) as unknown)
      try {
        await runPromise
        expect(mockSpawnSfwDlx).toHaveBeenCalledWith(['cargo', 'build'], {
          stdio: 'inherit',
        })
        expect(mockSpawnSfw).not.toHaveBeenCalled()
      } finally {
        mockExit.mockRestore()
      }
    })

    it('uses spawnSfw when spawnMode is "auto"', async () => {
      const { child, spawnPromise } = makeChildProcess()
      mockSpawnSfw.mockResolvedValue({ spawnPromise })
      mockFilterFlags.mockReturnValue(['install', 'cowsay'])

      const cmd = defineHandoffCommand({
        name: 'npm',
        description: 'Run npm',
        spawnMode: 'auto',
        examples: [],
        trackTelemetry: false,
        supportDryRun: false,
      })

      const runPromise = cmd.run(
        ['install', 'cowsay'],
        { url: import.meta.url } as ImportMeta,
        { parentName: 'socket' },
      )
      setImmediate(() => child.emit('exit', 0, undefined))
      const mockExit = vi
        .spyOn(process, 'exit')
        .mockImplementation((() => {}) as unknown)
      try {
        await runPromise
        expect(mockSpawnSfw).toHaveBeenCalledWith(
          ['npm', 'install', 'cowsay'],
          { stdio: 'inherit' },
        )
        expect(mockSpawnSfwDlx).not.toHaveBeenCalled()
      } finally {
        mockExit.mockRestore()
      }
    })
  })

  describe('binaryPicker', () => {
    it('uses binaryPicker output as the first arg to sfw', async () => {
      const { child, spawnPromise } = makeChildProcess()
      mockSpawnSfwDlx.mockResolvedValue({ spawnPromise })
      mockFilterFlags.mockReturnValue(['install', 'flask'])

      const cmd = defineHandoffCommand({
        name: 'pip',
        description: 'Run pip',
        spawnMode: 'dlx',
        examples: [],
        binaryPicker: ctx => (ctx.invokedAs === 'pip3' ? 'pip3' : 'pip'),
        trackTelemetry: false,
        supportDryRun: false,
      })

      const runPromise = cmd.run(
        ['install', 'flask'],
        { url: import.meta.url } as ImportMeta,
        { parentName: 'socket', invokedAs: 'pip3' },
      )
      setImmediate(() => child.emit('exit', 0, undefined))
      const mockExit = vi
        .spyOn(process, 'exit')
        .mockImplementation((() => {}) as unknown)
      try {
        await runPromise
        expect(mockSpawnSfwDlx).toHaveBeenCalledWith(
          ['pip3', 'install', 'flask'],
          { stdio: 'inherit' },
        )
      } finally {
        mockExit.mockRestore()
      }
    })
  })

  describe('dry-run', () => {
    it('renders dry-run output and bails when --dry-run is set', async () => {
      mockMeowOrExit.mockReturnValue({
        flags: { dryRun: true },
        input: [],
        pkg: {},
        showHelp: vi.fn(),
        showVersion: vi.fn(),
        unknownFlags: [],
      })
      mockFilterFlags.mockReturnValue(['install'])

      const cmd = defineHandoffCommand({
        name: 'npm',
        description: 'Run npm',
        spawnMode: 'auto',
        examples: [],
        supportDryRun: true,
        trackTelemetry: false,
      })

      await cmd.run(['install'], { url: import.meta.url } as ImportMeta, {
        parentName: 'socket',
      })

      expect(mockOutputDryRunExecute).toHaveBeenCalledWith(
        'sfw',
        ['npm', 'install'],
        'npm with Socket security scanning',
      )
      expect(mockSpawnSfw).not.toHaveBeenCalled()
    })

    it('skips dry-run rendering when supportDryRun is false', async () => {
      const { child, spawnPromise } = makeChildProcess()
      mockSpawnSfwDlx.mockResolvedValue({ spawnPromise })
      mockMeowOrExit.mockReturnValue({
        flags: { dryRun: true },
        input: [],
        pkg: {},
        showHelp: vi.fn(),
        showVersion: vi.fn(),
        unknownFlags: [],
      })
      mockFilterFlags.mockReturnValue([])

      const cmd = defineHandoffCommand({
        name: 'cargo',
        description: 'Run cargo',
        spawnMode: 'dlx',
        examples: [],
        supportDryRun: false,
        trackTelemetry: false,
      })

      const runPromise = cmd.run([], { url: import.meta.url } as ImportMeta, {
        parentName: 'socket',
      })
      setImmediate(() => child.emit('exit', 0, undefined))
      const mockExit = vi
        .spyOn(process, 'exit')
        .mockImplementation((() => {}) as unknown)
      try {
        await runPromise
        expect(mockOutputDryRunExecute).not.toHaveBeenCalled()
        expect(mockSpawnSfwDlx).toHaveBeenCalled()
      } finally {
        mockExit.mockRestore()
      }
    })
  })

  describe('telemetry', () => {
    it('starts and ends telemetry span by default', async () => {
      const { child, spawnPromise } = makeChildProcess()
      mockSpawnSfw.mockResolvedValue({ spawnPromise })
      mockFilterFlags.mockReturnValue([])

      const cmd = defineHandoffCommand({
        name: 'npm',
        description: 'Run npm',
        spawnMode: 'auto',
        examples: [],
      })

      const runPromise = cmd.run([], { url: import.meta.url } as ImportMeta, {
        parentName: 'socket',
      })
      setImmediate(() => child.emit('exit', 0, undefined))
      const mockExit = vi
        .spyOn(process, 'exit')
        .mockImplementation((() => {}) as unknown)
      try {
        await runPromise
        await new Promise(resolve => setImmediate(resolve))
        expect(mockTrackSubprocessStart).toHaveBeenCalledWith('npm')
        expect(mockTrackSubprocessExit).toHaveBeenCalledWith('npm', 123, 0)
      } finally {
        mockExit.mockRestore()
      }
    })

    it('skips telemetry when trackTelemetry is false', async () => {
      const { child, spawnPromise } = makeChildProcess()
      mockSpawnSfwDlx.mockResolvedValue({ spawnPromise })
      mockFilterFlags.mockReturnValue([])

      const cmd = defineHandoffCommand({
        name: 'cargo',
        description: 'Run cargo',
        spawnMode: 'dlx',
        examples: [],
        trackTelemetry: false,
      })

      const runPromise = cmd.run([], { url: import.meta.url } as ImportMeta, {
        parentName: 'socket',
      })
      setImmediate(() => child.emit('exit', 0, undefined))
      const mockExit = vi
        .spyOn(process, 'exit')
        .mockImplementation((() => {}) as unknown)
      try {
        await runPromise
        expect(mockTrackSubprocessStart).not.toHaveBeenCalled()
        expect(mockTrackSubprocessExit).not.toHaveBeenCalled()
      } finally {
        mockExit.mockRestore()
      }
    })
  })

  describe('exit forwarding', () => {
    it('forwards child exit code via process.exit', async () => {
      const { child, spawnPromise } = makeChildProcess()
      mockSpawnSfwDlx.mockResolvedValue({ spawnPromise })
      mockFilterFlags.mockReturnValue([])

      const cmd = defineHandoffCommand({
        name: 'cargo',
        description: 'Run cargo',
        spawnMode: 'dlx',
        examples: [],
        trackTelemetry: false,
      })

      const mockExit = vi
        .spyOn(process, 'exit')
        .mockImplementation((() => {}) as unknown)
      try {
        cmd.run([], { url: import.meta.url } as ImportMeta, {
          parentName: 'socket',
        })
        // Wait for the listener to register (async spawn resolution).
        await new Promise(resolve => setImmediate(resolve))
        child.emit('exit', 42, undefined)
        await new Promise(resolve => setImmediate(resolve))
        expect(mockExit).toHaveBeenCalledWith(42)
      } finally {
        mockExit.mockRestore()
      }
    })

    it('forwards child signal via process.kill', async () => {
      const { child, spawnPromise } = makeChildProcess()
      mockSpawnSfwDlx.mockResolvedValue({ spawnPromise })
      mockFilterFlags.mockReturnValue([])

      const cmd = defineHandoffCommand({
        name: 'cargo',
        description: 'Run cargo',
        spawnMode: 'dlx',
        examples: [],
        trackTelemetry: false,
      })

      const mockKill = vi
        .spyOn(process, 'kill')
        .mockImplementation((() => {}) as unknown)
      try {
        cmd.run([], { url: import.meta.url } as ImportMeta, {
          parentName: 'socket',
        })
        await new Promise(resolve => setImmediate(resolve))
        child.emit('exit', undefined, 'SIGINT')
        await new Promise(resolve => setImmediate(resolve))
        expect(mockKill).toHaveBeenCalledWith(process.pid, 'SIGINT')
      } finally {
        mockKill.mockRestore()
      }
    })
  })

  describe('help text', () => {
    it('captures the help template via meowOrExit config', async () => {
      const { child, spawnPromise } = makeChildProcess()
      mockSpawnSfwDlx.mockResolvedValue({ spawnPromise })
      mockFilterFlags.mockReturnValue([])
      let capturedHelp = ''
      mockMeowOrExit.mockImplementation((args: unknown) => {
        capturedHelp = args.config.help('socket cargo')
        return {
          flags: {},
          input: [],
          pkg: {},
          showHelp: vi.fn(),
          showVersion: vi.fn(),
          unknownFlags: [],
        }
      })

      const cmd = defineHandoffCommand({
        name: 'cargo',
        description: 'Run cargo',
        spawnMode: 'dlx',
        examples: ['build', 'install ripgrep'],
        helpNotes: ['Wrapper note here.'],
        trackTelemetry: false,
      })

      const mockExit = vi
        .spyOn(process, 'exit')
        .mockImplementation((() => {}) as unknown)
      try {
        const runPromise = cmd.run([], { url: import.meta.url } as ImportMeta, {
          parentName: 'socket',
        })
        setImmediate(() => child.emit('exit', 0, undefined))
        await runPromise
        await new Promise(resolve => setImmediate(resolve))
      } finally {
        mockExit.mockRestore()
      }

      expect(capturedHelp).toContain('socket cargo')
      expect(capturedHelp).toContain('Examples')
      expect(capturedHelp).toContain('$ socket cargo build')
      expect(capturedHelp).toContain('$ socket cargo install ripgrep')
      expect(capturedHelp).toContain('Wrapper note here.')
      expect(capturedHelp).toContain('forwarded to Socket Firewall')
    })

    it('emits the wrapper-on hint when wrapperHint is true', async () => {
      const { child, spawnPromise } = makeChildProcess()
      mockSpawnSfwDlx.mockResolvedValue({ spawnPromise })
      mockFilterFlags.mockReturnValue([])
      let capturedHelp = ''
      mockMeowOrExit.mockImplementation((args: unknown) => {
        capturedHelp = args.config.help('socket yarn')
        return {
          flags: {},
          input: [],
          pkg: {},
          showHelp: vi.fn(),
          showVersion: vi.fn(),
          unknownFlags: [],
        }
      })

      const cmd = defineHandoffCommand({
        name: 'yarn',
        description: 'Run yarn',
        spawnMode: 'dlx',
        examples: [],
        wrapperHint: true,
        trackTelemetry: false,
      })

      const mockExit = vi
        .spyOn(process, 'exit')
        .mockImplementation((() => {}) as unknown)
      try {
        const runPromise = cmd.run([], { url: import.meta.url } as ImportMeta, {
          parentName: 'socket',
        })
        setImmediate(() => child.emit('exit', 0, undefined))
        await runPromise
        await new Promise(resolve => setImmediate(resolve))
      } finally {
        mockExit.mockRestore()
      }

      expect(capturedHelp).toContain('socket wrapper on')
    })
  })
})
