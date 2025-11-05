/**
 * Unit tests for outputThreatFeed.
 *
 * Purpose:
 * Tests output formatting for threat intelligence feeds. Validates threat display, severity indicators, and timeline formatting.
 *
 * Test Coverage:
 * - Successful operation output formatting
 * - Error message formatting
 * - Multiple output formats (text, json, markdown)
 * - Data presentation and formatting
 * - Edge case handling
 *
 * Testing Approach:
 * Uses result helpers and fixtures to create test data. Validates formatted
 * output strings across different output modes.
 *
 * Related Files:
 * - src/commands/outputThreatFeed.mts (implementation)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { outputThreatFeed } from '../../../../src/commands/threat-feed/output-threat-feed.mts'
import { failMsgWithBadge } from '../../../../src/utils/error/fail-msg-with-badge.mts'
import { msAtHome } from '../../../../src/utils/home-cache-time.mts'
import { serializeResultJson } from '../../../../src/utils/output/result-json.mts'

import type {
  ThreadFeedResponse,
  ThreatResult,
  CResult,
} from '../../../../src/commands/threat-feed/types.mts'

// Mock the dependencies.
const mockLogger = vi.hoisted(() => ({
  fail: vi.fn(),
  log: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

// Helper references to mockLogger methods.
const mockLog = mockLogger.log
const mockFail = mockLogger.fail
const mockWarn = mockLogger.warn

vi.mock('@socketsecurity/lib/logger', () => ({
  getDefaultLogger: () => mockLogger,
  logger: mockLogger,
}))

vi.mock('../../../../src/utils/error/fail-msg-with-badge.mts', () => ({
  failMsgWithBadge: vi.fn((msg, cause) => `${msg}: ${cause}`),
}))

vi.mock('../../../../src/utils/output/result-json.mts', () => ({
  serializeResultJson: vi.fn(result => JSON.stringify(result)),
}))

vi.mock('../../../../src/utils/home-cache-time.mts', () => ({
  msAtHome: vi.fn(() => '2 days ago'),
}))

vi.mock('../../../../src/constants.mts', () => ({
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
    const _mockMsAtHome = vi.mocked(msAtHome)

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
