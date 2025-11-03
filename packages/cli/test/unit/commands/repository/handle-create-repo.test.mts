import { beforeEach, describe, expect, it, vi } from 'vitest'

import { handleCreateRepo } from '../../../../src/handle-create-repo.mts'

// Mock the dependencies.
vi.mock('./fetch-create-repo.mts', () => ({
  fetchCreateRepo: vi.fn(),
}))
vi.mock('./output-create-repo.mts', () => ({
  outputCreateRepo: vi.fn(),
}))
vi.mock('@socketsecurity/lib/debug', () => ({
  debug: vi.fn(),
  debugDir: vi.fn(),
  isDebug: vi.fn(() => false),
}))

describe('handleCreateRepo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates repository successfully', async () => {
    const { fetchCreateRepo } = await import('../../src/fetch-create-repo.mts')
    const { outputCreateRepo } = await import('../../src/output-create-repo.mts')

    const mockData = {
      ok: true,
      data: {
        id: '123',
        name: 'my-repo',
        fullName: 'test-org/my-repo',
        visibility: 'private',
      },
    }
    vi.mocked(fetchCreateRepo).mockResolvedValue(mockData)

    await handleCreateRepo(
      {
        orgSlug: 'test-org',
        repoName: 'my-repo',
        description: 'Test repository',
        homepage: 'https://example.com',
        defaultBranch: 'main',
        visibility: 'private',
      },
      'json',
    )

    expect(fetchCreateRepo).toHaveBeenCalledWith({
      orgSlug: 'test-org',
      repoName: 'my-repo',
      description: 'Test repository',
      homepage: 'https://example.com',
      defaultBranch: 'main',
      visibility: 'private',
    })
    expect(outputCreateRepo).toHaveBeenCalledWith(mockData, 'my-repo', 'json')
  })

  it('handles creation failure', async () => {
    const { fetchCreateRepo } = await import('../../src/fetch-create-repo.mts')
    const { outputCreateRepo } = await import('../../src/output-create-repo.mts')

    const mockError = {
      ok: false,
      error: new Error('Repository already exists'),
    }
    vi.mocked(fetchCreateRepo).mockResolvedValue(mockError)

    await handleCreateRepo(
      {
        orgSlug: 'test-org',
        repoName: 'existing-repo',
        description: 'Test repository',
        homepage: '',
        defaultBranch: 'main',
        visibility: 'public',
      },
      'text',
    )

    expect(fetchCreateRepo).toHaveBeenCalledWith(
      expect.objectContaining({
        repoName: 'existing-repo',
      }),
    )
    expect(outputCreateRepo).toHaveBeenCalledWith(
      mockError,
      'existing-repo',
      'text',
    )
  })

  it('handles markdown output', async () => {
    const { fetchCreateRepo } = await import('../../src/fetch-create-repo.mts')
    const { outputCreateRepo } = await import('../../src/output-create-repo.mts')

    const mockData = {
      ok: true,
      data: { id: '456', name: 'test-repo' },
    }
    vi.mocked(fetchCreateRepo).mockResolvedValue(mockData)

    await handleCreateRepo(
      {
        orgSlug: 'org',
        repoName: 'test-repo',
        description: 'Description',
        homepage: 'https://test.com',
        defaultBranch: 'develop',
        visibility: 'internal',
      },
      'markdown',
    )

    expect(outputCreateRepo).toHaveBeenCalledWith(
      mockData,
      'test-repo',
      'markdown',
    )
  })

  it('logs debug information', async () => {
    const { debug, debugDir } = await import('@socketsecurity/lib/debug')
    const { fetchCreateRepo } = await import('../../src/fetch-create-repo.mts')

    const mockData = {
      ok: true,
      data: { id: '789', name: 'debug-repo' },
    }
    vi.mocked(fetchCreateRepo).mockResolvedValue(mockData)

    await handleCreateRepo(
      {
        orgSlug: 'debug-org',
        repoName: 'debug-repo',
        description: 'Debug test',
        homepage: 'https://debug.com',
        defaultBranch: 'main',
        visibility: 'private',
      },
      'json',
    )

    expect(debug).toHaveBeenCalledWith(
      'Creating repository debug-org/debug-repo',
    )
    expect(debugDir).toHaveBeenCalledWith(
      expect.objectContaining({
        orgSlug: 'debug-org',
        repoName: 'debug-repo',
      }),
    )
    expect(debug).toHaveBeenCalledWith('Repository creation succeeded')
  })

  it('logs debug information on failure', async () => {
    const { debug } = await import('@socketsecurity/lib/debug')
    const { fetchCreateRepo } = await import('../../src/fetch-create-repo.mts')

    vi.mocked(fetchCreateRepo).mockResolvedValue({
      ok: false,
      error: new Error('Failed'),
    })

    await handleCreateRepo(
      {
        orgSlug: 'org',
        repoName: 'repo',
        description: '',
        homepage: '',
        defaultBranch: 'main',
        visibility: 'public',
      },
      'json',
    )

    expect(debug).toHaveBeenCalledWith('Repository creation failed')
  })

  it('handles different visibility types', async () => {
    const { fetchCreateRepo } = await import('../../src/fetch-create-repo.mts')
    const { outputCreateRepo: _outputCreateRepo } = await import(
      './output-create-repo.mts'
    )

    const visibilities = ['public', 'private', 'internal']

    for (const visibility of visibilities) {
      vi.mocked(fetchCreateRepo).mockResolvedValue({
        ok: true,
        data: { id: '1', name: 'repo', visibility },
      })

      // eslint-disable-next-line no-await-in-loop
      await handleCreateRepo(
        {
          orgSlug: 'org',
          repoName: 'repo',
          description: 'Test',
          homepage: '',
          defaultBranch: 'main',
          visibility,
        },
        'json',
      )

      expect(fetchCreateRepo).toHaveBeenCalledWith(
        expect.objectContaining({ visibility }),
      )
    }
  })

  it('handles empty optional fields', async () => {
    const { fetchCreateRepo } = await import('../../src/fetch-create-repo.mts')
    const { outputCreateRepo: _outputCreateRepo } = await import(
      './output-create-repo.mts'
    )

    vi.mocked(fetchCreateRepo).mockResolvedValue({
      ok: true,
      data: { id: '1', name: 'minimal-repo' },
    })

    await handleCreateRepo(
      {
        orgSlug: 'org',
        repoName: 'minimal-repo',
        description: '',
        homepage: '',
        defaultBranch: 'main',
        visibility: 'public',
      },
      'json',
    )

    expect(fetchCreateRepo).toHaveBeenCalledWith({
      orgSlug: 'org',
      repoName: 'minimal-repo',
      description: '',
      homepage: '',
      defaultBranch: 'main',
      visibility: 'public',
    })
  })
})
