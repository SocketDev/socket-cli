import updateNotifier from 'tiny-updater'
import { describe, expect, it, vi } from 'vitest'

import { runSelfUpdateCheck } from './self-update.mts'

vi.mock('tiny-updater', () => ({
  default: vi.fn(async () => false),
}))

describe('runSelfUpdateCheck', () => {
  it('checks the public npm registry', async () => {
    await runSelfUpdateCheck()

    expect(updateNotifier).toHaveBeenCalledTimes(1)
    const options = vi.mocked(updateNotifier).mock.calls[0]![0]
    expect(options.registryUrl).toBe('https://registry.npmjs.org/')
    expect('authInfo' in options).toBe(false)
  })
})
