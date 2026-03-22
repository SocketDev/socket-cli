/**
 * @fileoverview Unit tests for iocraft property support.
 *
 * Tests all iocraft properties including text styling, layout positioning,
 * dimensions, flex layout, and border configuration.
 */

import { describe, expect, it } from 'vitest'

import { Box, Text, renderToString } from '../../../../src/utils/terminal/iocraft.mjs'

describe('iocraft properties', () => {
  describe('Text properties', () => {
    describe('weight property', () => {
      it('should render text with normal weight', () => {
        const element = Text({ children: 'test', weight: 'normal' })
        expect(element.weight).toBe('normal')
      })

      it('should render text with bold weight', () => {
        const element = Text({ children: 'test', weight: 'bold' })
        expect(element.weight).toBe('bold')
      })

      it('should render text with light weight (dimColor)', () => {
        const element = Text({ children: 'test', weight: 'light' })
        expect(element.weight).toBe('light')
      })
    })

    describe('dimColor property', () => {
      it('should apply dim color to text', () => {
        const element = Text({ children: 'test', dimColor: true })
        expect(element.dim_color).toBe(true)
      })

      it('should render dim text to string', () => {
        const element = Text({ children: 'test', dimColor: true })
        const output = renderToString(element)
        expect(output).toContain('test')
      })
    })

    describe('strikethrough property', () => {
      it('should apply strikethrough to text', () => {
        const element = Text({ children: 'test', strikethrough: true })
        expect(element.strikethrough).toBe(true)
      })

      it('should render strikethrough text to string', () => {
        const element = Text({ children: 'test', strikethrough: true })
        const output = renderToString(element)
        expect(output).toContain('test')
      })
    })

    describe('align property', () => {
      it('should align text left', () => {
        const element = Text({ children: 'test', align: 'left' })
        expect(element.align).toBe('left')
      })

      it('should align text center', () => {
        const element = Text({ children: 'test', align: 'center' })
        expect(element.align).toBe('center')
      })

      it('should align text right', () => {
        const element = Text({ children: 'test', align: 'right' })
        expect(element.align).toBe('right')
      })
    })

    describe('wrap property', () => {
      it('should enable text wrapping', () => {
        const element = Text({ children: 'test', wrap: 'wrap' })
        expect(element.wrap).toBe('wrap')
      })

      it('should disable text wrapping', () => {
        const element = Text({ children: 'test', wrap: 'nowrap' })
        expect(element.wrap).toBe('nowrap')
      })
    })

    describe('combined text properties', () => {
      it('should handle multiple text styling properties', () => {
        const element = Text({
          children: 'test',
          bold: true,
          dimColor: true,
          italic: true,
          strikethrough: true,
          underline: true,
          weight: 'bold',
        })
        expect(element.bold).toBe(true)
        expect(element.dim_color).toBe(true)
        expect(element.italic).toBe(true)
        expect(element.strikethrough).toBe(true)
        expect(element.underline).toBe(true)
        expect(element.weight).toBe('bold')
      })
    })
  })

  describe('Box flex properties', () => {
    describe('flexBasis property', () => {
      it('should set flex basis as number', () => {
        const element = Box({ flexBasis: 100 })
        expect(element.flex_basis).toBe(100)
      })

      it('should set flex basis as auto string', () => {
        const element = Box({ flexBasis: 'auto' })
        expect(element.flex_basis).toBe('auto')
      })

      it('should set flex basis as percentage string', () => {
        const element = Box({ flexBasis: '50%' })
        expect(element.flex_basis).toBe('50%')
      })
    })

    describe('flexWrap property', () => {
      it('should enable flex wrap', () => {
        const element = Box({ flexWrap: 'wrap' })
        expect(element.flex_wrap).toBe('wrap')
      })

      it('should disable flex wrap', () => {
        const element = Box({ flexWrap: 'nowrap' })
        expect(element.flex_wrap).toBe('nowrap')
      })
    })

    describe('alignContent property', () => {
      it('should set align content to flex-start', () => {
        const element = Box({ alignContent: 'flex-start' })
        expect(element.align_content).toBe('flex-start')
      })

      it('should set align content to center', () => {
        const element = Box({ alignContent: 'center' })
        expect(element.align_content).toBe('center')
      })

      it('should set align content to space-between', () => {
        const element = Box({ alignContent: 'space-between' })
        expect(element.align_content).toBe('space-between')
      })
    })

    describe('gap properties', () => {
      it('should set row gap', () => {
        const element = Box({ rowGap: 2 })
        expect(element.row_gap).toBe(2)
      })

      it('should set column gap', () => {
        const element = Box({ columnGap: 3 })
        expect(element.column_gap).toBe(3)
      })

      it('should set both row and column gap', () => {
        const element = Box({ gap: 1, rowGap: 2, columnGap: 3 })
        expect(element.gap).toBe(1)
        expect(element.row_gap).toBe(2)
        expect(element.column_gap).toBe(3)
      })
    })
  })

  describe('Box overflow properties', () => {
    describe('overflowX property', () => {
      it('should set overflow-x to visible', () => {
        const element = Box({ overflowX: 'visible' })
        expect(element.overflow_x).toBe('visible')
      })

      it('should set overflow-x to hidden', () => {
        const element = Box({ overflowX: 'hidden' })
        expect(element.overflow_x).toBe('hidden')
      })
    })

    describe('overflowY property', () => {
      it('should set overflow-y to visible', () => {
        const element = Box({ overflowY: 'visible' })
        expect(element.overflow_y).toBe('visible')
      })

      it('should set overflow-y to hidden', () => {
        const element = Box({ overflowY: 'hidden' })
        expect(element.overflow_y).toBe('hidden')
      })
    })

    describe('overflow shorthand property', () => {
      it('should set both overflow-x and overflow-y', () => {
        const element = Box({ overflow: 'hidden' })
        expect(element.overflow_x).toBe('hidden')
        expect(element.overflow_y).toBe('hidden')
      })

      it('should allow overflow-x to override shorthand', () => {
        const element = Box({ overflow: 'hidden', overflowX: 'visible' })
        expect(element.overflow_x).toBe('visible')
        expect(element.overflow_y).toBe('hidden')
      })
    })
  })

  describe('Box positioning properties', () => {
    describe('display property', () => {
      it('should set display to flex', () => {
        const element = Box({ display: 'flex' })
        expect(element.display).toBe('flex')
      })

      it('should set display to none', () => {
        const element = Box({ display: 'none' })
        expect(element.display).toBe('none')
      })
    })

    describe('position property', () => {
      it('should set position to relative', () => {
        const element = Box({ position: 'relative' })
        expect(element.position).toBe('relative')
      })

      it('should set position to absolute', () => {
        const element = Box({ position: 'absolute' })
        expect(element.position).toBe('absolute')
      })
    })

    describe('inset properties', () => {
      it('should set top inset', () => {
        const element = Box({ top: 10 })
        expect(element.top).toBe(10)
      })

      it('should set right inset', () => {
        const element = Box({ right: 20 })
        expect(element.right).toBe(20)
      })

      it('should set bottom inset', () => {
        const element = Box({ bottom: 30 })
        expect(element.bottom).toBe(30)
      })

      it('should set left inset', () => {
        const element = Box({ left: 40 })
        expect(element.left).toBe(40)
      })

      it('should set inset shorthand for all sides', () => {
        const element = Box({ inset: 5 })
        expect(element.inset).toBe(5)
      })

      it('should handle negative inset values', () => {
        const element = Box({ top: -10, left: -5 })
        expect(element.top).toBe(-10)
        expect(element.left).toBe(-5)
      })
    })
  })

  describe('Box dimension properties', () => {
    describe('min/max width properties', () => {
      it('should set min width', () => {
        const element = Box({ minWidth: 10 })
        expect(element.min_width).toBe(10)
      })

      it('should set max width', () => {
        const element = Box({ maxWidth: 100 })
        expect(element.max_width).toBe(100)
      })

      it('should set both min and max width', () => {
        const element = Box({ minWidth: 10, maxWidth: 100, width: 50 })
        expect(element.min_width).toBe(10)
        expect(element.max_width).toBe(100)
        expect(element.width).toBe(50)
      })
    })

    describe('min/max height properties', () => {
      it('should set min height', () => {
        const element = Box({ minHeight: 5 })
        expect(element.min_height).toBe(5)
      })

      it('should set max height', () => {
        const element = Box({ maxHeight: 50 })
        expect(element.max_height).toBe(50)
      })

      it('should set both min and max height', () => {
        const element = Box({ minHeight: 5, maxHeight: 50, height: 25 })
        expect(element.min_height).toBe(5)
        expect(element.max_height).toBe(50)
        expect(element.height).toBe(25)
      })
    })
  })

  describe('Box border properties', () => {
    describe('borderEdges property', () => {
      it('should set all border edges', () => {
        const element = Box({
          borderEdges: { bottom: true, left: true, right: true, top: true },
        })
        expect(element.border_edges).toEqual({
          bottom: true,
          left: true,
          right: true,
          top: true,
        })
      })

      it('should set only top border edge', () => {
        const element = Box({
          borderEdges: { bottom: false, left: false, right: false, top: true },
        })
        expect(element.border_edges).toEqual({
          bottom: false,
          left: false,
          right: false,
          top: true,
        })
      })

      it('should set selective border edges', () => {
        const element = Box({
          borderEdges: { bottom: true, left: false, right: false, top: true },
        })
        expect(element.border_edges).toEqual({
          bottom: true,
          left: false,
          right: false,
          top: true,
        })
      })
    })
  })

  describe('Complex layout scenarios', () => {
    it('should handle absolute positioned box with insets', () => {
      const element = Box({
        bottom: 0,
        left: 0,
        position: 'absolute',
        right: 0,
        top: 0,
      })
      expect(element.position).toBe('absolute')
      expect(element.top).toBe(0)
      expect(element.right).toBe(0)
      expect(element.bottom).toBe(0)
      expect(element.left).toBe(0)
    })

    it('should handle flex container with all flex properties', () => {
      const element = Box({
        alignContent: 'space-between',
        alignItems: 'center',
        columnGap: 2,
        flexBasis: 'auto',
        flexDirection: 'row',
        flexGrow: 1,
        flexShrink: 0,
        flexWrap: 'wrap',
        gap: 1,
        justifyContent: 'space-around',
        rowGap: 3,
      })
      expect(element.align_content).toBe('space-between')
      expect(element.align_items).toBe('center')
      expect(element.flex_direction).toBe('row')
      expect(element.flex_grow).toBe(1)
      expect(element.flex_shrink).toBe(0)
      expect(element.flex_basis).toBe('auto')
      expect(element.flex_wrap).toBe('wrap')
      expect(element.justify_content).toBe('space-around')
      expect(element.gap).toBe(1)
      expect(element.row_gap).toBe(3)
      expect(element.column_gap).toBe(2)
    })

    it('should handle constrained dimensions with overflow', () => {
      const element = Box({
        height: 20,
        maxHeight: 30,
        maxWidth: 100,
        minHeight: 10,
        minWidth: 50,
        overflow: 'hidden',
        width: 80,
      })
      expect(element.width).toBe(80)
      expect(element.height).toBe(20)
      expect(element.min_width).toBe(50)
      expect(element.max_width).toBe(100)
      expect(element.min_height).toBe(10)
      expect(element.max_height).toBe(30)
      expect(element.overflow_x).toBe('hidden')
      expect(element.overflow_y).toBe('hidden')
    })

    it('should handle styled text with alignment and wrapping', () => {
      const element = Text({
        align: 'center',
        bold: true,
        children: 'Hello, world!',
        color: 'blue',
        strikethrough: true,
        wrap: 'wrap',
      })
      expect(element.content).toBe('Hello, world!')
      expect(element.bold).toBe(true)
      expect(element.color).toBe('blue')
      expect(element.strikethrough).toBe(true)
      expect(element.align).toBe('center')
      expect(element.wrap).toBe('wrap')
    })

    it('should render complex nested structure', () => {
      const element = Box({
        alignItems: 'center',
        flexDirection: 'column',
        gap: 1,
        padding: 2,
        children: [
          Text({ children: 'Header', weight: 'bold', align: 'center' }),
          Box({
            borderStyle: 'single',
            children: [Text({ children: 'Content', dimColor: true })],
            padding: 1,
          }),
          Text({ children: 'Footer', strikethrough: true, align: 'right' }),
        ],
      })
      const output = renderToString(element)
      expect(output).toContain('Header')
      expect(output).toContain('Content')
      expect(output).toContain('Footer')
    })
  })
})
