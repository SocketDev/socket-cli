import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchDependencies } from './fetch-dependencies.mts'
import { handleDependencies } from './handle-dependencies.mts'
import { outputDependencies } from './output-dependencies.mts'

vi.mock('./fetch-dependencies.mts', () => ({
  fetchDependencies: vi.fn(),
}))
vi.mock('./output-dependencies.mts', () => ({
  outputDependencies: vi.fn(),
}))

describe('handleDependencies', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should fetch and output dependencies successfully', async () => {
    const mockResult = {
      ok: true,
      data: [
        {
          name: 'test-package',
          version: '1.0.0',
          description: 'Test package',
        },
      ],
    }

    vi.mocked(fetchDependencies).mockResolvedValue(mockResult)
    vi.mocked(outputDependencies).mockResolvedValue()

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
    const mockResult = {
      ok: false,
      error: new Error('Fetch failed'),
    }

    vi.mocked(fetchDependencies).mockResolvedValue(mockResult)
    vi.mocked(outputDependencies).mockResolvedValue()

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
    const mockResult = {
      ok: true,
      data: [],
    }

    vi.mocked(fetchDependencies).mockResolvedValue(mockResult)
    vi.mocked(outputDependencies).mockResolvedValue()

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
    const mockResult = {
      ok: true,
      data: [],
    }

    vi.mocked(fetchDependencies).mockResolvedValue(mockResult)
    vi.mocked(outputDependencies).mockResolvedValue()

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
