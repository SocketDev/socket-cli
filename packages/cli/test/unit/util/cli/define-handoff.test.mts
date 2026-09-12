import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineHandoffCommand } from '../../../../src/util/cli/define-handoff.mts'

const noChildExitCode: number | null = null
const noChildSignal: NodeJS.Signals | null = null

const mocks = vi.hoisted(() => ({
  run: vi.fn(),
  start: vi.fn(),
  end: vi.fn(),
  dry: vi.fn(),
}))
vi.mock(import('../../../../src/util/firewall/run.mts'), () => ({
  runFirewallCommand: mocks.run,
}))
vi.mock(import('../../../../src/util/telemetry/integration.mts'), () => ({
  trackSubprocessStart: mocks.start,
  trackSubprocessExit: mocks.end,
}))
vi.mock(import('../../../../src/util/dry-run/output.mts'), () => ({
  outputDryRunExecute: mocks.dry,
}))

const context = { parentName: 'socket' }
function makeCommand(options = {}) {
  return defineHandoffCommand({
    name: 'cargo',
    description: 'Run cargo',
    examples: ['build'],
    ...options,
  })
}
describe('firewall handoff lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.run.mockResolvedValue({ code: 0, signal: noChildSignal })
    mocks.start.mockResolvedValue(123)
    mocks.end.mockResolvedValue(undefined)
    process.exitCode = undefined
  })
  afterEach(() => {
    vi.restoreAllMocks()
    process.exitCode = undefined
  })
  it('preserves description and visibility', () => {
    expect(makeCommand()).toMatchObject({
      description: 'Run cargo',
      hidden: false,
    })
    expect(makeCommand({ hidden: true }).hidden).toBe(true)
  })
  it('uses the selected executable', async () => {
    await makeCommand({ binaryPicker: async () => 'cargo-custom' }).run(
      ['build'],
      import.meta,
      context,
    )
    expect(mocks.run).toHaveBeenCalledWith(['cargo-custom', 'build'], {
      stdio: 'inherit',
    })
  })
  it('does not start a child during dry run', async () => {
    await makeCommand().run(['--dry-run', 'build'], import.meta, context)
    expect(mocks.run).not.toHaveBeenCalled()
    expect(mocks.dry).toHaveBeenCalledWith(
      'sfw',
      ['cargo', 'build'],
      expect.any(String),
    )
  })
  it('preserves child dry run after the child subcommand', async () => {
    await makeCommand().run(['build', '--dry-run'], import.meta, context)
    expect(mocks.run).toHaveBeenCalledWith(['cargo', 'build', '--dry-run'], {
      stdio: 'inherit',
    })
  })
  it('waits for cleanup before setting status or recording completion', async () => {
    const completion = Promise.withResolvers<{ code: number; signal: null }>()
    mocks.run.mockReturnValue(completion.promise)
    const running = makeCommand().run(['build'], import.meta, context)
    await vi.waitFor(() => expect(mocks.run).toHaveBeenCalled())
    expect(process.exitCode).toBe(1)
    expect(mocks.end).not.toHaveBeenCalled()
    completion.resolve({ code: 7, signal: noChildSignal })
    await running
    expect(process.exitCode).toBe(7)
    expect(mocks.end).toHaveBeenCalledWith('cargo', 123, 7)
  })
  it('preserves status when recording completion fails', async () => {
    mocks.end.mockRejectedValue(new Error('example reporting failure'))
    await makeCommand().run([], import.meta, context)
    expect(process.exitCode).toBe(0)
  })
  it('skips disabled telemetry', async () => {
    await makeCommand({ trackTelemetry: false }).run([], import.meta, context)
    expect(mocks.start).not.toHaveBeenCalled()
    expect(mocks.end).not.toHaveBeenCalled()
  })
  it('preserves child dry-run when wrapper dry-run is disabled', async () => {
    await makeCommand({ supportDryRun: false }).run(
      ['--dry-run'],
      import.meta,
      context,
    )
    expect(mocks.dry).not.toHaveBeenCalled()
    expect(mocks.run).toHaveBeenCalledWith(['cargo', '--dry-run'], {
      stdio: 'inherit',
    })
  })
  it('retains nonzero status when signal delivery is intercepted', async () => {
    const kill = vi.spyOn(process, 'kill').mockReturnValue(true)
    mocks.run.mockResolvedValue({ code: noChildExitCode, signal: 'SIGTERM' })
    await makeCommand().run([], import.meta, context)
    expect(kill).toHaveBeenCalledWith(process.pid, 'SIGTERM')
    expect(process.exitCode).toBe(143)
  })
  it('retains failure for an indeterminate child result', async () => {
    const kill = vi.spyOn(process, 'kill').mockReturnValue(true)
    mocks.run.mockResolvedValue({
      code: noChildExitCode,
      signal: noChildSignal,
    })
    await makeCommand().run([], import.meta, context)
    expect(process.exitCode).toBe(1)
    expect(kill).not.toHaveBeenCalled()
  })
})
