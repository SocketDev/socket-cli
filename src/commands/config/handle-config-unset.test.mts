import { beforeEach, describe, expect, it, vi } from 'vitest'

import { handleConfigUnset } from './handle-config-unset.mts'

// Mock the dependencies.
vi.mock('./output-config-unset.mts', () => ({
  outputConfigUnset: vi.fn(),
}))
vi.mock('../../utils/config.mts', () => ({
  updateConfigValue: vi.fn(),
}))

describe('handleConfigUnset', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('unsets config value successfully', async () => {
    const { updateConfigValue } = await import('../../utils/config.mts')
    const { outputConfigUnset } = await import('./output-config-unset.mts')

    vi.mocked(updateConfigValue).mockReturnValue({
      ok: true,
      value: undefined,
    })

    await handleConfigUnset({
      key: 'apiToken',
      outputKind: 'json',
    })

    expect(updateConfigValue).toHaveBeenCalledWith('apiToken', undefined)
    expect(outputConfigUnset).toHaveBeenCalledWith(
      { ok: true, value: undefined },
      'json',
    )
  })

  it('handles unset failure', async () => {
    const { updateConfigValue } = await import('../../utils/config.mts')
    const { outputConfigUnset } = await import('./output-config-unset.mts')

    const error = new Error('Cannot unset config')
    vi.mocked(updateConfigValue).mockReturnValue({
      ok: false,
      error,
    })

    await handleConfigUnset({
      key: 'org',
      outputKind: 'text',
    })

    expect(updateConfigValue).toHaveBeenCalledWith('org', undefined)
    expect(outputConfigUnset).toHaveBeenCalledWith({ ok: false, error }, 'text')
  })

  it('handles markdown output', async () => {
    const { updateConfigValue } = await import('../../utils/config.mts')
    const { outputConfigUnset } = await import('./output-config-unset.mts')

    vi.mocked(updateConfigValue).mockReturnValue({
      ok: true,
      value: undefined,
    })

    await handleConfigUnset({
      key: 'repoName',
      outputKind: 'markdown',
    })

    expect(updateConfigValue).toHaveBeenCalledWith('repoName', undefined)
    expect(outputConfigUnset).toHaveBeenCalledWith(
      { ok: true, value: undefined },
      'markdown',
    )
  })

  it('handles different config keys', async () => {
    const { updateConfigValue } = await import('../../utils/config.mts')
    const { outputConfigUnset } = await import('./output-config-unset.mts')

    const keys = ['apiToken', 'org', 'repoName', 'apiBaseUrl', 'apiProxy']

    for (const key of keys) {
      vi.mocked(updateConfigValue).mockReturnValue({
        ok: true,
        value: undefined,
      })

      // eslint-disable-next-line no-await-in-loop
      await handleConfigUnset({
        key: key as any,
        outputKind: 'json',
      })

      expect(updateConfigValue).toHaveBeenCalledWith(key, undefined)
      expect(outputConfigUnset).toHaveBeenCalledWith(
        { ok: true, value: undefined },
        'json',
      )
    }
  })

  it('handles text output', async () => {
    const { updateConfigValue } = await import('../../utils/config.mts')
    const { outputConfigUnset } = await import('./output-config-unset.mts')

    vi.mocked(updateConfigValue).mockReturnValue({
      ok: true,
      value: undefined,
    })

    await handleConfigUnset({
      key: 'apiToken',
      outputKind: 'text',
    })

    expect(outputConfigUnset).toHaveBeenCalledWith(
      { ok: true, value: undefined },
      'text',
    )
  })

  it('handles already unset config value', async () => {
    const { updateConfigValue } = await import('../../utils/config.mts')
    const { outputConfigUnset } = await import('./output-config-unset.mts')

    // Even if already unset, the function should still succeed.
    vi.mocked(updateConfigValue).mockReturnValue({
      ok: true,
      value: undefined,
    })

    await handleConfigUnset({
      key: 'org',
      outputKind: 'json',
    })

    expect(updateConfigValue).toHaveBeenCalledWith('org', undefined)
    expect(outputConfigUnset).toHaveBeenCalledWith(
      { ok: true, value: undefined },
      'json',
    )
  })
})
