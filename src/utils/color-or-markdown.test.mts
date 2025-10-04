import { describe, expect, it } from 'vitest'

import { ColorOrMarkdown, colorOrMarkdown } from './color-or-markdown.mts'

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

describe('ColorOrMarkdown class', () => {
  describe('constructor', () => {
    it('creates instance with markdown enabled', () => {
      const formatter = new ColorOrMarkdown(true)
      expect(formatter.useMarkdown).toBe(true)
    })

    it('creates instance with markdown disabled', () => {
      const formatter = new ColorOrMarkdown(false)
      expect(formatter.useMarkdown).toBe(false)
    })
  })

  describe('bold', () => {
    it('returns markdown bold when markdown enabled', () => {
      const formatter = new ColorOrMarkdown(true)
      expect(formatter.bold('text')).toBe('**text**')
    })

    it('returns colored bold when markdown disabled', () => {
      const formatter = new ColorOrMarkdown(false)
      const result = formatter.bold('text')
      expect(result).toContain('text')
    })
  })

  describe('header', () => {
    it('returns markdown header level 1 when markdown enabled', () => {
      const formatter = new ColorOrMarkdown(true)
      expect(formatter.header('Title', 1)).toBe('\n# Title\n')
    })

    it('returns markdown header level 2 when markdown enabled', () => {
      const formatter = new ColorOrMarkdown(true)
      expect(formatter.header('Title', 2)).toBe('\n## Title\n')
    })

    it('returns colored header when markdown disabled', () => {
      const formatter = new ColorOrMarkdown(false)
      const result = formatter.header('Title')
      // Result includes ANSI codes, so just check for Title and newlines
      expect(result).toContain('Title')
      expect(result.includes('\n')).toBe(true)
    })

    it('uses level 1 by default', () => {
      const formatter = new ColorOrMarkdown(true)
      expect(formatter.header('Title')).toBe('\n# Title\n')
    })
  })

  describe('hyperlink', () => {
    it('returns markdown link when markdown enabled', () => {
      const formatter = new ColorOrMarkdown(true)
      expect(formatter.hyperlink('text', 'https://example.com')).toBe(
        '[text](https://example.com)',
      )
    })

    it('returns terminal link when markdown disabled', () => {
      const formatter = new ColorOrMarkdown(false)
      const result = formatter.hyperlink('text', 'https://example.com')
      expect(typeof result).toBe('string')
    })

    it('returns plain text when url is undefined', () => {
      const formatter = new ColorOrMarkdown(true)
      expect(formatter.hyperlink('text', undefined)).toBe('text')
    })

    it('handles fallbackToUrl option', () => {
      const formatter = new ColorOrMarkdown(false)
      const result = formatter.hyperlink('text', 'https://example.com', {
        fallbackToUrl: true,
      })
      expect(typeof result).toBe('string')
    })
  })

  describe('indent', () => {
    it('indents text with default spacing', () => {
      const formatter = new ColorOrMarkdown(true)
      const result = formatter.indent('text')
      // Default indentation is 1 space
      expect(result).toBe(' text')
    })

    it('indents text with custom spacing', () => {
      const formatter = new ColorOrMarkdown(true)
      const result = formatter.indent('text', 4)
      expect(result).toBe('    text')
    })

    it('indents multiline text', () => {
      const formatter = new ColorOrMarkdown(true)
      const result = formatter.indent('line1\nline2', 2)
      expect(result).toBe('  line1\n  line2')
    })
  })

  describe('italic', () => {
    it('returns markdown italic when markdown enabled', () => {
      const formatter = new ColorOrMarkdown(true)
      expect(formatter.italic('text')).toBe('_text_')
    })

    it('returns colored italic when markdown disabled', () => {
      const formatter = new ColorOrMarkdown(false)
      const result = formatter.italic('text')
      expect(result).toContain('text')
    })
  })

  describe('json', () => {
    it('returns markdown code block when markdown enabled', () => {
      const formatter = new ColorOrMarkdown(true)
      const result = formatter.json({ key: 'value' })
      expect(result).toBe('```json\n{"key":"value"}\n```')
    })

    it('returns plain JSON when markdown disabled', () => {
      const formatter = new ColorOrMarkdown(false)
      const result = formatter.json({ key: 'value' })
      expect(result).toBe('{"key":"value"}')
    })
  })

  describe('list', () => {
    it('returns markdown list when markdown enabled', () => {
      const formatter = new ColorOrMarkdown(true)
      const result = formatter.list(['item1', 'item2', 'item3'])
      expect(result).toBe('* item1\n* item2\n* item3\n')
    })

    it('returns plain list when markdown disabled', () => {
      const formatter = new ColorOrMarkdown(false)
      const result = formatter.list(['item1', 'item2', 'item3'])
      expect(result).toContain('item1')
      expect(result).toContain('item2')
      expect(result).toContain('item3')
    })

    it('handles empty list', () => {
      const formatter = new ColorOrMarkdown(true)
      const result = formatter.list([])
      expect(result).toBe('* \n')
    })
  })
})
