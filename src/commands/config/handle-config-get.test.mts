import { beforeEach, describe, expect, it, vi } from 'vitest'

import { handleConfigGet } from './handle-config-get.mts'

// Mock the dependencies.
vi.mock('./output-config-get.mts', () => ({
  outputConfigGet: vi.fn(),
}))
vi.mock('../../utils/config.mts', () => ({
  getConfigValue: vi.fn(),
}))

describe('handleConfigGet', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('gets config value successfully', async () => {
    const { getConfigValue } = await import('../../utils/config.mts')
    const { outputConfigGet } = await import('./output-config-get.mts')

    vi.mocked(getConfigValue).mockReturnValue({
      ok: true,
      value: 'test-token',
    })

    await handleConfigGet({
      key: 'apiToken',
      outputKind: 'json',
    })

    expect(getConfigValue).toHaveBeenCalledWith('apiToken')
    expect(outputConfigGet).toHaveBeenCalledWith(
      'apiToken',
      { ok: true, value: 'test-token' },
      'json'
    )
  })

  it('handles missing config value', async () => {
    const { getConfigValue } = await import('../../utils/config.mts')
    const { outputConfigGet } = await import('./output-config-get.mts')

    vi.mocked(getConfigValue).mockReturnValue({
      ok: false,
      error: new Error('Config value not found'),
    })

    await handleConfigGet({
      key: 'org',
      outputKind: 'text',
    })

    expect(getConfigValue).toHaveBeenCalledWith('org')
    expect(outputConfigGet).toHaveBeenCalledWith(
      'org',
      { ok: false, error: new Error('Config value not found') },
      'text'
    )
  })

  it('handles markdown output', async () => {
    const { getConfigValue } = await import('../../utils/config.mts')
    const { outputConfigGet } = await import('./output-config-get.mts')

    vi.mocked(getConfigValue).mockReturnValue({
      ok: true,
      value: 'https://api.socket.dev',
    })

    await handleConfigGet({
      key: 'apiBaseUrl',
      outputKind: 'markdown',
    })

    expect(getConfigValue).toHaveBeenCalledWith('apiBaseUrl')
    expect(outputConfigGet).toHaveBeenCalledWith(
      'apiBaseUrl',
      { ok: true, value: 'https://api.socket.dev' },
      'markdown'
    )
  })

  it('handles different config keys', async () => {
    const { getConfigValue } = await import('../../utils/config.mts')
    const { outputConfigGet } = await import('./output-config-get.mts')

    const keys = ['apiToken', 'org', 'repoName', 'apiBaseUrl', 'apiProxy']

    for (const key of keys) {
      vi.mocked(getConfigValue).mockReturnValue({
        ok: true,
        value: `value-for-${key}`,
      })

      // eslint-disable-next-line no-await-in-loop
      await handleConfigGet({
        key: key as any,
        outputKind: 'json',
      })

      expect(getConfigValue).toHaveBeenCalledWith(key)
      expect(outputConfigGet).toHaveBeenCalledWith(
        key,
        { ok: true, value: `value-for-${key}` },
        'json'
      )
    }
  })

  it('handles empty config value', async () => {
    const { getConfigValue } = await import('../../utils/config.mts')
    const { outputConfigGet } = await import('./output-config-get.mts')

    vi.mocked(getConfigValue).mockReturnValue({
      ok: true,
      value: '',
    })

    await handleConfigGet({
      key: 'apiToken',
      outputKind: 'json',
    })

    expect(outputConfigGet).toHaveBeenCalledWith(
      'apiToken',
      { ok: true, value: '' },
      'json'
    )
  })

  it('handles undefined config value', async () => {
    const { getConfigValue } = await import('../../utils/config.mts')
    const { outputConfigGet } = await import('./output-config-get.mts')

    vi.mocked(getConfigValue).mockReturnValue({
      ok: true,
      value: undefined,
    })

    await handleConfigGet({
      key: 'org',
      outputKind: 'text',
    })

    expect(outputConfigGet).toHaveBeenCalledWith(
      'org',
      { ok: true, value: undefined },
      'text'
    )
  })
})