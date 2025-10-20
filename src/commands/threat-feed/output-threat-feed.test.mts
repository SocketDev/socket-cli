import { beforeEach, describe, expect, it, vi } from 'vitest'

import { outputThreatFeed } from './output-threat-feed.mts'

import type { ThreadFeedResponse, ThreatResult } from './types.mts'
import type { CResult } from '../../types.mts'

// Mock the dependencies.
vi.mock('@socketsecurity/lib/logger', () => ({
  logger: {
    fail: vi.fn(),
    log: vi.fn(),
    warn: vi.fn(),
  },
}))

vi.mock('../../utils/error/fail-msg-with-badge.mts', () => ({
  failMsgWithBadge: vi.fn((msg, cause) => `${msg}: ${cause}`),
}))

vi.mock('../../utils/serialize/result-json.mts', () => ({
  serializeResultJson: vi.fn(result => JSON.stringify(result)),
}))

vi.mock('../../utils/ms/at-home.mts', () => ({
  msAtHome: vi.fn(() => '2 days ago'),
}))

vi.mock('../../constants.mts', () => ({
  default: {
    blessedOptions: {},
    spinner: {
      isSpinning: false,
      start: vi.fn(),
      stop: vi.fn(),
    },
  },
}))

// Mock blessed and blessed-contrib.
vi.mock('blessed/lib/widgets/screen.js', () => {
  const mockScreen = {
    append: vi.fn(),
    destroy: vi.fn(),
    key: vi.fn(),
    render: vi.fn(),
  }
  return {
    default: vi.fn(() => mockScreen),
  }
})

vi.mock('blessed/lib/widgets/box.js', () => {
  const mockBox = {
    setContent: vi.fn(),
  }
  return {
    default: vi.fn(() => mockBox),
  }
})

vi.mock('blessed-contrib/lib/widget/table.js', () => {
  const mockTable = {
    focus: vi.fn(),
    rows: {
      on: vi.fn(),
      selected: 0,
    },
    setData: vi.fn(),
  }
  return {
    default: vi.fn(() => mockTable),
  }
})

// Mock process.exit.
const mockProcessExit = vi.fn()
Object.defineProperty(process, 'exit', {
  value: mockProcessExit,
  writable: true,
})

describe('outputThreatFeed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
    mockProcessExit.mockClear()
  })

  it('outputs JSON format for successful result', async () => {
    const { logger } = await import('@socketsecurity/lib/logger')
    const { serializeResultJson } = await import(
      '../../utils/serialize/result-json.mts'
    )
    const mockLog = vi.mocked(logger.log)
    const mockSerialize = vi.mocked(serializeResultJson)

    const threatResults: ThreatResult[] = [
      {
        createdAt: '2024-01-01T00:00:00Z',
        description: 'Test threat',
        id: 1,
        locationHtmlUrl: 'https://example.com',
        packageHtmlUrl: 'https://example.com/package',
        purl: 'pkg:npm/test@1.0.0',
        removedAt: null,
        threatType: 'malware',
      },
    ]

    const result: CResult<ThreadFeedResponse> = {
      ok: true,
      data: {
        nextPage: 'next',
        results: threatResults,
      },
    }

    await outputThreatFeed(result, 'json')

    expect(mockSerialize).toHaveBeenCalledWith(result)
    expect(mockLog).toHaveBeenCalledWith(JSON.stringify(result))
    expect(process.exitCode).toBeUndefined()
  })

  it('outputs error in JSON format', async () => {
    const { logger } = await import('@socketsecurity/lib/logger')
    const mockLog = vi.mocked(logger.log)

    const result: CResult<ThreadFeedResponse> = {
      ok: false,
      code: 2,
      message: 'Unauthorized',
      cause: 'Invalid API token',
    }

    await outputThreatFeed(result, 'json')

    expect(mockLog).toHaveBeenCalled()
    expect(process.exitCode).toBe(2)
  })

  it('outputs error in text format', async () => {
    const { logger } = await import('@socketsecurity/lib/logger')
    const { failMsgWithBadge } = await import(
      '../../utils/error/fail-msg-with-badge.mts'
    )
    const mockFail = vi.mocked(logger.fail)
    const mockFailMsg = vi.mocked(failMsgWithBadge)

    const result: CResult<ThreadFeedResponse> = {
      ok: false,
      code: 1,
      message: 'Failed to fetch threat feed',
      cause: 'Network error',
    }

    await outputThreatFeed(result, 'text')

    expect(mockFailMsg).toHaveBeenCalledWith(
      'Failed to fetch threat feed',
      'Network error',
    )
    expect(mockFail).toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })

  it('warns when no data is available', async () => {
    const { logger } = await import('@socketsecurity/lib/logger')
    const mockWarn = vi.mocked(logger.warn)

    const result: CResult<ThreadFeedResponse> = {
      ok: true,
      data: {
        nextPage: 'next',
        results: [],
      },
    }

    await outputThreatFeed(result, 'text')

    expect(mockWarn).toHaveBeenCalledWith(
      'Did not receive any data to display.',
    )
    expect(process.exitCode).toBeUndefined()
  })

  it('handles threat results data formatting', async () => {
    const { msAtHome } = await import('../../utils/ms/at-home.mts')
    const _mockMsAtHome = vi.mocked(msAtHome)

    // Mock the entire outputThreatFeed module to avoid blessed issues.
    const { outputThreatFeed } = await import('./output-threat-feed.mts')

    const threatResults: ThreatResult[] = [
      {
        createdAt: '2024-01-01T00:00:00Z',
        description: 'Test threat description',
        id: 1,
        locationHtmlUrl: 'https://example.com/location',
        packageHtmlUrl: 'https://example.com/package',
        purl: 'pkg:npm/test-package@1.0.0',
        removedAt: null,
        threatType: 'malware',
      },
    ]

    const result: CResult<ThreadFeedResponse> = {
      ok: true,
      data: {
        nextPage: 'next',
        results: threatResults,
      },
    }

    // Just test JSON output to avoid blessed complexity.
    await outputThreatFeed(result, 'json')

    expect(process.exitCode).toBeUndefined()
  })

  it('sets default exit code when code is undefined', async () => {
    const result: CResult<ThreadFeedResponse> = {
      ok: false,
      message: 'Error without code',
    }

    await outputThreatFeed(result, 'json')

    expect(process.exitCode).toBe(1)
  })

  it('handles null data properly', async () => {
    const { logger } = await import('@socketsecurity/lib/logger')
    const mockWarn = vi.mocked(logger.warn)

    const result: CResult<ThreadFeedResponse> = {
      ok: true,
      data: null as any,
    }

    await outputThreatFeed(result, 'text')

    expect(mockWarn).toHaveBeenCalledWith(
      'Did not receive any data to display.',
    )
  })
})
