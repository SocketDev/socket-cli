/**
 * Unit Tests: API Token Quota Command Handler
 *
 * Purpose:
 * Tests the command handler that orchestrates fetching and displaying API token quota information.
 * Validates parameter forwarding, output format selection (text, json, markdown, table), and
 * error propagation through the fetch/output pipeline.
 *
 * Test Coverage:
 * - Successful fetch and output with default output kind (text)
 * - Multiple output kind support (json, markdown, table)
 * - Error propagation from fetchQuota preventing output
 *
 * Testing Approach:
 * Mocks fetchQuota and outputQuota modules to test orchestration logic without actual
 * API calls or terminal output. Uses test environment setup helpers for consistent isolation.
 *
 * Related Files:
 * - src/commands/organization/handle-quota.mts - Command handler
 * - src/commands/organization/fetch-quota.mts - Quota fetcher
 * - src/commands/organization/output-quota.mts - Output formatter
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { setupTestEnvironment } from '../../../helpers/index.mts'
import { handleQuota } from '../../../../src/commands/organization/handle-quota.mts'
import { fetchQuota } from '../../../../src/commands/organization/fetch-quota.mts'
import { outputQuota } from '../../../../src/commands/organization/output-quota.mts'

// Mock the dependencies.
const mockFetchQuota = vi.hoisted(() => vi.fn())
const mockOutputQuota = vi.hoisted(() => vi.fn())

vi.mock('../../../../src/commands/organization/fetch-quota.mts', () => ({
  fetchQuota: mockFetchQuota,
}))

vi.mock('../../../../src/commands/organization/output-quota.mts', () => ({
  outputQuota: mockOutputQuota,
}))

describe('handleQuota', () => {
  setupTestEnvironment()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should fetch and output quota with default output kind', async () => {
    const mockData = {
      used: 100,
      limit: 1000,
      percentage: 10,
    }

    mockFetchQuota.mockResolvedValue(mockData)
    mockOutputQuota.mockResolvedValue()

    await handleQuota()

    expect(fetchQuota).toHaveBeenCalledOnce()
    expect(outputQuota).toHaveBeenCalledWith(mockData, 'text')
  })

  it('should handle json output kind', async () => {
    const mockData = {
      used: 500,
      limit: 1000,
      percentage: 50,
    }

    mockFetchQuota.mockResolvedValue(mockData)
    mockOutputQuota.mockResolvedValue()

    await handleQuota('json')

    expect(fetchQuota).toHaveBeenCalledOnce()
    expect(outputQuota).toHaveBeenCalledWith(mockData, 'json')
  })

  it('should handle markdown output kind', async () => {
    const mockData = {
      used: 0,
      limit: 100,
      percentage: 0,
    }

    mockFetchQuota.mockResolvedValue(mockData)
    mockOutputQuota.mockResolvedValue()

    await handleQuota('markdown')

    expect(fetchQuota).toHaveBeenCalledOnce()
    expect(outputQuota).toHaveBeenCalledWith(mockData, 'markdown')
  })

  it('should handle table output kind', async () => {
    const mockData = {
      used: 999,
      limit: 1000,
      percentage: 99.9,
    }

    mockFetchQuota.mockResolvedValue(mockData)
    mockOutputQuota.mockResolvedValue()

    await handleQuota('table')

    expect(fetchQuota).toHaveBeenCalledOnce()
    expect(outputQuota).toHaveBeenCalledWith(mockData, 'table')
  })

  it('should propagate errors from fetchQuota', async () => {
    const error = new Error('Network error')
    mockFetchQuota.mockRejectedValue(error)

    await expect(handleQuota()).rejects.toThrow('Network error')
    expect(outputQuota).not.toHaveBeenCalled()
  })
})
