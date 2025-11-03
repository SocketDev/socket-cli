import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createSuccessResult,
  setupTestEnvironment,
} from '../../../../../src/commands/../../../test/helpers/index.mts'
import { handleDependencies } from '../../../../src/src/commands/organization/handle-dependencies.mts'

const mockFetchDependencies = vi.hoisted(() => vi.fn())
const mockOutputDependencies = vi.hoisted(() => vi.fn())

vi.mock('../../../../../src/commands/organization/fetch-dependencies.mts', () => ({
  fetchDependencies: mockFetchDependencies,
}))
vi.mock('../../../../../src/commands/organization/output-dependencies.mts', () => ({
  outputDependencies: mockOutputDependencies,
}))

describe('handleDependencies', () => {
  setupTestEnvironment()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should fetch and output dependencies successfully', async () => {
    const { fetchDependencies } = await import('../../../../../src/commands/organization/fetch-dependencies.mts')
    const { outputDependencies } = await import('../../../../../src/commands/organization/output-dependencies.mts')

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

    expect(fetchDependencies).toHaveBeenCalledWith({ limit: 10, offset: 0 })
    expect(outputDependencies).toHaveBeenCalledWith(mockResult, {
      limit: 10,
      offset: 0,
      outputKind: 'json',
    })
  })

  it('should handle fetch failure', async () => {
    const { fetchDependencies } = await import('../../../../../src/commands/organization/fetch-dependencies.mts')
    const { outputDependencies } = await import('../../../../../src/commands/organization/output-dependencies.mts')

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

    expect(fetchDependencies).toHaveBeenCalledWith({ limit: 20, offset: 10 })
    expect(outputDependencies).toHaveBeenCalledWith(mockResult, {
      limit: 20,
      offset: 10,
      outputKind: 'table',
    })
  })

  it('should handle different output kinds', async () => {
    const { fetchDependencies } = await import('../../../../../src/commands/organization/fetch-dependencies.mts')
    const { outputDependencies } = await import('../../../../../src/commands/organization/output-dependencies.mts')

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
    const { fetchDependencies } = await import('../../../../../src/commands/organization/fetch-dependencies.mts')
    const { outputDependencies } = await import('../../../../../src/commands/organization/output-dependencies.mts')

    const mockResult = createSuccessResult([])

    mockFetchDependencies.mockResolvedValue(mockResult)
    mockOutputDependencies.mockResolvedValue()

    await handleDependencies({
      limit: 100,
      offset: 500,
      outputKind: 'json',
    })

    expect(fetchDependencies).toHaveBeenCalledWith({
      limit: 100,
      offset: 500,
    })
    expect(outputDependencies).toHaveBeenCalledWith(mockResult, {
      limit: 100,
      offset: 500,
      outputKind: 'json',
    })
  })
})
