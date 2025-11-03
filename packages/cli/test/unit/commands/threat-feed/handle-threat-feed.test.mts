import { beforeEach, describe, expect, it, vi } from 'vitest'

import { handleThreatFeed } from '../../../../src/src/handle-threat-feed.mts'

// Mock the dependencies.
vi.mock('./fetch-threat-feed.mts', () => ({
  fetchThreatFeed: vi.fn(),
}))
vi.mock('./output-threat-feed.mts', () => ({
  outputThreatFeed: vi.fn(),
}))

describe('handleThreatFeed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches and outputs threat feed successfully', async () => {
    const { fetchThreatFeed } = await import('../../src/fetch-threat-feed.mts')
    const { outputThreatFeed } = await import('../../src/output-threat-feed.mts')

    const mockData = {
      ok: true,
      data: [
        {
          id: 'threat-1',
          package: 'malicious-pkg',
          version: '1.0.0',
          ecosystem: 'npm',
          severity: 'high',
          description: 'Malware detected',
        },
        {
          id: 'threat-2',
          package: 'suspicious-pkg',
          version: '2.0.0',
          ecosystem: 'npm',
          severity: 'medium',
        },
      ],
    }
    vi.mocked(fetchThreatFeed).mockResolvedValue(mockData)

    await handleThreatFeed({
      direction: 'desc',
      ecosystem: 'npm',
      filter: 'malware',
      orgSlug: 'test-org',
      outputKind: 'json',
      page: '1',
      perPage: 20,
      pkg: '',
      version: '',
    })

    expect(fetchThreatFeed).toHaveBeenCalledWith({
      direction: 'desc',
      ecosystem: 'npm',
      filter: 'malware',
      orgSlug: 'test-org',
      page: '1',
      perPage: 20,
      pkg: '',
      version: '',
    })
    expect(outputThreatFeed).toHaveBeenCalledWith(mockData, 'json')
  })

  it('handles fetch failure', async () => {
    const { fetchThreatFeed } = await import('../../src/fetch-threat-feed.mts')
    const { outputThreatFeed } = await import('../../src/output-threat-feed.mts')

    const mockError = {
      ok: false,
      error: new Error('Failed to fetch threat feed'),
    }
    vi.mocked(fetchThreatFeed).mockResolvedValue(mockError)

    await handleThreatFeed({
      direction: 'asc',
      ecosystem: 'pypi',
      filter: '',
      orgSlug: 'test-org',
      outputKind: 'text',
      page: '2',
      perPage: 10,
      pkg: '',
      version: '',
    })

    expect(outputThreatFeed).toHaveBeenCalledWith(mockError, 'text')
  })

  it('handles specific package and version filter', async () => {
    const { fetchThreatFeed } = await import('../../src/fetch-threat-feed.mts')
    const { outputThreatFeed: _outputThreatFeed } = await import(
      './output-threat-feed.mts'
    )

    const mockData = {
      ok: true,
      data: [
        {
          id: 'threat-3',
          package: 'specific-pkg',
          version: '1.2.3',
          ecosystem: 'npm',
        },
      ],
    }
    vi.mocked(fetchThreatFeed).mockResolvedValue(mockData)

    await handleThreatFeed({
      direction: 'desc',
      ecosystem: 'npm',
      filter: '',
      orgSlug: 'my-org',
      outputKind: 'json',
      page: '1',
      perPage: 10,
      pkg: 'specific-pkg',
      version: '1.2.3',
    })

    expect(fetchThreatFeed).toHaveBeenCalledWith(
      expect.objectContaining({
        pkg: 'specific-pkg',
        version: '1.2.3',
      }),
    )
  })

  it('handles markdown output', async () => {
    const { fetchThreatFeed } = await import('../../src/fetch-threat-feed.mts')
    const { outputThreatFeed } = await import('../../src/output-threat-feed.mts')

    const mockData = {
      ok: true,
      data: [],
    }
    vi.mocked(fetchThreatFeed).mockResolvedValue(mockData)

    await handleThreatFeed({
      direction: 'asc',
      ecosystem: 'rubygems',
      filter: 'vulnerability',
      orgSlug: 'org',
      outputKind: 'markdown',
      page: '1',
      perPage: 50,
      pkg: '',
      version: '',
    })

    expect(outputThreatFeed).toHaveBeenCalledWith(mockData, 'markdown')
  })

  it('handles different ecosystems', async () => {
    const { fetchThreatFeed } = await import('../../src/fetch-threat-feed.mts')
    const { outputThreatFeed: _outputThreatFeed } = await import(
      './output-threat-feed.mts'
    )

    const ecosystems = ['npm', 'pypi', 'rubygems', 'maven', 'nuget']

    for (const ecosystem of ecosystems) {
      vi.mocked(fetchThreatFeed).mockResolvedValue({
        ok: true,
        data: [],
      })

      // eslint-disable-next-line no-await-in-loop
      await handleThreatFeed({
        direction: 'desc',
        ecosystem,
        filter: '',
        orgSlug: 'test-org',
        outputKind: 'json',
        page: '1',
        perPage: 20,
        pkg: '',
        version: '',
      })

      expect(fetchThreatFeed).toHaveBeenCalledWith(
        expect.objectContaining({ ecosystem }),
      )
    }
  })

  it('handles different filter types', async () => {
    const { fetchThreatFeed } = await import('../../src/fetch-threat-feed.mts')

    const filters = ['malware', 'vulnerability', 'typosquat', 'supply-chain']

    for (const filter of filters) {
      vi.mocked(fetchThreatFeed).mockResolvedValue({
        ok: true,
        data: [],
      })

      // eslint-disable-next-line no-await-in-loop
      await handleThreatFeed({
        direction: 'desc',
        ecosystem: 'npm',
        filter,
        orgSlug: 'test-org',
        outputKind: 'json',
        page: '1',
        perPage: 20,
        pkg: '',
        version: '',
      })

      expect(fetchThreatFeed).toHaveBeenCalledWith(
        expect.objectContaining({ filter }),
      )
    }
  })

  it('handles pagination', async () => {
    const { fetchThreatFeed } = await import('../../src/fetch-threat-feed.mts')
    const { outputThreatFeed: _outputThreatFeed } = await import(
      './output-threat-feed.mts'
    )

    vi.mocked(fetchThreatFeed).mockResolvedValue({
      ok: true,
      data: [],
    })

    await handleThreatFeed({
      direction: 'asc',
      ecosystem: 'npm',
      filter: '',
      orgSlug: 'test-org',
      outputKind: 'json',
      page: '10',
      perPage: 100,
      pkg: '',
      version: '',
    })

    expect(fetchThreatFeed).toHaveBeenCalledWith(
      expect.objectContaining({
        page: '10',
        perPage: 100,
      }),
    )
  })

  it('handles empty threat feed', async () => {
    const { fetchThreatFeed } = await import('../../src/fetch-threat-feed.mts')
    const { outputThreatFeed } = await import('../../src/output-threat-feed.mts')

    const mockData = {
      ok: true,
      data: [],
    }
    vi.mocked(fetchThreatFeed).mockResolvedValue(mockData)

    await handleThreatFeed({
      direction: 'desc',
      ecosystem: 'npm',
      filter: 'nonexistent',
      orgSlug: 'test-org',
      outputKind: 'text',
      page: '1',
      perPage: 20,
      pkg: '',
      version: '',
    })

    expect(outputThreatFeed).toHaveBeenCalledWith(mockData, 'text')
  })
})
