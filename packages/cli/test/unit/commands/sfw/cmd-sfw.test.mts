import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cmdSfw } from '../../../../src/commands/sfw/cmd-sfw.mts'

const noChildExitCode: number | null = null
const noChildSignal: NodeJS.Signals | null = null

const runFirewallCommand = vi.hoisted(() => vi.fn())
const runFirewallCaCommand = vi.hoisted(() => vi.fn())
vi.mock(import('../../../../src/util/firewall/ca-command.mts'), () => ({
  runFirewallCaCommand,
}))
vi.mock(import('../../../../src/util/firewall/run.mts'), () => ({
  runFirewallCommand,
}))

const context = { parentName: 'socket' }
describe('explicit firewall command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    runFirewallCommand.mockResolvedValue({ code: 0, signal: noChildSignal })
    process.exitCode = undefined
  })
  afterEach(() => {
    vi.restoreAllMocks()
    process.exitCode = undefined
  })
  it('preserves every flag after the executable', async () => {
    await cmdSfw.run(
      ['npm', '--help', '--version', '--verbose', '--dry-run'],
      import.meta,
      context,
    )
    expect(runFirewallCommand).toHaveBeenCalledWith(
      ['npm', '--help', '--version', '--verbose', '--dry-run'],
      { stdio: 'inherit' },
    )
  })
  it('rejects missing executable before invoking the runtime', async () => {
    await cmdSfw.run([], import.meta, context)
    expect(process.exitCode).toBe(2)
    expect(runFirewallCommand).not.toHaveBeenCalled()
  })
  it('supports wrapper dry run before the executable', async () => {
    await cmdSfw.run(['--dry-run', 'npm', 'install'], import.meta, context)
    expect(runFirewallCommand).not.toHaveBeenCalled()
  })
  it('routes CA subcommands without spawning a child', async () => {
    await cmdSfw.run(['ca', 'path', '--json'], import.meta, context)
    expect(runFirewallCaCommand).toHaveBeenCalledWith(['path', '--json'])
    expect(runFirewallCommand).not.toHaveBeenCalled()
  })
  it.each([0, 9])('forwards result %s', async code => {
    runFirewallCommand.mockResolvedValue({ code, signal: noChildSignal })
    await cmdSfw.run(['npm'], import.meta, context)
    expect(process.exitCode).toBe(code)
  })
  it('forwards signals after runtime cleanup', async () => {
    const kill = vi.spyOn(process, 'kill').mockReturnValue(true)
    runFirewallCommand.mockResolvedValue({
      code: noChildExitCode,
      signal: 'SIGTERM',
    })
    await cmdSfw.run(['npm'], import.meta, context)
    expect(kill).toHaveBeenCalledWith(process.pid, 'SIGTERM')
    expect(process.exitCode).toBe(143)
  })
})
