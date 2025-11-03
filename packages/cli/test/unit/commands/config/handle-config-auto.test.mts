import { describe, expect, it, vi } from 'vitest'

import {
  createErrorResult,
  createSuccessResult,
} from '../../../../../test/helpers/mocks.mts'
import { handleConfigAuto } from '../../../../../src/commands/config/handle-config-auto.mts'

const mockLogger = vi.hoisted(() => ({
  fail: vi.fn(),
  info: vi.fn(),
  log: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
}))

// Mock the dependencies.
vi.mock('@socketsecurity/lib/logger', () => ({
  getDefaultLogger: () => mockLogger,
  logger: mockLogger,
}))

vi.mock('../../../../../src/commands/config/discover-config-value.mts', () => ({
  discoverConfigValue: vi.fn(),
}))

vi.mock('../../../../../src/commands/config/output-config-auto.mts', () => ({
  outputConfigAuto: vi.fn(),
}))

describe('handleConfigAuto', () => {
  it('discovers and outputs config value successfully', async () => {
    const { discoverConfigValue } = await import('../../../../../src/commands/config/discover-config-value.mts')
    const { outputConfigAuto } = await import('../../../../../src/commands/config/output-config-auto.mts')

    const mockResult = createSuccessResult('discovered-api-token')
    vi.mocked(discoverConfigValue).mockResolvedValue(mockResult)

    await handleConfigAuto({ key: 'apiToken', outputKind: 'json' })

    expect(discoverConfigValue).toHaveBeenCalledWith('apiToken')
    expect(outputConfigAuto).toHaveBeenCalledWith('apiToken', mockResult, 'json')
  })

  it('handles discovery failure', async () => {
    const { discoverConfigValue } = await import('../../../../../src/commands/config/discover-config-value.mts')
    const { outputConfigAuto } = await import('../../../../../src/commands/config/output-config-auto.mts')

    const mockResult = createErrorResult('Config not found')
    vi.mocked(discoverConfigValue).mockResolvedValue(mockResult)

    await handleConfigAuto({ key: 'orgSlug', outputKind: 'text' })

    expect(discoverConfigValue).toHaveBeenCalledWith('orgSlug')
    expect(outputConfigAuto).toHaveBeenCalledWith('orgSlug', mockResult, 'text')
  })

  it('handles markdown output format', async () => {
    const { discoverConfigValue } = await import('../../../../../src/commands/config/discover-config-value.mts')
    const { outputConfigAuto } = await import('../../../../../src/commands/config/output-config-auto.mts')

    vi.mocked(discoverConfigValue).mockResolvedValue(createSuccessResult('test-value'))

    await handleConfigAuto({ key: 'orgId', outputKind: 'markdown' })

    expect(outputConfigAuto).toHaveBeenCalledWith(
      'orgId',
      expect.any(Object),
      'markdown',
    )
  })

  it('handles different config keys', async () => {
    const { discoverConfigValue } = await import('../../../../../src/commands/config/discover-config-value.mts')

    const keys = ['apiToken', 'apiUrl', 'orgId', 'orgSlug'] as const

    for (const key of keys) {
      vi.mocked(discoverConfigValue).mockResolvedValue(createSuccessResult(`${key}-value`))
      // eslint-disable-next-line no-await-in-loop
      await handleConfigAuto({ key, outputKind: 'json' })
      expect(discoverConfigValue).toHaveBeenCalledWith(key)
    }
  })

  it('handles text output format', async () => {
    const { discoverConfigValue } = await import('../../../../../src/commands/config/discover-config-value.mts')
    const { outputConfigAuto } = await import('../../../../../src/commands/config/output-config-auto.mts')

    vi.mocked(discoverConfigValue).mockResolvedValue(
      createSuccessResult('https://api.socket.dev'),
    )

    await handleConfigAuto({ key: 'apiUrl', outputKind: 'text' })

    expect(outputConfigAuto).toHaveBeenCalledWith(
      'apiUrl',
      expect.objectContaining({
        ok: true,
        data: 'https://api.socket.dev',
      }),
      'text',
    )
  })
})
