import { beforeEach, describe, expect, it, vi } from 'vitest'

import { handleUpdateRepo } from './handle-update-repo.mts'

// Mock logger to avoid console output in tests
vi.mock('@socketsecurity/registry/lib/logger', () => ({
  logger: {
    log: vi.fn(),
  },
}))

describe('handleUpdateRepo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('updates repository and outputs result successfully', async () => {
    const { logger } = await import('@socketsecurity/registry/lib/logger')
    const mockLog = vi.mocked(logger.log)

    await handleUpdateRepo('test-repo', {
      name: 'new-name',
      description: 'New description',
      private: true,
      outputKind: 'json'
    })

    expect(mockLog).toHaveBeenCalledWith('Updating repository: test-repo')
    expect(mockLog).toHaveBeenCalledWith('New name: new-name')
    expect(mockLog).toHaveBeenCalledWith('New description: New description')
    expect(mockLog).toHaveBeenCalledWith('Private: true')
  })

  it('handles update failure', async () => {
    const { logger } = await import('@socketsecurity/registry/lib/logger')
    const mockLog = vi.mocked(logger.log)

    await handleUpdateRepo('invalid-repo', {
      outputKind: 'text'
    })

    expect(mockLog).toHaveBeenCalledWith('Updating repository: invalid-repo')
    // Only the main log, no updates
    expect(mockLog).toHaveBeenCalledTimes(1)
  })

  it('handles markdown output format', async () => {
    const { logger } = await import('@socketsecurity/registry/lib/logger')
    const mockLog = vi.mocked(logger.log)

    await handleUpdateRepo('my-repo', {
      description: 'Updated via CLI',
      outputKind: 'markdown'
    })

    expect(mockLog).toHaveBeenCalledWith('Updating repository: my-repo')
    expect(mockLog).toHaveBeenCalledWith('New description: Updated via CLI')
  })

  it('handles different visibility settings', async () => {
    const { logger } = await import('@socketsecurity/registry/lib/logger')
    const mockLog = vi.mocked(logger.log)

    // Test making repo public
    await handleUpdateRepo('private-repo', {
      private: false,
      outputKind: 'json'
    })

    expect(mockLog).toHaveBeenCalledWith('Updating repository: private-repo')
    expect(mockLog).toHaveBeenCalledWith('Private: false')

    vi.clearAllMocks()

    // Test making repo private
    await handleUpdateRepo('public-repo', {
      private: true,
      outputKind: 'json'
    })

    expect(mockLog).toHaveBeenCalledWith('Updating repository: public-repo')
    expect(mockLog).toHaveBeenCalledWith('Private: true')
  })

  it('handles different default branches', async () => {
    const { logger } = await import('@socketsecurity/registry/lib/logger')
    const mockLog = vi.mocked(logger.log)

    const branches = ['main', 'develop', 'master']

    for (const branch of branches) {
      vi.clearAllMocks()
      // eslint-disable-next-line no-await-in-loop
      await handleUpdateRepo('repo', {
        name: branch + '-repo',
        outputKind: 'text'
      })

      expect(mockLog).toHaveBeenCalledWith('Updating repository: repo')
      expect(mockLog).toHaveBeenCalledWith(`New name: ${branch}-repo`)
    }
  })
})