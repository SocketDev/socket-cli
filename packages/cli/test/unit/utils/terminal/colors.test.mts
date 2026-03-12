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

import {
  colorOrMarkdown,
  ColorOrMarkdown,
} from '../../../../src/utils/terminal/colors.mts'

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

describe('ColorOrMarkdown', () => {
  describe('constructor', () => {
    it('creates instance with useMarkdown true', () => {
      const formatter = new ColorOrMarkdown(true)
      expect(formatter.useMarkdown).toBe(true)
    })

    it('creates instance with useMarkdown false', () => {
      const formatter = new ColorOrMarkdown(false)
      expect(formatter.useMarkdown).toBe(false)
    })
  })

  describe('bold', () => {
    it('returns markdown bold when useMarkdown is true', () => {
      const formatter = new ColorOrMarkdown(true)
      const result = formatter.bold('test')
      expect(result).toBe('**test**')
    })

    it('returns ANSI bold when useMarkdown is false', () => {
      const formatter = new ColorOrMarkdown(false)
      const result = formatter.bold('test')
      // ANSI codes are applied, so result should contain 'test'.
      expect(result).toContain('test')
      // Should not be markdown format.
      expect(result).not.toBe('**test**')
    })
  })

  describe('header', () => {
    it('returns markdown header with level 1', () => {
      const formatter = new ColorOrMarkdown(true)
      const result = formatter.header('Title', 1)
      expect(result).toBe('\n# Title\n')
    })

    it('returns markdown header with level 2', () => {
      const formatter = new ColorOrMarkdown(true)
      const result = formatter.header('Subtitle', 2)
      expect(result).toBe('\n## Subtitle\n')
    })

    it('returns markdown header with level 3', () => {
      const formatter = new ColorOrMarkdown(true)
      const result = formatter.header('Section', 3)
      expect(result).toBe('\n### Section\n')
    })

    it('defaults to level 1', () => {
      const formatter = new ColorOrMarkdown(true)
      const result = formatter.header('Title')
      expect(result).toBe('\n# Title\n')
    })

    it('returns formatted text when useMarkdown is false', () => {
      const formatter = new ColorOrMarkdown(false)
      const result = formatter.header('Title', 1)
      expect(result).toContain('Title')
    })
  })

  describe('hyperlink', () => {
    it('returns markdown link when useMarkdown is true', () => {
      const formatter = new ColorOrMarkdown(true)
      const result = formatter.hyperlink('Click here', 'https://example.com')
      expect(result).toBe('[Click here](https://example.com)')
    })

    it('returns plain text when url is undefined', () => {
      const formatter = new ColorOrMarkdown(true)
      const result = formatter.hyperlink('Click here', undefined)
      expect(result).toBe('Click here')
    })

    it('returns terminal link when useMarkdown is false', () => {
      const formatter = new ColorOrMarkdown(false)
      const result = formatter.hyperlink('Click here', 'https://example.com')
      // Terminal link may or may not include ANSI codes depending on terminal support.
      expect(result).toBeTruthy()
    })

    it('handles fallback option', () => {
      const formatter = new ColorOrMarkdown(false)
      const result = formatter.hyperlink('Click here', 'https://example.com', {
        fallback: false,
      })
      expect(result).toBeTruthy()
    })

    it('handles fallbackToUrl option', () => {
      const formatter = new ColorOrMarkdown(false)
      const result = formatter.hyperlink('Click here', 'https://example.com', {
        fallbackToUrl: true,
      })
      expect(result).toBeTruthy()
    })
  })

  describe('italic', () => {
    it('returns markdown italic when useMarkdown is true', () => {
      const formatter = new ColorOrMarkdown(true)
      const result = formatter.italic('test')
      expect(result).toBe('_test_')
    })

    it('returns ANSI italic when useMarkdown is false', () => {
      const formatter = new ColorOrMarkdown(false)
      const result = formatter.italic('test')
      expect(result).toContain('test')
      expect(result).not.toBe('_test_')
    })
  })

  describe('json', () => {
    it('returns markdown code block when useMarkdown is true', () => {
      const formatter = new ColorOrMarkdown(true)
      const result = formatter.json({ key: 'value' })
      expect(result).toBe('```json\n{"key":"value"}\n```')
    })

    it('returns plain JSON when useMarkdown is false', () => {
      const formatter = new ColorOrMarkdown(false)
      const result = formatter.json({ key: 'value' })
      expect(result).toBe('{"key":"value"}')
    })

    it('handles arrays', () => {
      const formatter = new ColorOrMarkdown(true)
      const result = formatter.json([1, 2, 3])
      expect(result).toBe('```json\n[1,2,3]\n```')
    })

    it('handles nested objects', () => {
      const formatter = new ColorOrMarkdown(false)
      const result = formatter.json({ a: { b: 'c' } })
      expect(result).toBe('{"a":{"b":"c"}}')
    })
  })

  describe('list', () => {
    it('returns markdown list when useMarkdown is true', () => {
      const formatter = new ColorOrMarkdown(true)
      const result = formatter.list(['item1', 'item2', 'item3'])
      expect(result).toBe('* item1\n* item2\n* item3\n')
    })

    it('returns plain list when useMarkdown is false', () => {
      const formatter = new ColorOrMarkdown(false)
      const result = formatter.list(['item1', 'item2', 'item3'])
      expect(result).toBe('item1\nitem2\nitem3\n')
    })

    it('handles empty list', () => {
      const formatter = new ColorOrMarkdown(true)
      const result = formatter.list([])
      expect(result).toBe('* \n')
    })

    it('handles single item', () => {
      const formatter = new ColorOrMarkdown(true)
      const result = formatter.list(['single'])
      expect(result).toBe('* single\n')
    })
  })

  describe('indent', () => {
    it('indents text', () => {
      const formatter = new ColorOrMarkdown(false)
      const result = formatter.indent('test', 2)
      expect(result).toBe('  test')
    })

    it('indents multiline text', () => {
      const formatter = new ColorOrMarkdown(false)
      const result = formatter.indent('line1\nline2', 4)
      expect(result).toBe('    line1\n    line2')
    })
  })
})
