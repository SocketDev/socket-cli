import { describe, expect, it, vi } from 'vitest'

import { fetchQuota } from './fetch-quota.mts'
import { handleQuota } from './handle-quota.mts'
import { outputQuota } from './output-quota.mts'
import { setupTestEnvironment } from '../../../test/helpers/index.mts'

vi.mock('./fetch-quota.mts', () => ({
  fetchQuota: vi.fn(),
}))
vi.mock('./output-quota.mts', () => ({
  outputQuota: vi.fn(),
}))

describe('handleQuota', () => {
  setupTestEnvironment()

  it('should fetch and output quota with default output kind', async () => {
    const mockData = {
      used: 100,
      limit: 1000,
      percentage: 10,
    }

    vi.mocked(fetchQuota).mockResolvedValue(mockData)
    vi.mocked(outputQuota).mockResolvedValue()

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

    vi.mocked(fetchQuota).mockResolvedValue(mockData)
    vi.mocked(outputQuota).mockResolvedValue()

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

    vi.mocked(fetchQuota).mockResolvedValue(mockData)
    vi.mocked(outputQuota).mockResolvedValue()

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

    vi.mocked(fetchQuota).mockResolvedValue(mockData)
    vi.mocked(outputQuota).mockResolvedValue()

    await handleQuota('table')

    expect(fetchQuota).toHaveBeenCalledOnce()
    expect(outputQuota).toHaveBeenCalledWith(mockData, 'table')
  })

  it('should propagate errors from fetchQuota', async () => {
    const error = new Error('Network error')
    vi.mocked(fetchQuota).mockRejectedValue(error)

    await expect(handleQuota()).rejects.toThrow('Network error')
    expect(outputQuota).not.toHaveBeenCalled()
  })
})
