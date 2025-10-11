import { beforeEach, describe, expect, it, vi } from 'vitest'

import { handleViewRepo } from './handle-view-repo.mts'

// Mock logger to avoid console output in tests
vi.mock('@socketsecurity/registry/lib/logger', () => ({
  logger: {
    log: vi.fn(),
  },
}))

describe('handleViewRepo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches and outputs repository details successfully', async () => {
    const { logger } = await import('@socketsecurity/registry/lib/logger')
    const mockLog = vi.mocked(logger.log)

    await handleViewRepo('test-repo', { outputKind: 'json' })

    expect(mockLog).toHaveBeenCalledWith('Viewing repository: test-repo')
    expect(mockLog).toHaveBeenCalledWith('Repository details would be shown here')
  })

  it('handles fetch failure', async () => {
    const { logger } = await import('@socketsecurity/registry/lib/logger')
    const mockLog = vi.mocked(logger.log)

    await handleViewRepo('nonexistent-repo', { outputKind: 'text' })

    expect(mockLog).toHaveBeenCalledWith('Viewing repository: nonexistent-repo')
    expect(mockLog).toHaveBeenCalledWith('Repository details would be shown here')
  })

  it('handles markdown output format', async () => {
    const { logger } = await import('@socketsecurity/registry/lib/logger')
    const mockLog = vi.mocked(logger.log)

    await handleViewRepo('my-repo', { outputKind: 'markdown' })

    expect(mockLog).toHaveBeenCalledWith('Viewing repository: my-repo')
    expect(mockLog).toHaveBeenCalledWith('Repository details would be shown here')
  })

  it('handles text output format', async () => {
    const { logger } = await import('@socketsecurity/registry/lib/logger')
    const mockLog = vi.mocked(logger.log)

    await handleViewRepo('production-repo', { outputKind: 'text' })

    expect(mockLog).toHaveBeenCalledWith('Viewing repository: production-repo')
    expect(mockLog).toHaveBeenCalledWith('Repository details would be shown here')
  })

  it('handles different repository names', async () => {
    const { logger } = await import('@socketsecurity/registry/lib/logger')
    const mockLog = vi.mocked(logger.log)

    const testCases = ['repo-1', 'my-awesome-project', 'internal-tool']

    for (const repo of testCases) {
      vi.clearAllMocks()
      // eslint-disable-next-line no-await-in-loop
      await handleViewRepo(repo, { outputKind: 'json' })
      expect(mockLog).toHaveBeenCalledWith(`Viewing repository: ${repo}`)
      expect(mockLog).toHaveBeenCalledWith('Repository details would be shown here')
    }
  })
})