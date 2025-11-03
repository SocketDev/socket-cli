import { beforeEach, describe, expect, it, vi } from 'vitest'

import { logPrEvent } from '../../../../src/src/pr-lifecycle-logger.mts'

// Mock logger.
const mockLogger = vi.hoisted(() => ({
  success: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  log: vi.fn(),
  fail: vi.fn(),
}))

vi.mock('@socketsecurity/lib/logger', () => ({
  logger: mockLogger,
  getDefaultLogger: () => mockLogger,
}))

// Mock colors.
vi.mock('yoctocolors-cjs', () => ({
  __esModule: true,
  default: {
    green: (str: string) => `[green]${str}[/green]`,
    blue: (str: string) => `[blue]${str}[/blue]`,
    yellow: (str: string) => `[yellow]${str}[/yellow]`,
    red: (str: string) => `[red]${str}[/red]`,
    cyan: (str: string) => `[cyan]${str}[/cyan]`,
  },
}))

describe('pr-lifecycle-logger', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('logPrEvent', () => {
    it('logs created event with success logger', async () => {
      logPrEvent(
        'created',
        123,
        'GHSA-1234-5678-90ab',
        'https://github.com/org/repo/pull/123',
      )

      expect(mockLogger.success).toHaveBeenCalledWith(
        expect.stringContaining('PR #123'),
      )
      expect(mockLogger.success).toHaveBeenCalledWith(
        expect.stringContaining('GHSA-1234-5678-90ab'),
      )
      expect(mockLogger.success).toHaveBeenCalledWith(
        expect.stringContaining('https://github.com/org/repo/pull/123'),
      )
    })

    it('logs merged event with success logger', async () => {
      logPrEvent('merged', 456, 'GHSA-abcd-efgh-ijkl', 'Branch cleaned up')

      expect(mockLogger.success).toHaveBeenCalledWith(
        expect.stringContaining('PR #456'),
      )
      expect(mockLogger.success).toHaveBeenCalledWith(
        expect.stringContaining('GHSA-abcd-efgh-ijkl'),
      )
      expect(mockLogger.success).toHaveBeenCalledWith(
        expect.stringContaining('Branch cleaned up'),
      )
    })

    it('logs closed event with info logger', async () => {
      logPrEvent('closed', 789, 'GHSA-test-test-test')

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('PR #789'),
      )
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('GHSA-test-test-test'),
      )
    })

    it('logs updated event with info logger', async () => {
      logPrEvent('updated', 111, 'GHSA-update-test', 'Updated from base branch')

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('PR #111'),
      )
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('GHSA-update-test'),
      )
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Updated from base branch'),
      )
    })

    it('logs superseded event with warn logger', async () => {
      logPrEvent('superseded', 222, 'GHSA-supersede')

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('PR #222'),
      )
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('GHSA-supersede'),
      )
    })

    it('logs failed event with error logger', async () => {
      logPrEvent('failed', 333, 'GHSA-fail-test', 'API error')

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('PR #333'),
      )
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('GHSA-fail-test'),
      )
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('API error'),
      )
    })

    it('handles missing details parameter', async () => {
      logPrEvent('created', 444, 'GHSA-no-details')

      expect(mockLogger.success).toHaveBeenCalledWith(
        expect.stringContaining('PR #444'),
      )
      expect(mockLogger.success).toHaveBeenCalledWith(
        expect.stringContaining('GHSA-no-details'),
      )
      // Should not include a colon when no details.
      expect(mockLogger.success).toHaveBeenCalledWith(
        expect.not.stringContaining(': undefined'),
      )
    })

    it('applies color coding to symbols', async () => {
      logPrEvent('created', 100, 'GHSA-colors')

      // Should include colored checkmark for success.
      expect(mockLogger.success).toHaveBeenCalledWith(
        expect.stringContaining('[green]✓[/green]'),
      )
    })
  })
})
