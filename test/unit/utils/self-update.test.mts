import updateNotifier from 'tiny-updater'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { isStandaloneSea } from '../../../src/sea/runtime.mts'
import {
  formatUpdateNotice,
  runSelfUpdateCheck,
} from '../../../src/utils/self-update.mts'

const { loggerLog } = vi.hoisted(() => ({ loggerLog: vi.fn() }))

vi.mock('tiny-updater', () => ({
  default: vi.fn(async () => false),
}))

vi.mock('../../../src/sea/runtime.mts', () => ({
  isStandaloneSea: vi.fn(() => false),
}))

vi.mock('@socketsecurity/registry/lib/logger', () => ({
  logger: { log: loggerLog },
}))

describe('formatUpdateNotice', () => {
  it('uses package manager guidance for npm installations', () => {
    vi.mocked(isStandaloneSea).mockReturnValue(false)
    expect(formatUpdateNotice('1.0.0', '1.1.0')).toBe(
      'Socket 1.0.0 → 1.1.0. Update with your favorite package manager.',
    )
  })

  it('uses the Socket update command for standalone SEA builds', () => {
    vi.mocked(isStandaloneSea).mockReturnValue(true)
    expect(formatUpdateNotice('1.0.0', '1.1.0')).toBe(
      'Socket 1.0.0 → 1.1.0. Run: socket update',
    )
  })
})

describe('runSelfUpdateCheck', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('checks the public npm registry', async () => {
    vi.stubEnv('NO_UPDATE_NOTIFIER', '')
    vi.stubEnv('SOCKET_CLI_FORCE_UPDATE_NOTIFIER', '')
    vi.mocked(isStandaloneSea).mockReturnValue(false)
    await runSelfUpdateCheck()

    expect(updateNotifier).toHaveBeenCalledTimes(1)
    const options = vi.mocked(updateNotifier).mock.calls[0]![0]
    expect(options.registryUrl).toBe('https://registry.npmjs.org/')
    expect(options.ttl).toBe(86_400_000)
    expect('authInfo' in options).toBe(false)
    options.logCallback?.('socket', '1.0.0', '1.1.0')
    expect(loggerLog).toHaveBeenCalledExactlyOnceWith(
      'Socket 1.0.0 → 1.1.0. Update with your favorite package manager.',
    )
  })

  it('skips the npm registry check in a standalone SEA build', async () => {
    vi.stubEnv('NO_UPDATE_NOTIFIER', '')
    vi.stubEnv('SOCKET_CLI_FORCE_UPDATE_NOTIFIER', '1')
    vi.mocked(updateNotifier).mockClear()
    vi.mocked(isStandaloneSea).mockReturnValue(true)
    await runSelfUpdateCheck()
    expect(updateNotifier).not.toHaveBeenCalled()
  })

  it('bypasses the notifier cache when forced', async () => {
    vi.stubEnv('NO_UPDATE_NOTIFIER', '')
    vi.stubEnv('SOCKET_CLI_FORCE_UPDATE_NOTIFIER', '1')
    vi.mocked(isStandaloneSea).mockReturnValue(false)
    vi.mocked(updateNotifier).mockClear()

    await runSelfUpdateCheck()

    expect(updateNotifier).toHaveBeenCalledOnce()
    expect(vi.mocked(updateNotifier).mock.calls[0]![0].ttl).toBe(0)
  })

  it('suppresses the update check when NO_UPDATE_NOTIFIER is set', async () => {
    vi.stubEnv('NO_UPDATE_NOTIFIER', '1')
    vi.stubEnv('SOCKET_CLI_FORCE_UPDATE_NOTIFIER', '1')
    vi.mocked(isStandaloneSea).mockReturnValue(false)
    vi.mocked(updateNotifier).mockClear()
    vi.mocked(loggerLog).mockClear()

    await runSelfUpdateCheck()

    expect(updateNotifier).not.toHaveBeenCalled()
    expect(loggerLog).not.toHaveBeenCalled()
  })
})
