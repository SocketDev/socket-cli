import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cmdGem } from '../../../../src/commands/gem/cmd-gem.mts'

const noChildExitCode: number | null = null
const noChildSignal: NodeJS.Signals | null = null

const mocks = vi.hoisted(() => ({ run: vi.fn(), which: vi.fn() }))
vi.mock(import('../../../../src/util/firewall/run.mts'), () => ({
  runFirewallCommand: mocks.run,
}))
vi.mock(import('@socketsecurity/lib-stable/exe/path/which'), () => ({
  whichReal: mocks.which,
}))
vi.mock(import('../../../../src/util/telemetry/integration.mts'), () => ({
  trackSubprocessStart: vi.fn(async () => undefined),
  trackSubprocessExit: vi.fn(async () => undefined),
}))

const context = { parentName: 'socket' }
describe('gem firewall integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.run.mockResolvedValue({ code: 0, signal: noChildSignal })
    mocks.which.mockResolvedValue('/example/bin/gem')
    process.exitCode = undefined
  })
  afterEach(() => {
    vi.restoreAllMocks()
    process.exitCode = undefined
  })
  it('retains command metadata', () => {
    expect(cmdGem).toMatchObject({
      description: 'Run gem with Socket Firewall security',
      hidden: false,
      run: expect.any(Function),
    })
  })
  it.each([
    [],
    ['install', 'example-package'],
    ['install', 'example-package@1.2.3'],
    ['install', '--global', 'example-package'],
    ['exec', 'example-command'],
    ['update'],
    ['list'],
    ['freeze'],
    ['uninstall', 'example-package'],
    ['install', '-r', 'requirements.txt'],
    ['install', 'example-one', 'example-two'],
  ])('forwards child arguments %j', async (...args) => {
    await cmdGem.run(args, import.meta, context)
    expect(mocks.run).toHaveBeenCalledWith(['gem', ...args], {
      stdio: 'inherit',
    })
  })
  it('filters wrapper prefix flags and preserves child configuration', async () => {
    await cmdGem.run(
      ['--config', '{}', '--no-banner', 'install', '--config', 'child.json'],
      import.meta,
      context,
    )
    expect(mocks.run).toHaveBeenCalledWith(
      ['gem', 'install', '--config', 'child.json'],
      { stdio: 'inherit' },
    )
  })
  it('forwards child flags without interpreting them as wrapper flags', async () => {
    await cmdGem.run(['--help', '--version', '--verbose'], import.meta, context)
    expect(mocks.run).toHaveBeenCalledWith(
      ['gem', '--help', '--version', '--verbose'],
      { stdio: 'inherit' },
    )
  })
  it.each([0, 7])('propagates result %s after cleanup', async code => {
    mocks.run.mockResolvedValue({ code, signal: noChildSignal })
    await cmdGem.run(['install', 'example-package'], import.meta, context)
    expect(process.exitCode).toBe(code)
  })
  it.each(['SIGTERM', 'SIGINT'] as const)(
    'propagates %s after cleanup',
    async signal => {
      const kill = vi.spyOn(process, 'kill').mockReturnValue(true)
      mocks.run.mockResolvedValue({ code: noChildExitCode, signal })
      await cmdGem.run([], import.meta, context)
      expect(kill).toHaveBeenCalledWith(process.pid, signal)
    },
  )
  it('retains failure status when firewall setup rejects', async () => {
    mocks.run.mockRejectedValue(new Error('example setup failure'))
    await expect(cmdGem.run([], import.meta, context)).rejects.toBeInstanceOf(
      Error,
    )
    expect(process.exitCode).toBe(1)
  })
})
