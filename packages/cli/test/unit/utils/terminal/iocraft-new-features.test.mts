import { describe, expect, it } from 'vitest'

import {
  Box,
  Fragment,
  MixedText,
  Text,
  renderToString,
} from '../../../../src/utils/terminal/iocraft.mts'

describe('iocraft new features', () => {
  describe('MixedText component', () => {
    it('should create mixed text with multiple sections', () => {
      const element = MixedText({
        contents: [
          { text: 'Error: ', color: 'red', weight: 'bold' },
          { text: 'File not found', color: 'white' },
        ],
      })

      expect(element.type).toBe('MixedText')
      expect(element.mixed_text_contents).toHaveLength(2)
      expect(element.mixed_text_contents[0].text).toBe('Error: ')
      expect(element.mixed_text_contents[0].color).toBe('red')
      expect(element.mixed_text_contents[0].weight).toBe('bold')
      expect(element.mixed_text_contents[1].text).toBe('File not found')
      expect(element.mixed_text_contents[1].color).toBe('white')
    })

    it('should support all text decorations in mixed text', () => {
      const element = MixedText({
        contents: [
          { text: 'underlined ', decoration: 'underline' },
          { text: 'strikethrough ', decoration: 'strikethrough' },
          { text: 'none', decoration: 'none' },
        ],
      })

      expect(element.mixed_text_contents[0].decoration).toBe('underline')
      expect(element.mixed_text_contents[1].decoration).toBe('strikethrough')
      expect(element.mixed_text_contents[2].decoration).toBe('none')
    })

    it('should support italic in mixed text sections', () => {
      const element = MixedText({
        contents: [
          { text: 'normal ', italic: false },
          { text: 'italic', italic: true },
        ],
      })

      expect(element.mixed_text_contents[0].italic).toBe(false)
      expect(element.mixed_text_contents[1].italic).toBe(true)
    })

    it('should support alignment in mixed text', () => {
      const leftElement = MixedText({
        contents: [{ text: 'left' }],
        align: 'left',
      })
      const centerElement = MixedText({
        contents: [{ text: 'center' }],
        align: 'center',
      })
      const rightElement = MixedText({
        contents: [{ text: 'right' }],
        align: 'right',
      })

      expect(leftElement.align).toBe('left')
      expect(centerElement.align).toBe('center')
      expect(rightElement.align).toBe('right')
    })

    it('should support wrapping in mixed text', () => {
      const wrapElement = MixedText({
        contents: [{ text: 'wrap' }],
        wrap: 'wrap',
      })
      const nowrapElement = MixedText({
        contents: [{ text: 'nowrap' }],
        wrap: 'nowrap',
      })

      expect(wrapElement.wrap).toBe('wrap')
      expect(nowrapElement.wrap).toBe('nowrap')
    })

    it('should render mixed text to string', () => {
      const element = MixedText({
        contents: [
          { text: 'Hello ', color: 'green' },
          { text: 'World', color: 'blue', weight: 'bold' },
        ],
      })

      const output = renderToString(element)
      expect(output).toContain('Hello World')
    })
  })

  describe('Fragment component', () => {
    it('should create fragment with multiple children', () => {
      const element = Fragment({
        children: [
          Text({ children: 'Line 1' }),
          Text({ children: 'Line 2' }),
          Text({ children: 'Line 3' }),
        ],
      })

      expect(element.type).toBe('Fragment')
      expect(element.children).toHaveLength(3)
    })

    it('should create fragment with single child', () => {
      const element = Fragment({
        children: Text({ children: 'Single line' }),
      })

      expect(element.type).toBe('Fragment')
      expect(element.children).toHaveLength(1)
    })

    it('should render fragment to string', () => {
      const element = Fragment({
        children: [
          Text({ children: 'Line 1' }),
          Text({ children: 'Line 2' }),
        ],
      })

      const output = renderToString(element)
      expect(output).toContain('Line 1')
      expect(output).toContain('Line 2')
    })
  })

  describe('BorderStyle variants', () => {
    it('should support single border style', () => {
      const element = Box({
        borderStyle: 'single',
        children: Text({ children: 'test' }),
      })

      expect(element.border_style).toBe('single')
    })

    it('should support double border style', () => {
      const element = Box({
        borderStyle: 'double',
        children: Text({ children: 'test' }),
      })

      expect(element.border_style).toBe('double')
    })

    it('should support rounded border style', () => {
      const element = Box({
        borderStyle: 'rounded',
        children: Text({ children: 'test' }),
      })

      expect(element.border_style).toBe('rounded')
    })

    it('should support bold border style', () => {
      const element = Box({
        borderStyle: 'bold',
        children: Text({ children: 'test' }),
      })

      expect(element.border_style).toBe('bold')
    })

    it('should support double-left-right border style', () => {
      const element = Box({
        borderStyle: 'double-left-right',
        children: Text({ children: 'test' }),
      })

      expect(element.border_style).toBe('double-left-right')
    })

    it('should support double-top-bottom border style', () => {
      const element = Box({
        borderStyle: 'double-top-bottom',
        children: Text({ children: 'test' }),
      })

      expect(element.border_style).toBe('double-top-bottom')
    })

    it('should support classic border style', () => {
      const element = Box({
        borderStyle: 'classic',
        children: Text({ children: 'test' }),
      })

      expect(element.border_style).toBe('classic')
    })
  })

  describe('Custom BorderCharacters', () => {
    it('should support custom border characters', () => {
      const element = Box({
        customBorderChars: {
          topLeft: '╔',
          topRight: '╗',
          bottomLeft: '╚',
          bottomRight: '╝',
          top: '═',
          bottom: '═',
          left: '║',
          right: '║',
        },
        children: Text({ children: 'test' }),
      })

      expect(element.custom_border_chars).toEqual({
        top_left: '╔',
        top_right: '╗',
        bottom_left: '╚',
        bottom_right: '╝',
        top: '═',
        bottom: '═',
        left: '║',
        right: '║',
      })
    })

    it('should render custom border correctly', () => {
      const element = Box({
        customBorderChars: {
          topLeft: '+',
          topRight: '+',
          bottomLeft: '+',
          bottomRight: '+',
          top: '-',
          bottom: '-',
          left: '|',
          right: '|',
        },
        children: Text({ children: 'test' }),
      })

      const output = renderToString(element)
      expect(output.length).toBeGreaterThan(0)
    })
  })

  describe('ANSI 256 colors', () => {
    it('should support ANSI color with ansi: prefix', () => {
      const element = Text({
        children: 'test',
        color: 'ansi:123',
      })

      expect(element.color).toBe('ansi:123')
    })

    it('should support bare number as ANSI color', () => {
      const element = Text({
        children: 'test',
        color: '196',
      })

      expect(element.color).toBe('196')
    })

    it('should support ANSI colors in border', () => {
      const element = Box({
        borderColor: 'ansi:208',
        borderStyle: 'single',
        children: Text({ children: 'test' }),
      })

      expect(element.border_color).toBe('ansi:208')
    })

    it('should support ANSI colors in background', () => {
      const element = Box({
        backgroundColor: '227',
        children: Text({ children: 'test' }),
      })

      expect(element.background_color).toBe('227')
    })

    it('should support ANSI colors in mixed text', () => {
      const element = MixedText({
        contents: [
          { text: 'orange', color: 'ansi:208' },
          { text: 'pink', color: '213' },
        ],
      })

      expect(element.mixed_text_contents[0].color).toBe('ansi:208')
      expect(element.mixed_text_contents[1].color).toBe('213')
    })
  })

  describe('Complex scenarios', () => {
    it('should support fragment with mixed text children', () => {
      const element = Fragment({
        children: [
          MixedText({
            contents: [
              { text: 'Error: ', color: 'red', weight: 'bold' },
              { text: 'Failed', color: 'white' },
            ],
          }),
          MixedText({
            contents: [
              { text: 'Warning: ', color: 'yellow', weight: 'bold' },
              { text: 'Deprecated', color: 'white' },
            ],
          }),
        ],
      })

      expect(element.children).toHaveLength(2)
      expect(element.children[0].type).toBe('MixedText')
      expect(element.children[1].type).toBe('MixedText')
    })

    it('should support box with all new border features', () => {
      const element = Box({
        borderStyle: 'double-left-right',
        borderColor: 'ansi:33',
        borderEdges: { top: true, bottom: true, left: false, right: false },
        children: MixedText({
          contents: [
            { text: 'Status: ', weight: 'bold' },
            { text: 'OK', color: 'green' },
          ],
        }),
      })

      expect(element.border_style).toBe('double-left-right')
      expect(element.border_color).toBe('ansi:33')
      expect(element.border_edges).toEqual({
        top: true,
        bottom: true,
        left: false,
        right: false,
      })
      expect(element.children[0].type).toBe('MixedText')
    })

    it('should support nested fragments', () => {
      const element = Fragment({
        children: Fragment({
          children: [
            Text({ children: 'Nested' }),
            Text({ children: 'Fragment' }),
          ],
        }),
      })

      expect(element.type).toBe('Fragment')
      expect(element.children).toHaveLength(1)
      expect(element.children[0].type).toBe('Fragment')
    })
  })
})
