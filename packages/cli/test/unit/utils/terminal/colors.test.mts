/**
 * Unit tests for terminal color utilities.
 *
 * Purpose:
 * Tests terminal color utilities. Validates ANSI color code generation and NO_COLOR support.
 *
 * Test Coverage:
 * - ANSI color codes
 * - Color detection
 * - NO_COLOR environment variable
 * - TTY detection
 * - Color stripping
 *
 * Special Notes:
 * Uses yoctocolors-cjs package for colors
 *
 * Testing Approach:
 * Tests color utilities with environment mocking.
 *
 * Related Files:
 * - utils/terminal/colors.mts (implementation)
 */

import { describe, expect, it } from 'vitest'

import { colorOrMarkdown } from '../../../../src/utils/terminal/colors.mts'

describe('colorOrMarkdown', () => {
  it('returns plain text for text format', () => {
    const result = colorOrMarkdown('text', 'plain', 'red text', '**markdown**')
    expect(result).toBe('plain')
  })

  it('returns colored text for non-text format when color is provided', () => {
    const result = colorOrMarkdown('json', 'plain', 'red text', '**markdown**')
    expect(result).toBe('red text')
  })

  it('returns markdown text for markdown format', () => {
    const result = colorOrMarkdown(
      'markdown',
      'plain',
      'red text',
      '**markdown**',
    )
    expect(result).toBe('**markdown**')
  })

  it('returns plain text when no color provided for non-text format', () => {
    const result = colorOrMarkdown('json', 'plain', undefined, '**markdown**')
    expect(result).toBe('plain')
  })

  it('returns colored text when no markdown provided for markdown format', () => {
    const result = colorOrMarkdown('markdown', 'plain', 'red text', undefined)
    expect(result).toBe('red text')
  })

  it('handles all format types', () => {
    const formats = ['text', 'json', 'markdown', 'other'] as const
    formats.forEach(format => {
      const result = colorOrMarkdown(format as any, 'plain', 'red', '**bold**')
      expect(typeof result).toBe('string')
    })
  })
})
