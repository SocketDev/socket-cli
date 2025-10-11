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
      orgSlug: 'test-org',
      limit: 10,
      offset: 0,
      outputKind: 'json',
    })

    expect(fetchDependencies).toHaveBeenCalledWith('test-org', { limit: 10, offset: 0 })
    expect(outputDependencies).toHaveBeenCalledWith(mockResult.data, 'json')
  })

  it('should handle fetch failure', async () => {
    const mockResult = {
      ok: false,
      message: 'Fetch failed',
    }

    vi.mocked(fetchDependencies).mockResolvedValue(mockResult)
    vi.mocked(outputDependencies).mockResolvedValue()

    await expect(
      handleDependencies({
        orgSlug: 'test-org',
        limit: 20,
        offset: 10,
        outputKind: 'table',
      })
    ).rejects.toThrow('Fetch failed')

    expect(fetchDependencies).toHaveBeenCalledWith('test-org', { limit: 20, offset: 10 })
    expect(outputDependencies).not.toHaveBeenCalled()
  })

  it('should handle different output kinds', async () => {
    const mockResult = {
      ok: true,
      data: [],
    }

    vi.mocked(fetchDependencies).mockResolvedValue(mockResult)
    vi.mocked(outputDependencies).mockResolvedValue()

    await handleDependencies({
      orgSlug: 'test-org',
      limit: 5,
      offset: 0,
      outputKind: 'markdown',
    })

    expect(outputDependencies).toHaveBeenCalledWith(mockResult.data, 'markdown')
  })

  it('should handle large offsets and limits', async () => {
    const mockResult = {
      ok: true,
      data: [],
    }

    vi.mocked(fetchDependencies).mockResolvedValue(mockResult)
    vi.mocked(outputDependencies).mockResolvedValue()

    await handleDependencies({
      orgSlug: 'test-org',
      limit: 100,
      offset: 500,
      outputKind: 'json',
    })

    expect(fetchDependencies).toHaveBeenCalledWith('test-org', { limit: 100, offset: 500 })
    expect(outputDependencies).toHaveBeenCalledWith(mockResult.data, 'json')
  })
})
