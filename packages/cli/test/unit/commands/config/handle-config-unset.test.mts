import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createErrorResult,
  createSuccessResult,
} from '../../../../../test/helpers/mocks.mts'
import { handleConfigUnset } from '../../../../src/src/commands/config/handle-config-unset.mts'

const mockLogger = vi.hoisted(() => ({
  fail: vi.fn(),
  info: vi.fn(),
  log: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
}))

// Mock the dependencies.
const mockOutputConfigUnset = vi.hoisted(() => vi.fn())
const mockUpdateConfigValue = vi.hoisted(() => vi.fn())

vi.mock('@socketsecurity/lib/logger', () => ({
  getDefaultLogger: () => mockLogger,
  logger: mockLogger,
}))

vi.mock('../../../../../src/commands/config/output-config-unset.mts', () => ({
  outputConfigUnset: mockOutputConfigUnset,
}))
vi.mock('../../../../../src/utils/config.mts', () => ({
  updateConfigValue: mockUpdateConfigValue,
}))

describe('handleConfigUnset', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('unsets config value successfully', async () => {
    const { updateConfigValue } = await import('../../../../../src/utils/config.mts')
    const { outputConfigUnset } = await import('../../../../../src/commands/config/output-config-unset.mts')

    const mockResult = createSuccessResult(undefined)
    mockUpdateConfigValue.mockReturnValue(mockResult)

    await handleConfigUnset({
      key: 'apiToken',
      outputKind: 'json',
    })

    expect(updateConfigValue).toHaveBeenCalledWith('apiToken', undefined)
    expect(outputConfigUnset).toHaveBeenCalledWith(mockResult, 'json')
  })

  it('handles unset failure', async () => {
    const { updateConfigValue } = await import('../../../../../src/utils/config.mts')
    const { outputConfigUnset } = await import('../../../../../src/commands/config/output-config-unset.mts')

    const mockResult = createErrorResult('Cannot unset config')
    mockUpdateConfigValue.mockReturnValue(mockResult)

    await handleConfigUnset({
      key: 'org',
      outputKind: 'text',
    })

    expect(updateConfigValue).toHaveBeenCalledWith('org', undefined)
    expect(outputConfigUnset).toHaveBeenCalledWith(mockResult, 'text')
  })

  it('handles markdown output', async () => {
    const { updateConfigValue } = await import('../../../../../src/utils/config.mts')
    const { outputConfigUnset } = await import('../../../../../src/commands/config/output-config-unset.mts')

    const mockResult = createSuccessResult(undefined)
    mockUpdateConfigValue.mockReturnValue(mockResult)

    await handleConfigUnset({
      key: 'repoName',
      outputKind: 'markdown',
    })

    expect(updateConfigValue).toHaveBeenCalledWith('repoName', undefined)
    expect(outputConfigUnset).toHaveBeenCalledWith(mockResult, 'markdown')
  })

  it('handles different config keys', async () => {
    const { updateConfigValue } = await import('../../../../../src/utils/config.mts')
    const { outputConfigUnset } = await import('../../../../../src/commands/config/output-config-unset.mts')

    const keys = ['apiToken', 'org', 'repoName', 'apiBaseUrl', 'apiProxy']

    for (const key of keys) {
      const mockResult = createSuccessResult(undefined)
      mockUpdateConfigValue.mockReturnValue(mockResult)

      // eslint-disable-next-line no-await-in-loop
      await handleConfigUnset({
        key: key as any,
        outputKind: 'json',
      })

      expect(updateConfigValue).toHaveBeenCalledWith(key, undefined)
      expect(outputConfigUnset).toHaveBeenCalledWith(mockResult, 'json')
    }
  })

  it('handles text output', async () => {
    const { updateConfigValue } = await import('../../../../../src/utils/config.mts')
    const { outputConfigUnset } = await import('../../../../../src/commands/config/output-config-unset.mts')

    const mockResult = createSuccessResult(undefined)
    mockUpdateConfigValue.mockReturnValue(mockResult)

    await handleConfigUnset({
      key: 'apiToken',
      outputKind: 'text',
    })

    expect(outputConfigUnset).toHaveBeenCalledWith(mockResult, 'text')
  })

  it('handles already unset config value', async () => {
    const { updateConfigValue } = await import('../../../../../src/utils/config.mts')
    const { outputConfigUnset } = await import('../../../../../src/commands/config/output-config-unset.mts')

    // Even if already unset, the function should still succeed.
    const mockResult = createSuccessResult(undefined)
    mockUpdateConfigValue.mockReturnValue(mockResult)

    await handleConfigUnset({
      key: 'org',
      outputKind: 'json',
    })

    expect(updateConfigValue).toHaveBeenCalledWith('org', undefined)
    expect(outputConfigUnset).toHaveBeenCalledWith(mockResult, 'json')
  })
})
