import { beforeEach, describe, expect, it, vi } from 'vitest'

import { outputThreatFeed } from './output-threat-feed.mts'

import type { ThreadFeedResponse, ThreatResult } from './types.mts'
import type { CResult } from '../../types.mts'

// Mock the dependencies
vi.mock('@socketsecurity/registry/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    fail: vi.fn(),
    log: vi.fn(),
    warn: vi.fn(),
  },
}))

vi.mock('../../utils/fail-msg-with-badge.mts', () => ({
  failMsgWithBadge: vi.fn((msg, cause) => `${msg}: ${cause}`),
}))

vi.mock('../../utils/serialize-result-json.mts', () => ({
  serializeResultJson: vi.fn(result => JSON.stringify(result)),
}))

vi.mock('../../constants.mts', () => ({
  default: {
    externalPath: '/mock/external',
    spinner: {
      isSpinning: false,
      start: vi.fn(),
      stop: vi.fn(),
    },
  },
}))

// Mock spawn for Ink subprocess
vi.mock('@socketsecurity/registry/lib/spawn', () => ({
  spawn: vi.fn(() => {
    const mockStdin = {
      write: vi.fn(),
      end: vi.fn(),
    }
    const spawnPromise = Promise.resolve({
      code: 0,
      stderr: Buffer.from(''),
      stdout: Buffer.from(''),
    })
    // @ts-expect-error - Adding stdin to promise.
    spawnPromise.stdin = mockStdin
    return spawnPromise
  }),
}))

// Mock process.exit
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
    const { logger } = await import('@socketsecurity/registry/lib/logger')
    const { serializeResultJson } = await import(
      '../../utils/serialize-result-json.mts'
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
    const { logger } = await import('@socketsecurity/registry/lib/logger')
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
    const { logger } = await import('@socketsecurity/registry/lib/logger')
    const { failMsgWithBadge } = await import(
      '../../utils/fail-msg-with-badge.mts'
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
    const { logger } = await import('@socketsecurity/registry/lib/logger')
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

  it('renders Ink app with threat results in text format', async () => {
    const { render } = await import('ink')
    const mockRender = vi.mocked(render)

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

    await outputThreatFeed(result, 'text')

    expect(mockRender).toHaveBeenCalled()
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
    const { logger } = await import('@socketsecurity/registry/lib/logger')
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

  it('waits for Ink app to exit', async () => {
    const { render } = await import('ink')
    const mockRender = vi.mocked(render)
    const mockWaitUntilExit = vi.fn().mockResolvedValue(undefined)
    mockRender.mockReturnValueOnce({ waitUntilExit: mockWaitUntilExit } as any)

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

    await outputThreatFeed(result, 'text')

    expect(mockRender).toHaveBeenCalled()
    expect(mockWaitUntilExit).toHaveBeenCalled()
    expect(process.exitCode).toBeUndefined()
  })
})
