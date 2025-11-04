/**
 * Unit tests for config auto-discovery handler.
 *
 * Tests the handler that automatically discovers configuration values from various sources
 * (environment variables, config files, prompts, etc.).
 *
 * Test Coverage:
 * - Successful config value discovery
 * - Discovery failure handling
 * - Multiple config keys (apiToken, orgSlug, etc.)
 * - Different output kinds (json, text)
 * - Output function integration
 *
 * Testing Approach:
 * - Mock discoverConfigValue from discover-config-value.mts
 * - Mock outputConfigAuto for output verification
 * - Mock logger for error/success messages
 * - Use createSuccessResult/createErrorResult helpers
 * - Test CResult pattern flow
 *
 * Related Files:
 * - src/commands/config/handle-config-auto.mts - Implementation
 * - src/commands/config/discover-config-value.mts - Discovery logic
 * - src/commands/config/output-config-auto.mts - Output formatter
 */

import { describe, expect, it, vi } from 'vitest'

import {
  createErrorResult,
  createSuccessResult,
} from '../../../helpers/mocks.mts'
import { handleConfigAuto } from '../../../../src/commands/config/handle-config-auto.mts'

const mockLogger = vi.hoisted(() => ({
  fail: vi.fn(),
  info: vi.fn(),
  log: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
}))

// Mock the dependencies.
const mockDiscoverConfigValue = vi.hoisted(() => vi.fn())
const mockOutputConfigAuto = vi.hoisted(() => vi.fn())

vi.mock('@socketsecurity/lib/logger', () => ({
  getDefaultLogger: () => mockLogger,
  logger: mockLogger,
}))

vi.mock('../../../../src/commands/config/discover-config-value.mts', () => ({
  discoverConfigValue: mockDiscoverConfigValue,
}))

vi.mock('../../../../src/commands/config/output-config-auto.mts', () => ({
  outputConfigAuto: mockOutputConfigAuto,
}))

describe('handleConfigAuto', () => {
  it('discovers and outputs config value successfully', async () => {
    const { discoverConfigValue } = await import('../../../../src/commands/config/discover-config-value.mts')
    const { outputConfigAuto } = await import('../../../../src/commands/config/output-config-auto.mts')

    const mockResult = createSuccessResult('discovered-api-token')
    mockDiscoverConfigValue.mockResolvedValue(mockResult)

    await handleConfigAuto({ key: 'apiToken', outputKind: 'json' })

    expect(discoverConfigValue).toHaveBeenCalledWith('apiToken')
    expect(outputConfigAuto).toHaveBeenCalledWith('apiToken', mockResult, 'json')
  })

  it('handles discovery failure', async () => {
    const { discoverConfigValue } = await import('../../../../src/commands/config/discover-config-value.mts')
    const { outputConfigAuto } = await import('../../../../src/commands/config/output-config-auto.mts')

    const mockResult = createErrorResult('Config not found')
    mockDiscoverConfigValue.mockResolvedValue(mockResult)

    await handleConfigAuto({ key: 'orgSlug', outputKind: 'text' })

    expect(discoverConfigValue).toHaveBeenCalledWith('orgSlug')
    expect(outputConfigAuto).toHaveBeenCalledWith('orgSlug', mockResult, 'text')
  })

  it('handles markdown output format', async () => {
    const { discoverConfigValue } = await import('../../../../src/commands/config/discover-config-value.mts')
    const { outputConfigAuto } = await import('../../../../src/commands/config/output-config-auto.mts')

    mockDiscoverConfigValue.mockResolvedValue(createSuccessResult('test-value'))

    await handleConfigAuto({ key: 'orgId', outputKind: 'markdown' })

    expect(outputConfigAuto).toHaveBeenCalledWith(
      'orgId',
      expect.any(Object),
      'markdown',
    )
  })

  it('handles different config keys', async () => {
    const { discoverConfigValue } = await import('../../../../src/commands/config/discover-config-value.mts')

    const keys = ['apiToken', 'apiUrl', 'orgId', 'orgSlug'] as const

    for (const key of keys) {
      mockDiscoverConfigValue.mockResolvedValue(createSuccessResult(`${key}-value`))
      // eslint-disable-next-line no-await-in-loop
      await handleConfigAuto({ key, outputKind: 'json' })
      expect(discoverConfigValue).toHaveBeenCalledWith(key)
    }
  })

  it('handles text output format', async () => {
    const { discoverConfigValue } = await import('../../../../src/commands/config/discover-config-value.mts')
    const { outputConfigAuto } = await import('../../../../src/commands/config/output-config-auto.mts')

    mockDiscoverConfigValue.mockResolvedValue(
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
