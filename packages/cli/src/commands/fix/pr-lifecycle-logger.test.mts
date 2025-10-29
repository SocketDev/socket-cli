import { beforeEach, describe, expect, it, vi } from 'vitest'

import { logPrEvent } from './pr-lifecycle-logger.mts'

// Mock logger.
vi.mock('@socketsecurity/lib/logger', () => ({
  logger: {
    success: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
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
      const { logger } = await import('@socketsecurity/lib/logger')

      logPrEvent(
        'created',
        123,
        'GHSA-1234-5678-90ab',
        'https://github.com/org/repo/pull/123',
      )

      expect(logger.success).toHaveBeenCalledWith(
        expect.stringContaining('PR #123'),
      )
      expect(logger.success).toHaveBeenCalledWith(
        expect.stringContaining('GHSA-1234-5678-90ab'),
      )
      expect(logger.success).toHaveBeenCalledWith(
        expect.stringContaining('https://github.com/org/repo/pull/123'),
      )
    })

    it('logs merged event with success logger', async () => {
      const { logger } = await import('@socketsecurity/lib/logger')

      logPrEvent('merged', 456, 'GHSA-abcd-efgh-ijkl', 'Branch cleaned up')

      expect(logger.success).toHaveBeenCalledWith(
        expect.stringContaining('PR #456'),
      )
      expect(logger.success).toHaveBeenCalledWith(
        expect.stringContaining('GHSA-abcd-efgh-ijkl'),
      )
      expect(logger.success).toHaveBeenCalledWith(
        expect.stringContaining('Branch cleaned up'),
      )
    })

    it('logs closed event with info logger', async () => {
      const { logger } = await import('@socketsecurity/lib/logger')

      logPrEvent('closed', 789, 'GHSA-test-test-test')

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('PR #789'),
      )
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('GHSA-test-test-test'),
      )
    })

    it('logs updated event with info logger', async () => {
      const { logger } = await import('@socketsecurity/lib/logger')

      logPrEvent('updated', 111, 'GHSA-update-test', 'Updated from base branch')

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('PR #111'),
      )
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('GHSA-update-test'),
      )
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Updated from base branch'),
      )
    })

    it('logs superseded event with warn logger', async () => {
      const { logger } = await import('@socketsecurity/lib/logger')

      logPrEvent('superseded', 222, 'GHSA-supersede')

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('PR #222'),
      )
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('GHSA-supersede'),
      )
    })

    it('logs failed event with error logger', async () => {
      const { logger } = await import('@socketsecurity/lib/logger')

      logPrEvent('failed', 333, 'GHSA-fail-test', 'API error')

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('PR #333'),
      )
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('GHSA-fail-test'),
      )
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('API error'),
      )
    })

    it('handles missing details parameter', async () => {
      const { logger } = await import('@socketsecurity/lib/logger')

      logPrEvent('created', 444, 'GHSA-no-details')

      expect(logger.success).toHaveBeenCalledWith(
        expect.stringContaining('PR #444'),
      )
      expect(logger.success).toHaveBeenCalledWith(
        expect.stringContaining('GHSA-no-details'),
      )
      // Should not include a colon when no details.
      expect(logger.success).toHaveBeenCalledWith(
        expect.not.stringContaining(': undefined'),
      )
    })

    it('applies color coding to symbols', async () => {
      const { logger } = await import('@socketsecurity/lib/logger')

      logPrEvent('created', 100, 'GHSA-colors')

      // Should include colored checkmark for success.
      expect(logger.success).toHaveBeenCalledWith(
        expect.stringContaining('[green]✓[/green]'),
      )
    })
  })
})
