import { beforeEach, describe, expect, it, vi } from 'vitest'

import { handleConfigGet } from './handle-config-get.mts'
import {
  createErrorResult,
  createSuccessResult,
} from '../../../test/helpers/mocks.mts'

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

    const mockResult = createSuccessResult('test-token')
    vi.mocked(getConfigValue).mockReturnValue(mockResult)

    await handleConfigGet({
      key: 'apiToken',
      outputKind: 'json',
    })

    expect(getConfigValue).toHaveBeenCalledWith('apiToken')
    expect(outputConfigGet).toHaveBeenCalledWith('apiToken', mockResult, 'json')
  })

  it('handles missing config value', async () => {
    const { getConfigValue } = await import('../../utils/config.mts')
    const { outputConfigGet } = await import('./output-config-get.mts')

    const mockResult = createErrorResult('Config value not found')
    vi.mocked(getConfigValue).mockReturnValue(mockResult)

    await handleConfigGet({
      key: 'org',
      outputKind: 'text',
    })

    expect(getConfigValue).toHaveBeenCalledWith('org')
    expect(outputConfigGet).toHaveBeenCalledWith('org', mockResult, 'text')
  })

  it('handles markdown output', async () => {
    const { getConfigValue } = await import('../../utils/config.mts')
    const { outputConfigGet } = await import('./output-config-get.mts')

    const mockResult = createSuccessResult('https://api.socket.dev')
    vi.mocked(getConfigValue).mockReturnValue(mockResult)

    await handleConfigGet({
      key: 'apiBaseUrl',
      outputKind: 'markdown',
    })

    expect(getConfigValue).toHaveBeenCalledWith('apiBaseUrl')
    expect(outputConfigGet).toHaveBeenCalledWith(
      'apiBaseUrl',
      mockResult,
      'markdown',
    )
  })

  it('handles different config keys', async () => {
    const { getConfigValue } = await import('../../utils/config.mts')
    const { outputConfigGet } = await import('./output-config-get.mts')

    const keys = ['apiToken', 'org', 'repoName', 'apiBaseUrl', 'apiProxy']

    for (const key of keys) {
      const mockResult = createSuccessResult(`value-for-${key}`)
      vi.mocked(getConfigValue).mockReturnValue(mockResult)

      // eslint-disable-next-line no-await-in-loop
      await handleConfigGet({
        key: key as any,
        outputKind: 'json',
      })

      expect(getConfigValue).toHaveBeenCalledWith(key)
      expect(outputConfigGet).toHaveBeenCalledWith(key, mockResult, 'json')
    }
  })

  it('handles empty config value', async () => {
    const { getConfigValue } = await import('../../utils/config.mts')
    const { outputConfigGet } = await import('./output-config-get.mts')

    const mockResult = createSuccessResult('')
    vi.mocked(getConfigValue).mockReturnValue(mockResult)

    await handleConfigGet({
      key: 'apiToken',
      outputKind: 'json',
    })

    expect(outputConfigGet).toHaveBeenCalledWith('apiToken', mockResult, 'json')
  })

  it('handles undefined config value', async () => {
    const { getConfigValue } = await import('../../utils/config.mts')
    const { outputConfigGet } = await import('./output-config-get.mts')

    const mockResult = createSuccessResult(undefined)
    vi.mocked(getConfigValue).mockReturnValue(mockResult)

    await handleConfigGet({
      key: 'org',
      outputKind: 'text',
    })

    expect(outputConfigGet).toHaveBeenCalledWith('org', mockResult, 'text')
  })
})
