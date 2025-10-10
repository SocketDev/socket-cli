import { describe, expect, it, vi } from 'vitest'

import { handleConfigAuto } from './handle-config-auto.mts'

// Mock the dependencies
vi.mock('./discover-config-value.mts', () => ({
  discoverConfigValue: vi.fn(),
}))

vi.mock('./output-config-auto.mts', () => ({
  outputConfigAuto: vi.fn(),
}))

describe('handleConfigAuto', () => {
  it('discovers and outputs config value successfully', async () => {
    const { discoverConfigValue } = await import('./discover-config-value.mts')
    const { outputConfigAuto } = await import('./output-config-auto.mts')
    const mockDiscover = vi.mocked(discoverConfigValue)
    const mockOutput = vi.mocked(outputConfigAuto)

    const mockResult = {
      ok: true,
      data: 'discovered-api-token',
      source: 'environment',
    }
    mockDiscover.mockResolvedValue(mockResult)

    await handleConfigAuto({ key: 'apiToken', outputKind: 'json' })

    expect(mockDiscover).toHaveBeenCalledWith('apiToken')
    expect(mockOutput).toHaveBeenCalledWith('apiToken', mockResult, 'json')
  })

  it('handles discovery failure', async () => {
    const { discoverConfigValue } = await import('./discover-config-value.mts')
    const { outputConfigAuto } = await import('./output-config-auto.mts')
    const mockDiscover = vi.mocked(discoverConfigValue)
    const mockOutput = vi.mocked(outputConfigAuto)

    const mockResult = {
      ok: false,
      error: 'Config not found',
    }
    mockDiscover.mockResolvedValue(mockResult)

    await handleConfigAuto({ key: 'orgSlug', outputKind: 'text' })

    expect(mockDiscover).toHaveBeenCalledWith('orgSlug')
    expect(mockOutput).toHaveBeenCalledWith('orgSlug', mockResult, 'text')
  })

  it('handles markdown output format', async () => {
    const { discoverConfigValue } = await import('./discover-config-value.mts')
    const { outputConfigAuto } = await import('./output-config-auto.mts')
    const mockDiscover = vi.mocked(discoverConfigValue)
    const mockOutput = vi.mocked(outputConfigAuto)

    mockDiscover.mockResolvedValue({ ok: true, data: 'test-value' })

    await handleConfigAuto({ key: 'orgId', outputKind: 'markdown' })

    expect(mockOutput).toHaveBeenCalledWith(
      'orgId',
      expect.any(Object),
      'markdown',
    )
  })

  it('handles different config keys', async () => {
    const { discoverConfigValue } = await import('./discover-config-value.mts')
    const { outputConfigAuto } = await import('./output-config-auto.mts')
    const mockDiscover = vi.mocked(discoverConfigValue)
    const mockOutput = vi.mocked(outputConfigAuto)

    const keys = ['apiToken', 'apiUrl', 'orgId', 'orgSlug'] as const

    for (const key of keys) {
      mockDiscover.mockResolvedValue({ ok: true, data: `${key}-value` })
      // eslint-disable-next-line no-await-in-loop
      await handleConfigAuto({ key, outputKind: 'json' })
      expect(mockDiscover).toHaveBeenCalledWith(key)
    }
  })

  it('handles text output format', async () => {
    const { discoverConfigValue } = await import('./discover-config-value.mts')
    const { outputConfigAuto } = await import('./output-config-auto.mts')
    const mockDiscover = vi.mocked(discoverConfigValue)
    const mockOutput = vi.mocked(outputConfigAuto)

    mockDiscover.mockResolvedValue({
      ok: true,
      data: 'https://api.socket.dev',
      source: 'config file',
    })

    await handleConfigAuto({ key: 'apiUrl', outputKind: 'text' })

    expect(mockOutput).toHaveBeenCalledWith(
      'apiUrl',
      expect.objectContaining({
        ok: true,
        data: 'https://api.socket.dev',
      }),
      'text',
    )
  })
})
