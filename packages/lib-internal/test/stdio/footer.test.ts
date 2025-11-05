/**
 * @fileoverview Unit tests for console footer formatting utilities.
 *
 * Tests footer formatting utilities:
 * - createFooter() generates bordered footers with messages, timestamps, duration
 * - createSummaryFooter() creates summary footers with stats (passed/failed/skipped)
 * - Custom styling: colors, widths, border characters
 * - Duration formatting and timestamp display
 * Used by Socket CLI for command completion reports and test result summaries.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createFooter,
  createSummaryFooter,
} from '@socketsecurity/lib/stdio/footer'

describe('stdio/footer', () => {
  let dateNowSpy: ReturnType<typeof vi.spyOn>
  let originalDateNow: typeof Date.now

  beforeEach(() => {
    originalDateNow = Date.now
    // Mock Date.now() to return a fixed timestamp
    // @ts-expect-error - Vitest spy type doesn't match ReturnType<typeof vi.spyOn>
    dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
  })

  afterEach(() => {
    if (dateNowSpy) {
      dateNowSpy.mockRestore()
    }
    Date.now = originalDateNow
  })

  describe('createFooter', () => {
    it('should export createFooter function', () => {
      expect(typeof createFooter).toBe('function')
    })

    it('should create footer with just border', () => {
      const result = createFooter()
      expect(result).toBe('='.repeat(80))
    })

    it('should create footer with message', () => {
      const result = createFooter('Build complete')
      expect(result).toContain('Build complete')
      expect(result).toContain('='.repeat(80))
    })

    it('should create footer with custom width', () => {
      const result = createFooter(undefined, { width: 60 })
      expect(result).toBe('='.repeat(60))
    })

    it('should create footer with custom border char', () => {
      const result = createFooter(undefined, { borderChar: '-' })
      expect(result).toBe('-'.repeat(80))
    })

    it('should create footer with custom color', () => {
      const result = createFooter('Success', { color: 'green' })
      expect(result).toContain('Success')
    })

    it('should show timestamp when requested', () => {
      const result = createFooter('Done', { showTimestamp: true })
      expect(result).toContain('Completed at:')
      expect(result).toContain('Done')
    })

    it('should show duration when requested with startTime', () => {
      Date.now = vi.fn(() => 5000)
      const result = createFooter('Done', {
        showDuration: true,
        startTime: 2000,
      })
      expect(result).toContain('Duration:')
      expect(result).toContain('3.00s')
      Date.now = originalDateNow
    })

    it('should not show duration without startTime', () => {
      const result = createFooter('Done', { showDuration: true })
      expect(result).not.toContain('Duration:')
    })

    it('should show both timestamp and duration', () => {
      Date.now = vi.fn(() => 5000)
      const result = createFooter('Done', {
        showTimestamp: true,
        showDuration: true,
        startTime: 2000,
      })
      expect(result).toContain('Completed at:')
      expect(result).toContain('Duration:')
      Date.now = originalDateNow
    })

    it('should handle message with timestamp', () => {
      const result = createFooter('Complete', { showTimestamp: true })
      const lines = result.split('\n')
      expect(lines.some(line => line.includes('Complete'))).toBe(true)
      expect(lines.some(line => line.includes('Completed at:'))).toBe(true)
    })

    it('should handle empty message', () => {
      const result = createFooter('')
      expect(result).toContain('='.repeat(80))
    })

    it('should handle undefined message', () => {
      const result = createFooter(undefined)
      expect(result).toBe('='.repeat(80))
    })

    it('should handle long message', () => {
      const longMessage = 'A'.repeat(200)
      const result = createFooter(longMessage)
      expect(result).toContain(longMessage)
    })

    it('should handle message with special characters', () => {
      const result = createFooter('Build: 100% complete')
      expect(result).toContain('Build: 100% complete')
    })

    it('should handle Unicode message', () => {
      const result = createFooter('完了しました')
      expect(result).toContain('完了しました')
    })

    it('should format duration correctly', () => {
      Date.now = vi.fn(() => 10_500)
      const result = createFooter('Done', {
        showDuration: true,
        startTime: 1000,
      })
      expect(result).toContain('9.50s')
      Date.now = originalDateNow
    })

    it('should handle very short duration', () => {
      Date.now = vi.fn(() => 1050)
      const result = createFooter('Done', {
        showDuration: true,
        startTime: 1000,
      })
      expect(result).toContain('0.05s')
      Date.now = originalDateNow
    })

    it('should handle zero duration', () => {
      Date.now = vi.fn(() => 1000)
      const result = createFooter('Done', {
        showDuration: true,
        startTime: 1000,
      })
      expect(result).toContain('0.00s')
      Date.now = originalDateNow
    })

    it('should handle all color options', () => {
      const colors = [
        'cyan',
        'green',
        'yellow',
        'blue',
        'magenta',
        'red',
        'gray',
      ]
      for (const color of colors) {
        const result = createFooter('Message', {
          color: color as
            | 'cyan'
            | 'green'
            | 'yellow'
            | 'blue'
            | 'magenta'
            | 'red'
            | 'gray',
        })
        expect(result).toContain('Message')
      }
    })

    it('should handle undefined color', () => {
      const result = createFooter('Message', { color: undefined })
      expect(result).toContain('Message')
    })

    it('should return a string', () => {
      const result = createFooter()
      expect(typeof result).toBe('string')
    })

    it('should end with border', () => {
      const result = createFooter('Message')
      const lines = result.split('\n')
      expect(lines[lines.length - 1]).toBe('='.repeat(80))
    })

    it('should handle small width', () => {
      const result = createFooter(undefined, { width: 10 })
      expect(result).toBe('='.repeat(10))
    })

    it('should handle large width', () => {
      const result = createFooter(undefined, { width: 200 })
      expect(result).toBe('='.repeat(200))
    })
  })

  describe('createSummaryFooter', () => {
    it('should export createSummaryFooter function', () => {
      expect(typeof createSummaryFooter).toBe('function')
    })

    it('should create summary with total', () => {
      const result = createSummaryFooter({ total: 100 })
      expect(result).toContain('Total: 100')
    })

    it('should create summary with success count', () => {
      const result = createSummaryFooter({ success: 95 })
      expect(result).toContain('95 passed')
    })

    it('should create summary with failed count', () => {
      const result = createSummaryFooter({ failed: 5 })
      expect(result).toContain('5 failed')
    })

    it('should not show failed when count is zero', () => {
      const result = createSummaryFooter({ failed: 0 })
      expect(result).not.toContain('failed')
    })

    it('should create summary with skipped count', () => {
      const result = createSummaryFooter({ skipped: 3 })
      expect(result).toContain('3 skipped')
    })

    it('should not show skipped when count is zero', () => {
      const result = createSummaryFooter({ skipped: 0 })
      expect(result).not.toContain('skipped')
    })

    it('should create summary with warnings', () => {
      const result = createSummaryFooter({ warnings: 10 })
      expect(result).toContain('10 warnings')
    })

    it('should not show warnings when count is zero', () => {
      const result = createSummaryFooter({ warnings: 0 })
      expect(result).not.toContain('warnings')
    })

    it('should create summary with errors', () => {
      const result = createSummaryFooter({ errors: 2 })
      expect(result).toContain('2 errors')
    })

    it('should not show errors when count is zero', () => {
      const result = createSummaryFooter({ errors: 0 })
      expect(result).not.toContain('errors')
    })

    it('should create comprehensive summary', () => {
      const result = createSummaryFooter({
        total: 150,
        success: 145,
        failed: 3,
        skipped: 2,
        warnings: 5,
      })
      expect(result).toContain('Total: 150')
      expect(result).toContain('145 passed')
      expect(result).toContain('3 failed')
      expect(result).toContain('2 skipped')
      expect(result).toContain('5 warnings')
    })

    it('should separate stats with pipe', () => {
      const result = createSummaryFooter({
        total: 100,
        success: 95,
        failed: 5,
      })
      expect(result).toContain('|')
    })

    it('should use checkmark for success', () => {
      const result = createSummaryFooter({ success: 100 })
      expect(result).toContain('✓')
    })

    it('should use cross for failed', () => {
      const result = createSummaryFooter({ failed: 5 })
      expect(result).toContain('✗')
    })

    it('should use circle for skipped', () => {
      const result = createSummaryFooter({ skipped: 3 })
      expect(result).toContain('○')
    })

    it('should use warning symbol for warnings', () => {
      const result = createSummaryFooter({ warnings: 10 })
      expect(result).toContain('⚠')
    })

    it('should use cross for errors', () => {
      const result = createSummaryFooter({ errors: 2 })
      expect(result).toContain('✗')
    })

    it('should handle empty stats', () => {
      const result = createSummaryFooter({})
      expect(result).toContain('='.repeat(80))
    })

    it('should handle single stat', () => {
      const result = createSummaryFooter({ total: 50 })
      expect(result).toContain('Total: 50')
    })

    it('should handle all stats', () => {
      const result = createSummaryFooter({
        total: 200,
        success: 180,
        failed: 10,
        skipped: 5,
        warnings: 15,
        errors: 5,
      })
      expect(result).toContain('Total: 200')
      expect(result).toContain('180 passed')
      expect(result).toContain('10 failed')
      expect(result).toContain('5 skipped')
      expect(result).toContain('15 warnings')
      expect(result).toContain('5 errors')
    })

    it('should accept footer options', () => {
      const result = createSummaryFooter(
        { total: 100 },
        { width: 60, borderChar: '-' },
      )
      expect(result).toContain('-'.repeat(60))
    })

    it('should show duration when provided', () => {
      Date.now = vi.fn(() => 10_000)
      const result = createSummaryFooter({
        total: 100,
        duration: 5000,
      })
      expect(result).toContain('Duration:')
      Date.now = originalDateNow
    })

    it('should not show duration when undefined', () => {
      const result = createSummaryFooter({ total: 100 })
      expect(result).not.toContain('Duration:')
    })

    it('should handle zero values', () => {
      const result = createSummaryFooter({
        total: 0,
        success: 0,
      })
      expect(result).toContain('Total: 0')
      expect(result).toContain('0 passed')
    })

    it('should handle undefined total', () => {
      const result = createSummaryFooter({
        success: 100,
      })
      expect(result).not.toContain('Total:')
      expect(result).toContain('100 passed')
    })

    it('should handle large numbers', () => {
      const result = createSummaryFooter({
        total: 999_999,
        success: 999_998,
        failed: 1,
      })
      expect(result).toContain('Total: 999999')
      expect(result).toContain('999998 passed')
      expect(result).toContain('1 failed')
    })

    it('should return a string', () => {
      const result = createSummaryFooter({ total: 100 })
      expect(typeof result).toBe('string')
    })

    it('should end with border', () => {
      const result = createSummaryFooter({ total: 100 })
      const lines = result.split('\n')
      expect(lines[lines.length - 1]).toBe('='.repeat(80))
    })
  })

  describe('integration', () => {
    it('should create complete report footer', () => {
      Date.now = vi.fn(() => 10_000)
      const footer = createFooter('Analysis complete', {
        showTimestamp: true,
        showDuration: true,
        startTime: 5000,
        color: 'green',
      })
      expect(footer).toContain('Analysis complete')
      expect(footer).toContain('Completed at:')
      expect(footer).toContain('Duration:')
      Date.now = originalDateNow
    })

    it('should create test results summary', () => {
      const summary = createSummaryFooter({
        total: 500,
        success: 490,
        failed: 5,
        skipped: 5,
        warnings: 10,
      })
      expect(summary).toContain('Total: 500')
      expect(summary).toContain('490 passed')
      expect(summary).toContain('5 failed')
      expect(summary).toContain('5 skipped')
      expect(summary).toContain('10 warnings')
    })

    it('should support multiple footer styles', () => {
      const simple = createFooter('Done')
      const detailed = createFooter('Done', {
        showTimestamp: true,
        showDuration: true,
        startTime: Date.now() - 5000,
      })
      const summary = createSummaryFooter({ total: 100, success: 100 })

      expect(simple).toContain('Done')
      expect(detailed).toContain('Done')
      expect(summary).toContain('100 passed')
    })

    it('should handle build report footer', () => {
      Date.now = vi.fn(() => 15_000)
      const footer = createFooter('Build successful', {
        showDuration: true,
        startTime: 10_000,
        color: 'green',
        width: 70,
      })
      expect(footer).toContain('Build successful')
      expect(footer).toContain('Duration: 5.00s')
      expect(footer).toContain('='.repeat(70))
      Date.now = originalDateNow
    })
  })

  describe('edge cases', () => {
    it('should handle zero width', () => {
      const result = createFooter(undefined, { width: 0 })
      expect(result).toBe('')
    })

    it('should handle width of 1', () => {
      const result = createFooter(undefined, { width: 1 })
      expect(result).toBe('=')
    })

    it('should handle empty border char', () => {
      const result = createFooter(undefined, { borderChar: '' })
      expect(result).toBe('')
    })

    it('should handle multi-character border', () => {
      const result = createFooter(undefined, { borderChar: '=-' })
      expect(result).toContain('=-')
    })

    it('should handle negative startTime', () => {
      Date.now = vi.fn(() => 1000)
      const result = createFooter('Done', {
        showDuration: true,
        startTime: -5000,
      })
      // Should still work, just show large duration
      expect(result).toContain('Duration:')
      Date.now = originalDateNow
    })

    it('should handle startTime in future', () => {
      Date.now = vi.fn(() => 1000)
      const result = createFooter('Done', {
        showDuration: true,
        startTime: 10_000,
      })
      // Negative duration
      expect(result).toContain('Duration:')
      Date.now = originalDateNow
    })

    it('should handle message with newlines', () => {
      const result = createFooter('Line1\nLine2')
      expect(result).toContain('Line1')
      expect(result).toContain('Line2')
    })

    it('should handle negative stat values', () => {
      const result = createSummaryFooter({
        total: -10,
        success: -5,
      })
      expect(result).toContain('Total: -10')
      expect(result).toContain('-5 passed')
    })
  })

  describe('real-world usage', () => {
    it('should create CLI command completion footer', () => {
      Date.now = vi.fn(() => 5000)
      const footer = createFooter('Command completed successfully', {
        showDuration: true,
        startTime: 2000,
        color: 'green',
      })
      expect(footer).toContain('Command completed successfully')
      expect(footer).toContain('Duration: 3.00s')
      Date.now = originalDateNow
    })

    it('should create test suite summary', () => {
      const summary = createSummaryFooter({
        total: 1247,
        success: 1245,
        failed: 2,
        skipped: 0,
        warnings: 15,
      })
      expect(summary).toContain('Total: 1247')
      expect(summary).toContain('1245 passed')
      expect(summary).toContain('2 failed')
      expect(summary).not.toContain('skipped')
      expect(summary).toContain('15 warnings')
    })

    it('should create build summary', () => {
      Date.now = vi.fn(() => 45_000)
      const summary = createSummaryFooter(
        {
          total: 350,
          success: 348,
          failed: 2,
          warnings: 25,
          duration: 15_000,
        },
        { color: 'blue' },
      )
      expect(summary).toContain('Total: 350')
      expect(summary).toContain('348 passed')
      expect(summary).toContain('2 failed')
      expect(summary).toContain('25 warnings')
      expect(summary).toContain('Duration:')
      Date.now = originalDateNow
    })

    it('should create linter summary', () => {
      const summary = createSummaryFooter({
        total: 87,
        errors: 5,
        warnings: 23,
      })
      expect(summary).toContain('Total: 87')
      expect(summary).toContain('5 errors')
      expect(summary).toContain('23 warnings')
    })

    it('should create perfect test run summary', () => {
      const summary = createSummaryFooter({
        total: 500,
        success: 500,
        failed: 0,
        skipped: 0,
      })
      expect(summary).toContain('Total: 500')
      expect(summary).toContain('500 passed')
      expect(summary).not.toContain('failed')
      expect(summary).not.toContain('skipped')
    })

    it('should create analysis report footer', () => {
      Date.now = vi.fn(() => 30_000)
      const footer = createFooter('Security analysis complete', {
        showTimestamp: true,
        showDuration: true,
        startTime: 15_000,
        width: 80,
      })
      expect(footer).toContain('Security analysis complete')
      expect(footer).toContain('Completed at:')
      expect(footer).toContain('Duration: 15.00s')
      Date.now = originalDateNow
    })
  })
})
