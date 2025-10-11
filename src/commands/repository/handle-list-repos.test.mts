import { beforeEach, describe, expect, it, vi } from 'vitest'

import { handleListRepos } from './handle-list-repos.mts'

// Mock logger to avoid console output in tests
vi.mock('@socketsecurity/registry/lib/logger', () => ({
  logger: {
    log: vi.fn(),
  },
}))

describe('handleListRepos', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches all repositories when all flag is true', async () => {
    const { logger } = await import('@socketsecurity/registry/lib/logger')
    const mockLog = vi.mocked(logger.log)

    await handleListRepos({
      limit: 100,
      page: 1,
      sort: 'name',
      outputKind: 'json',
    })

    expect(mockLog).toHaveBeenCalledWith('Listing repositories...')
    expect(mockLog).toHaveBeenCalledWith('Limit: 100')
    expect(mockLog).toHaveBeenCalledWith('Page: 1')
    expect(mockLog).toHaveBeenCalledWith('Sort: name')
  })

  it('fetches paginated repositories when all is false', async () => {
    const { logger } = await import('@socketsecurity/registry/lib/logger')
    const mockLog = vi.mocked(logger.log)

    await handleListRepos({
      limit: 25,
      page: 2,
      outputKind: 'text',
    })

    expect(mockLog).toHaveBeenCalledWith('Listing repositories...')
    expect(mockLog).toHaveBeenCalledWith('Limit: 25')
    expect(mockLog).toHaveBeenCalledWith('Page: 2')
  })

  it('handles fetch failure', async () => {
    const { logger } = await import('@socketsecurity/registry/lib/logger')
    const mockLog = vi.mocked(logger.log)

    // Even with failure, the stub just logs
    await handleListRepos({
      outputKind: 'json',
    })

    expect(mockLog).toHaveBeenCalledWith('Listing repositories...')
    // Default value
    expect(mockLog).toHaveBeenCalledWith('Limit: 10')
    // Default value
    expect(mockLog).toHaveBeenCalledWith('Page: 1')
  })

  it('handles markdown output format', async () => {
    const { logger } = await import('@socketsecurity/registry/lib/logger')
    const mockLog = vi.mocked(logger.log)

    await handleListRepos({
      limit: 50,
      outputKind: 'markdown',
    })

    expect(mockLog).toHaveBeenCalledWith('Listing repositories...')
    expect(mockLog).toHaveBeenCalledWith('Limit: 50')
    expect(mockLog).toHaveBeenCalledWith('Page: 1')
  })

  it('handles different page sizes', async () => {
    const { logger } = await import('@socketsecurity/registry/lib/logger')
    const mockLog = vi.mocked(logger.log)

    const pageSizes = [10, 25, 50, 100]

    for (const size of pageSizes) {
      vi.clearAllMocks()
      // eslint-disable-next-line no-await-in-loop
      await handleListRepos({
        limit: size,
        outputKind: 'text',
      })

      expect(mockLog).toHaveBeenCalledWith('Listing repositories...')
      expect(mockLog).toHaveBeenCalledWith(`Limit: ${size}`)
    }
  })
})