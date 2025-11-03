import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createErrorResult,
  createSuccessResult,
} from '../../../../../test/helpers/mocks.mts'
import { handleConfigSet } from '../../../../src/src/commands/config/handle-config-set.mts'

const mockLogger = vi.hoisted(() => ({
  fail: vi.fn(),
  info: vi.fn(),
  log: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
}))

// Mock the dependencies.
const mockOutputConfigSet = vi.hoisted(() => vi.fn())
const mockUpdateConfigValue = vi.hoisted(() => vi.fn())
const mockDebug = vi.hoisted(() => vi.fn())
const mockDebugDir = vi.hoisted(() => vi.fn())
const mockIsDebug = vi.hoisted(() => vi.fn(())

vi.mock('@socketsecurity/lib/logger', () => ({
  getDefaultLogger: () => mockLogger,
  logger: mockLogger,
}))

vi.mock('../../../../../src/commands/config/output-config-set.mts', () => ({
  outputConfigSet: mockOutputConfigSet,
}))
vi.mock('../../../../../src/utils/config.mts', () => ({
  updateConfigValue: mockUpdateConfigValue,
}))
vi.mock('@socketsecurity/lib/debug', () => ({
  debug: mockDebug,
  debugDir: mockDebugDir,
  isDebug: mockIsDebug => false),
}))

describe('handleConfigSet', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sets config value successfully', async () => {
    const { updateConfigValue } = await import('../../../../../src/utils/config.mts')
    const { outputConfigSet } = await import('../../../../../src/commands/config/output-config-set.mts')

    const mockResult = createSuccessResult('new-value')
    mockUpdateConfigValue.mockReturnValue(mockResult)

    await handleConfigSet({
      key: 'apiToken',
      outputKind: 'json',
      value: 'new-token-value',
    })

    expect(updateConfigValue).toHaveBeenCalledWith(
      'apiToken',
      'new-token-value',
    )
    expect(outputConfigSet).toHaveBeenCalledWith(mockResult, 'json')
  })

  it('handles config update failure', async () => {
    const { updateConfigValue } = await import('../../../../../src/utils/config.mts')
    const { outputConfigSet } = await import('../../../../../src/commands/config/output-config-set.mts')

    const mockResult = createErrorResult('Config update failed')
    mockUpdateConfigValue.mockReturnValue(mockResult)

    await handleConfigSet({
      key: 'org',
      outputKind: 'text',
      value: 'test-org',
    })

    expect(updateConfigValue).toHaveBeenCalledWith('org', 'test-org')
    expect(outputConfigSet).toHaveBeenCalledWith(mockResult, 'text')
  })

  it('handles markdown output', async () => {
    const { updateConfigValue } = await import('../../../../../src/utils/config.mts')
    const { outputConfigSet } = await import('../../../../../src/commands/config/output-config-set.mts')

    const mockResult = createSuccessResult('markdown-value')
    mockUpdateConfigValue.mockReturnValue(mockResult)

    await handleConfigSet({
      key: 'repoName',
      outputKind: 'markdown',
      value: 'my-repo',
    })

    expect(updateConfigValue).toHaveBeenCalledWith('repoName', 'my-repo')
    expect(outputConfigSet).toHaveBeenCalledWith(mockResult, 'markdown')
  })

  it('logs debug information', async () => {
    const { debug, debugDir } = await import('@socketsecurity/lib/debug')
    const { updateConfigValue } = await import('../../../../../src/utils/config.mts')

    mockUpdateConfigValue.mockReturnValue(
      createSuccessResult('debug-value'),
    )

    await handleConfigSet({
      key: 'apiBaseUrl',
      outputKind: 'json',
      value: 'https://api.example.com',
    })

    expect(debug).toHaveBeenCalledWith(
      'Setting config apiBaseUrl = https://api.example.com',
    )
    expect(debugDir).toHaveBeenCalledWith({
      key: 'apiBaseUrl',
      value: 'https://api.example.com',
      outputKind: 'json',
    })
    expect(debug).toHaveBeenCalledWith('Config update succeeded')
  })

  it('logs debug information on failure', async () => {
    const { debug } = await import('@socketsecurity/lib/debug')
    const { updateConfigValue } = await import('../../../../../src/utils/config.mts')

    mockUpdateConfigValue.mockReturnValue(createErrorResult('Failed'))

    await handleConfigSet({
      key: 'apiToken',
      outputKind: 'json',
      value: 'bad-token',
    })

    expect(debug).toHaveBeenCalledWith('Config update failed')
  })

  it('handles different config keys', async () => {
    const { updateConfigValue } = await import('../../../../../src/utils/config.mts')

    const keys = ['apiToken', 'org', 'repoName', 'apiBaseUrl', 'apiProxy']

    for (const key of keys) {
      mockUpdateConfigValue.mockReturnValue(
        createSuccessResult(`value-for-${key}`),
      )

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
