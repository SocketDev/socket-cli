/**
 * Unit tests for config get handler.
 *
 * Tests the handler that retrieves configuration values from the config file.
 * This command reads existing config without auto-discovery.
 *
 * Test Coverage:
 * - Successful config value retrieval
 * - Missing config value handling
 * - Different config keys (apiToken, orgSlug, etc.)
 * - Multiple output kinds (json, text, markdown)
 * - Output function integration
 *
 * Testing Approach:
 * - Mock getConfigValue from utils/config.mts
 * - Mock outputConfigGet for output verification
 * - Mock logger for error/success messages
 * - Use createSuccessResult/createErrorResult helpers
 * - Test CResult pattern flow
 *
 * Related Files:
 * - src/commands/config/handle-config-get.mts - Implementation
 * - src/utils/config.mts - Config file utilities
 * - src/commands/config/output-config-get.mts - Output formatter
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { handleConfigGet } from '../../../../src/commands/config/handle-config-get.mts'
import {
  createErrorResult,
  createSuccessResult,
} from '../../../helpers/mocks.mts'

const mockLogger = vi.hoisted(() => ({
  fail: vi.fn(),
  info: vi.fn(),
  log: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
}))

// Mock the dependencies.
const mockOutputConfigGet = vi.hoisted(() => vi.fn())
const mockGetConfigValue = vi.hoisted(() => vi.fn())

vi.mock('@socketsecurity/lib/logger', () => ({
  getDefaultLogger: () => mockLogger,
  logger: mockLogger,
}))

vi.mock('../../../../src/commands/config/output-config-get.mts', () => ({
  outputConfigGet: mockOutputConfigGet,
}))
vi.mock('../../../../src/utils/config.mts', () => ({
  getConfigValue: mockGetConfigValue,
}))

describe('handleConfigGet', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('gets config value successfully', async () => {
    const { getConfigValue } = await import('../../../../src/utils/config.mts')
    const { outputConfigGet } = await import(
      '../../../../src/commands/config/output-config-get.mts'
    )

    const mockResult = createSuccessResult('test-token')
    mockGetConfigValue.mockReturnValue(mockResult)

    await handleConfigGet({
      key: 'apiToken',
      outputKind: 'json',
    })

    expect(getConfigValue).toHaveBeenCalledWith('apiToken')
    expect(outputConfigGet).toHaveBeenCalledWith('apiToken', mockResult, 'json')
  })

  it('handles missing config value', async () => {
    const { getConfigValue } = await import('../../../../src/utils/config.mts')
    const { outputConfigGet } = await import(
      '../../../../src/commands/config/output-config-get.mts'
    )

    const mockResult = createErrorResult('Config value not found')
    mockGetConfigValue.mockReturnValue(mockResult)

    await handleConfigGet({
      key: 'org',
      outputKind: 'text',
    })

    expect(getConfigValue).toHaveBeenCalledWith('org')
    expect(outputConfigGet).toHaveBeenCalledWith('org', mockResult, 'text')
  })

  it('handles markdown output', async () => {
    const { getConfigValue } = await import('../../../../src/utils/config.mts')
    const { outputConfigGet } = await import(
      '../../../../src/commands/config/output-config-get.mts'
    )

    const mockResult = createSuccessResult('https://api.socket.dev')
    mockGetConfigValue.mockReturnValue(mockResult)

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
    const { getConfigValue } = await import('../../../../src/utils/config.mts')
    const { outputConfigGet } = await import(
      '../../../../src/commands/config/output-config-get.mts'
    )

    const keys = ['apiToken', 'org', 'repoName', 'apiBaseUrl', 'apiProxy']

    for (const key of keys) {
      const mockResult = createSuccessResult(`value-for-${key}`)
      mockGetConfigValue.mockReturnValue(mockResult)

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
    const { outputConfigGet } = await import(
      '../../../../src/commands/config/output-config-get.mts'
    )

    const mockResult = createSuccessResult('')
    mockGetConfigValue.mockReturnValue(mockResult)

    await handleConfigGet({
      key: 'apiToken',
      outputKind: 'json',
    })

    expect(outputConfigGet).toHaveBeenCalledWith('apiToken', mockResult, 'json')
  })

  it('handles undefined config value', async () => {
    const { outputConfigGet } = await import(
      '../../../../src/commands/config/output-config-get.mts'
    )

    const mockResult = createSuccessResult(undefined)
    mockGetConfigValue.mockReturnValue(mockResult)

    await handleConfigGet({
      key: 'org',
      outputKind: 'text',
    })

    expect(outputConfigGet).toHaveBeenCalledWith('org', mockResult, 'text')
  })
})
