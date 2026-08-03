/**
 * Unit tests for `defineHandoffCommand` help text rendering.
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

vi.mock(import('../../../../src/util/cli/with-subcommands.mts'), () => ({
  meowOrExit: mockMeowOrExit,
}))

vi.mock(import('../../../../src/util/dlx/spawn.mts'), () => ({
  spawnSfw: mockSpawnSfw,
  spawnSfwDlx: mockSpawnSfwDlx,
}))

vi.mock(import('../../../../src/util/dry-run/output.mts'), () => ({
  outputDryRunExecute: mockOutputDryRunExecute,
}))

vi.mock(import('../../../../src/util/process/cmd.mts'), () => ({
  filterFlags: mockFilterFlags,
}))

vi.mock(import('../../../../src/util/telemetry/integration.mts'), () => ({
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
