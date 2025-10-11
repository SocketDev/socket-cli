import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchQuota } from './fetch-quota.mts'
import { handleQuota } from './handle-quota.mts'
import { outputQuota } from './output-quota.mts'

vi.mock('./fetch-quota.mts', () => ({
  fetchQuota: vi.fn(),
}))
vi.mock('./output-quota.mts', () => ({
  outputQuota: vi.fn(),
}))

describe('handleQuota', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should fetch and output quota with default output kind', async () => {
    const mockData = {
      used: 100,
      limit: 1000,
      percentage: 10,
    }
    const mockResult = { ok: true, data: mockData }

    vi.mocked(fetchQuota).mockResolvedValue(mockResult)
    vi.mocked(outputQuota).mockResolvedValue()

    await handleQuota()

    expect(fetchQuota).toHaveBeenCalledWith()
    expect(outputQuota).toHaveBeenCalledWith(mockData, 'text')
  })

  it('should handle json output kind', async () => {
    const mockData = {
      used: 500,
      limit: 1000,
      percentage: 50,
    }
    const mockResult = { ok: true, data: mockData }

    vi.mocked(fetchQuota).mockResolvedValue(mockResult)
    vi.mocked(outputQuota).mockResolvedValue()

    await handleQuota('json')

    expect(fetchQuota).toHaveBeenCalledWith()
    expect(outputQuota).toHaveBeenCalledWith(mockData, 'json')
  })

  it('should handle markdown output kind', async () => {
    const mockData = {
      used: 0,
      limit: 100,
      percentage: 0,
    }
    const mockResult = { ok: true, data: mockData }

    vi.mocked(fetchQuota).mockResolvedValue(mockResult)
    vi.mocked(outputQuota).mockResolvedValue()

    await handleQuota('markdown')

    expect(fetchQuota).toHaveBeenCalledWith()
    expect(outputQuota).toHaveBeenCalledWith(mockData, 'markdown')
  })

  it('should handle table output kind', async () => {
    const mockData = {
      used: 999,
      limit: 1000,
      percentage: 99.9,
    }
    const mockResult = { ok: true, data: mockData }

    vi.mocked(fetchQuota).mockResolvedValue(mockResult)
    vi.mocked(outputQuota).mockResolvedValue()

    await handleQuota('table')

    expect(fetchQuota).toHaveBeenCalledWith()
    expect(outputQuota).toHaveBeenCalledWith(mockData, 'table')
  })

  it('should propagate errors from fetchQuota', async () => {
    const mockResult = { ok: false, message: 'Network error' }
    vi.mocked(fetchQuota).mockResolvedValue(mockResult)

    await expect(handleQuota()).rejects.toThrow('Network error')
    expect(outputQuota).not.toHaveBeenCalled()
  })
})
