/**
 * Unit tests for error message with badge.
 *
 * Purpose:
 * Tests error message formatting with severity badges. Validates colored badge display with error messages.
 *
 * Test Coverage:
 * - Severity badge rendering
 * - Color coding (red for error, yellow for warning)
 * - Message formatting
 * - Multi-line error support
 * - ANSI escape sequences
 *
 * Testing Approach:
 * Tests formatted error output with visual indicators.
 *
 * Related Files:
 * - utils/error/fail-msg-with-badge.mts (implementation)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock yoctocolors-cjs BEFORE importing the module under test
vi.mock('yoctocolors-cjs', () => ({
  default: {
    bgRedBright: (str: string) => `[BG_RED_BRIGHT]${str}[/BG_RED_BRIGHT]`,
    bold: (str: string) => `[BOLD]${str}[/BOLD]`,
    white: (str: string) => `[WHITE]${str}[/WHITE]`,
  },
}))

import { failMsgWithBadge } from '../../../../src/utils/error/fail-msg-with-badge.mts'

describe('failMsgWithBadge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('with message', () => {
    it('formats badge with message', () => {
      const result = failMsgWithBadge('ERROR', 'Something went wrong')
      expect(result).toBe(
        '[BG_RED_BRIGHT][BOLD][WHITE] ERROR: [/WHITE][/BOLD][/BG_RED_BRIGHT] [BOLD]Something went wrong[/BOLD]',
      )
    })

    it('handles long badge text', () => {
      const result = failMsgWithBadge(
        'CATASTROPHIC_SYSTEM_FAILURE',
        'Error message',
      )
      expect(result).toContain('CATASTROPHIC_SYSTEM_FAILURE: ')
      expect(result).toContain('[BOLD]Error message[/BOLD]')
    })

    it('handles special characters in badge', () => {
      const result = failMsgWithBadge('ERROR-123', 'Test message')
      expect(result).toContain('[WHITE] ERROR-123: [/WHITE]')
      expect(result).toContain('[BOLD]Test message[/BOLD]')
    })

    it('handles Unicode emoji in badge', () => {
      const result = failMsgWithBadge('⚠️ WARNING', 'Be careful')
      expect(result).toContain('[WHITE] ⚠️ WARNING: [/WHITE]')
      expect(result).toContain('[BOLD]Be careful[/BOLD]')
    })

    it('handles multi-line messages', () => {
      const message = 'Line 1\nLine 2\nLine 3'
      const result = failMsgWithBadge('ERROR', message)
      expect(result).toContain('[BOLD]Line 1\nLine 2\nLine 3[/BOLD]')
    })

    it('handles special characters in message', () => {
      const result = failMsgWithBadge('ERROR', 'Failed: ❌ Invalid input!')
      expect(result).toContain('[BOLD]Failed: ❌ Invalid input![/BOLD]')
    })

    it('handles very long messages', () => {
      const longMessage = 'a'.repeat(1000)
      const result = failMsgWithBadge('ERROR', longMessage)
      expect(result).toContain(`[BOLD]${longMessage}[/BOLD]`)
    })

    it('handles message with only spaces', () => {
      const result = failMsgWithBadge('ERROR', '   ')
      expect(result).toBe(
        '[BG_RED_BRIGHT][BOLD][WHITE] ERROR: [/WHITE][/BOLD][/BG_RED_BRIGHT] [BOLD]   [/BOLD]',
      )
    })

    it('handles tabs and special whitespace in message', () => {
      const result = failMsgWithBadge('ERROR', '\t\tTabbed message')
      expect(result).toContain('[BOLD]\t\tTabbed message[/BOLD]')
    })

    it('handles message with ANSI escape sequences', () => {
      const result = failMsgWithBadge('ERROR', '\x1b[31mRed text\x1b[0m')
      expect(result).toContain('[BOLD]\x1b[31mRed text\x1b[0m[/BOLD]')
    })
  })

  describe('without message', () => {
    it('formats badge without message', () => {
      const result = failMsgWithBadge('FAIL', undefined)
      expect(result).toBe(
        '[BG_RED_BRIGHT][BOLD][WHITE] FAIL[/WHITE][/BOLD][/BG_RED_BRIGHT]',
      )
    })

    it('handles empty badge without message', () => {
      const result = failMsgWithBadge('', undefined)
      expect(result).toBe(
        '[BG_RED_BRIGHT][BOLD][WHITE] [/WHITE][/BOLD][/BG_RED_BRIGHT]',
      )
    })

    it('handles badge with only spaces without message', () => {
      const result = failMsgWithBadge('   ', undefined)
      expect(result).toBe(
        '[BG_RED_BRIGHT][BOLD][WHITE]    [/WHITE][/BOLD][/BG_RED_BRIGHT]',
      )
    })
  })

  describe('edge cases with empty string message', () => {
    it('treats empty string message as no message', () => {
      const result = failMsgWithBadge('WARN', '')
      expect(result).toBe(
        '[BG_RED_BRIGHT][BOLD][WHITE] WARN[/WHITE][/BOLD][/BG_RED_BRIGHT]',
      )
    })

    it('handles empty badge with empty message', () => {
      const result = failMsgWithBadge('', '')
      expect(result).toBe(
        '[BG_RED_BRIGHT][BOLD][WHITE] [/WHITE][/BOLD][/BG_RED_BRIGHT]',
      )
    })
  })

  describe('null and type coercion', () => {
    it('handles null as message', () => {
      // @ts-expect-error Testing runtime behavior with null.
      const result = failMsgWithBadge('ERROR', null)
      expect(result).toBe(
        '[BG_RED_BRIGHT][BOLD][WHITE] ERROR[/WHITE][/BOLD][/BG_RED_BRIGHT]',
      )
    })

    it('handles number 0 as string message', () => {
      const result = failMsgWithBadge('ERROR', '0')
      expect(result).toContain('[BOLD]0[/BOLD]')
    })

    it('handles string "false" as message', () => {
      const result = failMsgWithBadge('ERROR', 'false')
      expect(result).toContain('[BOLD]false[/BOLD]')
    })

    it('handles boolean false as message (type coercion)', () => {
      // @ts-expect-error Testing runtime behavior.
      const result = failMsgWithBadge('ERROR', false)
      // false is falsy, should behave like undefined.
      expect(result).toBe(
        '[BG_RED_BRIGHT][BOLD][WHITE] ERROR[/WHITE][/BOLD][/BG_RED_BRIGHT]',
      )
    })

    it('handles boolean true as message (type coercion)', () => {
      // @ts-expect-error Testing runtime behavior.
      const result = failMsgWithBadge('ERROR', true)
      // true is truthy, should add colon and format the message.
      expect(result).toBe(
        '[BG_RED_BRIGHT][BOLD][WHITE] ERROR: [/WHITE][/BOLD][/BG_RED_BRIGHT] [BOLD]true[/BOLD]',
      )
    })

    it('handles number as message (type coercion)', () => {
      // @ts-expect-error Testing runtime behavior.
      const result = failMsgWithBadge('ERROR', 42)
      // Number is truthy, should add colon and format the message.
      expect(result).toBe(
        '[BG_RED_BRIGHT][BOLD][WHITE] ERROR: [/WHITE][/BOLD][/BG_RED_BRIGHT] [BOLD]42[/BOLD]',
      )
    })

    it('handles object as message (type coercion)', () => {
      // @ts-expect-error Testing runtime behavior.
      const result = failMsgWithBadge('ERROR', { error: 'details' })
      // Object is truthy, should add colon and format the message.
      expect(result).toBe(
        '[BG_RED_BRIGHT][BOLD][WHITE] ERROR: [/WHITE][/BOLD][/BG_RED_BRIGHT] [BOLD][object Object][/BOLD]',
      )
    })

    it('handles array as message (type coercion)', () => {
      // @ts-expect-error Testing runtime behavior.
      const result = failMsgWithBadge('ERROR', ['item1', 'item2'])
      // Array is truthy, should add colon and format the message.
      expect(result).toBe(
        '[BG_RED_BRIGHT][BOLD][WHITE] ERROR: [/WHITE][/BOLD][/BG_RED_BRIGHT] [BOLD]item1,item2[/BOLD]',
      )
    })
  })

  describe('formatting consistency', () => {
    it('consistently formats the same inputs', () => {
      const result1 = failMsgWithBadge('ERROR', 'Message')
      const result2 = failMsgWithBadge('ERROR', 'Message')
      expect(result1).toBe(result2)
    })

    it('correctly adds colon only when message is truthy', () => {
      const withMessage = failMsgWithBadge('ERROR', 'msg')
      const withoutMessage = failMsgWithBadge('ERROR', undefined)
      const withEmptyMessage = failMsgWithBadge('ERROR', '')

      expect(withMessage).toContain('ERROR: ')
      expect(withoutMessage).toContain(' ERROR[/WHITE]')
      expect(withoutMessage).not.toContain(': ')
      expect(withEmptyMessage).toContain(' ERROR[/WHITE]')
      expect(withEmptyMessage).not.toContain(': ')
    })

    it('always adds space before badge text', () => {
      const result = failMsgWithBadge('TEST', 'msg')
      expect(result).toContain('[WHITE] TEST: [/WHITE]')
    })

    it('always adds space before message text when present', () => {
      const result = failMsgWithBadge('TEST', 'msg')
      expect(result).toMatch(/\] \[BOLD\]msg/)
    })

    it('preserves original badge and message values', () => {
      const badge = 'ORIGINAL'
      const message = 'Original message'

      failMsgWithBadge(badge, message)

      // Ensure the function doesn't mutate the inputs.
      expect(badge).toBe('ORIGINAL')
      expect(message).toBe('Original message')
    })
  })
})
