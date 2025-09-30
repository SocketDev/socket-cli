import { beforeEach, describe, expect, it, vi } from 'vitest'

import { handleConfigSet } from './handle-config-set.mts'

// Mock the dependencies.
vi.mock('./output-config-set.mts', () => ({
  outputConfigSet: vi.fn(),
}))
vi.mock('../../utils/config.mts', () => ({
  updateConfigValue: vi.fn(),
}))

describe('handleConfigSet', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sets config value successfully', async () => {
    const { updateConfigValue } = await import('../../utils/config.mts')
    const { outputConfigSet } = await import('./output-config-set.mts')

    vi.mocked(updateConfigValue).mockReturnValue({
      ok: true,
      value: 'new-value',
    })

    await handleConfigSet({
      key: 'apiToken',
      outputKind: 'json',
      value: 'new-token-value',
    })

    expect(updateConfigValue).toHaveBeenCalledWith(
      'apiToken',
      'new-token-value',
    )
    expect(outputConfigSet).toHaveBeenCalledWith(
      { ok: true, value: 'new-value' },
      'json',
    )
  })

  it('handles config update failure', async () => {
    const { updateConfigValue } = await import('../../utils/config.mts')
    const { outputConfigSet } = await import('./output-config-set.mts')

    const error = new Error('Config update failed')
    vi.mocked(updateConfigValue).mockReturnValue({
      ok: false,
      error,
    })

    await handleConfigSet({
      key: 'org',
      outputKind: 'text',
      value: 'test-org',
    })

    expect(updateConfigValue).toHaveBeenCalledWith('org', 'test-org')
    expect(outputConfigSet).toHaveBeenCalledWith({ ok: false, error }, 'text')
  })

  it('handles markdown output', async () => {
    const { updateConfigValue } = await import('../../utils/config.mts')
    const { outputConfigSet } = await import('./output-config-set.mts')

    vi.mocked(updateConfigValue).mockReturnValue({
      ok: true,
      value: 'markdown-value',
    })

    await handleConfigSet({
      key: 'repoName',
      outputKind: 'markdown',
      value: 'my-repo',
    })

    expect(updateConfigValue).toHaveBeenCalledWith('repoName', 'my-repo')
    expect(outputConfigSet).toHaveBeenCalledWith(
      { ok: true, value: 'markdown-value' },
      'markdown',
    )
  })

  it('logs debug information', async () => {
    const { debugDir, debugFn } = await import(
      '@socketsecurity/registry/lib/debug'
    )
    const { updateConfigValue } = await import('../../utils/config.mts')

    vi.mocked(updateConfigValue).mockReturnValue({
      ok: true,
      value: 'debug-value',
    })

    await handleConfigSet({
      key: 'apiBaseUrl',
      outputKind: 'json',
      value: 'https://api.example.com',
    })

    expect(debugFn).toHaveBeenCalledWith(
      'notice',
      'Setting config apiBaseUrl = https://api.example.com',
    )
    expect(debugDir).toHaveBeenCalledWith('inspect', {
      key: 'apiBaseUrl',
      value: 'https://api.example.com',
      outputKind: 'json',
    })
    expect(debugFn).toHaveBeenCalledWith('notice', 'Config update succeeded')
  })

  it('logs debug information on failure', async () => {
    const { debugFn } = await import('@socketsecurity/registry/lib/debug')
    const { updateConfigValue } = await import('../../utils/config.mts')

    vi.mocked(updateConfigValue).mockReturnValue({
      ok: false,
      error: new Error('Failed'),
    })

    await handleConfigSet({
      key: 'apiToken',
      outputKind: 'json',
      value: 'bad-token',
    })

    expect(debugFn).toHaveBeenCalledWith('notice', 'Config update failed')
  })

  it('handles different config keys', async () => {
    const { updateConfigValue } = await import('../../utils/config.mts')
    const { outputConfigSet } = await import('./output-config-set.mts')

    const keys = ['apiToken', 'org', 'repoName', 'apiBaseUrl', 'apiProxy']

    for (const key of keys) {
      vi.mocked(updateConfigValue).mockReturnValue({
        ok: true,
        value: `value-for-${key}`,
      })

      // eslint-disable-next-line no-await-in-loop
      await handleConfigSet({
        key: key as any,
        outputKind: 'json',
        value: `test-${key}`,
      })

      expect(updateConfigValue).toHaveBeenCalledWith(key, `test-${key}`)
    }
  })
})
