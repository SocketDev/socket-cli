/**
 * Unit Tests: Organization Dependencies Command Handler
 *
 * Purpose:
 * Tests the command handler that orchestrates fetching and displaying organization-wide
 * dependency information. Validates parameter forwarding, pagination handling, output
 * format selection, and error propagation through the fetch/output pipeline.
 *
 * Test Coverage:
 * - Successful fetch and output orchestration
 * - Fetch failure error handling
 * - Multiple output kind support (json, table, markdown)
 * - Large offset and limit parameter handling
 *
 * Testing Approach:
 * Mocks fetchDependencies and outputDependencies modules to test orchestration logic
 * without actual API calls or terminal output. Uses test environment setup helpers
 * for consistent test isolation.
 *
 * Related Files:
 * - src/commands/organization/handle-dependencies.mts - Command handler
 * - src/commands/organization/fetch-dependencies.mts - Dependencies fetcher
 * - src/commands/organization/output-dependencies.mts - Output formatter
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchDependencies } from '../../../../src/commands/organization/fetch-dependencies.mts'
import { handleDependencies } from '../../../../src/commands/organization/handle-dependencies.mts'
import { outputDependencies } from '../../../../src/commands/organization/output-dependencies.mts'
import {
  createSuccessResult,
  setupTestEnvironment,
} from '../../../helpers/index.mts'

// Mock the dependencies.
const mockFetchDependencies = vi.hoisted(() => vi.fn())
const mockOutputDependencies = vi.hoisted(() => vi.fn())
const mockDebug = vi.hoisted(() => vi.fn())
const mockDebugDir = vi.hoisted(() => vi.fn())

vi.mock('../../../../src/commands/organization/fetch-dependencies.mts', () => ({
  fetchDependencies: mockFetchDependencies,
}))

vi.mock(
  '../../../../src/commands/organization/output-dependencies.mts',
  () => ({
    outputDependencies: mockOutputDependencies,
  }),
)

vi.mock('@socketsecurity/lib/debug', () => ({
  debug: mockDebug,
  debugDir: mockDebugDir,
}))

describe('handleDependencies', () => {
  setupTestEnvironment()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should fetch and output dependencies successfully', async () => {
    const mockResult = createSuccessResult([
      {
        name: 'test-package',
        version: '1.0.0',
        description: 'Test package',
      },
    ])

    mockFetchDependencies.mockResolvedValue(mockResult)
    mockOutputDependencies.mockResolvedValue()

    await handleDependencies({
      limit: 10,
      offset: 0,
      outputKind: 'json',
    })

    expect(fetchDependencies).toHaveBeenCalledWith(
      { limit: 10, offset: 0 },
      {
        commandPath: 'socket organization dependencies',
      },
    )
    expect(outputDependencies).toHaveBeenCalledWith(mockResult, {
      limit: 10,
      offset: 0,
      outputKind: 'json',
    })
  })

  it('should handle fetch failure', async () => {
    const mockResult = {
      ok: false,
      error: new Error('Fetch failed'),
    }

    mockFetchDependencies.mockResolvedValue(mockResult)
    mockOutputDependencies.mockResolvedValue()

    await handleDependencies({
      limit: 20,
      offset: 10,
      outputKind: 'table',
    })

    expect(fetchDependencies).toHaveBeenCalledWith(
      { limit: 20, offset: 10 },
      {
        commandPath: 'socket organization dependencies',
      },
    )
    expect(outputDependencies).toHaveBeenCalledWith(mockResult, {
      limit: 20,
      offset: 10,
      outputKind: 'table',
    })
  })

  it('should handle different output kinds', async () => {
    const mockResult = createSuccessResult([])

    mockFetchDependencies.mockResolvedValue(mockResult)
    mockOutputDependencies.mockResolvedValue()

    await handleDependencies({
      limit: 5,
      offset: 0,
      outputKind: 'markdown',
    })

    expect(outputDependencies).toHaveBeenCalledWith(mockResult, {
      limit: 5,
      offset: 0,
      outputKind: 'markdown',
    })
  })

  it('should handle large offsets and limits', async () => {
    const mockResult = createSuccessResult([])

    mockFetchDependencies.mockResolvedValue(mockResult)
    mockOutputDependencies.mockResolvedValue()

    await handleDependencies({
      limit: 100,
      offset: 500,
      outputKind: 'json',
    })

    expect(fetchDependencies).toHaveBeenCalledWith(
      {
        limit: 100,
        offset: 500,
      },
      {
        commandPath: 'socket organization dependencies',
      },
    )
    expect(outputDependencies).toHaveBeenCalledWith(mockResult, {
      limit: 100,
      offset: 500,
      outputKind: 'json',
    })
  })
})
