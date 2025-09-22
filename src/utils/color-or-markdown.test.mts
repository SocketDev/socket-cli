import { describe, expect, it } from 'vitest'

import { colorOrMarkdown } from './color-or-markdown.mts'

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
    const result = colorOrMarkdown('markdown', 'plain', 'red text', '**markdown**')
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