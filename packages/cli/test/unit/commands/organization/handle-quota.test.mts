import { describe, expect, it, vi } from 'vitest'

import { setupTestEnvironment } from '../../../../src/helpers/index.mts'
import { handleQuota } from '../../../../src/src/handle-quota.mts'

vi.mock('./fetch-quota.mts', () => ({
  fetchQuota: vi.fn(),
}))

vi.mock('./output-quota.mts', () => ({
  outputQuota: vi.fn(),
}))

describe('handleQuota', () => {
  setupTestEnvironment()

  it('should fetch and output quota with default output kind', async () => {
    const { fetchQuota } = await import('./fetch-quota.mts')
    const { outputQuota } = await import('./output-quota.mts')
    const mockFetch = vi.mocked(fetchQuota)
    const mockOutput = vi.mocked(outputQuota)

    const mockData = {
      used: 100,
      limit: 1000,
      percentage: 10,
    }

    mockFetch.mockResolvedValue(mockData)
    mockOutput.mockResolvedValue()

    await handleQuota()

    expect(mockFetch).toHaveBeenCalledOnce()
    expect(mockOutput).toHaveBeenCalledWith(mockData, 'text')
  })

  it('should handle json output kind', async () => {
    const { fetchQuota } = await import('./fetch-quota.mts')
    const { outputQuota } = await import('./output-quota.mts')
    const mockFetch = vi.mocked(fetchQuota)
    const mockOutput = vi.mocked(outputQuota)

    const mockData = {
      used: 500,
      limit: 1000,
      percentage: 50,
    }

    mockFetch.mockResolvedValue(mockData)
    mockOutput.mockResolvedValue()

    await handleQuota('json')

    expect(mockFetch).toHaveBeenCalledOnce()
    expect(mockOutput).toHaveBeenCalledWith(mockData, 'json')
  })

  it('should handle markdown output kind', async () => {
    const { fetchQuota } = await import('./fetch-quota.mts')
    const { outputQuota } = await import('./output-quota.mts')
    const mockFetch = vi.mocked(fetchQuota)
    const mockOutput = vi.mocked(outputQuota)

    const mockData = {
      used: 0,
      limit: 100,
      percentage: 0,
    }

    mockFetch.mockResolvedValue(mockData)
    mockOutput.mockResolvedValue()

    await handleQuota('markdown')

    expect(mockFetch).toHaveBeenCalledOnce()
    expect(mockOutput).toHaveBeenCalledWith(mockData, 'markdown')
  })

  it('should handle table output kind', async () => {
    const { fetchQuota } = await import('./fetch-quota.mts')
    const { outputQuota } = await import('./output-quota.mts')
    const mockFetch = vi.mocked(fetchQuota)
    const mockOutput = vi.mocked(outputQuota)

    const mockData = {
      used: 999,
      limit: 1000,
      percentage: 99.9,
    }

    mockFetch.mockResolvedValue(mockData)
    mockOutput.mockResolvedValue()

    await handleQuota('table')

    expect(mockFetch).toHaveBeenCalledOnce()
    expect(mockOutput).toHaveBeenCalledWith(mockData, 'table')
  })

  it('should propagate errors from fetchQuota', async () => {
    const { fetchQuota } = await import('./fetch-quota.mts')
    const { outputQuota } = await import('./output-quota.mts')
    const mockFetch = vi.mocked(fetchQuota)
    const mockOutput = vi.mocked(outputQuota)

    const error = new Error('Network error')
    mockFetch.mockRejectedValue(error)

    await expect(handleQuota()).rejects.toThrow('Network error')
    expect(mockOutput).not.toHaveBeenCalled()
  })
})
