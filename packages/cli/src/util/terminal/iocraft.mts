/* max-file-lines: legitimate — tracks one cohesive module domain; splitting would scatter tightly coupled helpers. */
/**
 * @file Iocraft abstraction layer for terminal UI. Provides a React-like API
 *   for building terminal interfaces using iocraft native bindings. This layer
 *   is designed to be a drop-in replacement for the Ink-based UI.
 */

import { createRequire } from 'node:module'

import { getErrorCause } from '../error/errors.mts'

import type iocraft from '@socketaddon/iocraft'
import type * as IocraftNs from '@socketaddon/iocraft'

// Re-export iocraft types for direct access when needed.
export type { default as IocraftNative } from '@socketaddon/iocraft'

/**
 * Lazy-load iocraft to avoid import errors if the native module isn't
 * available.
 */
let iocraftInstance: typeof iocraft | undefined

/**
 * Create a box/view element with layout properties.
 */
export function Box(props: BoxProps): Element {
  const children = Array.isArray(props.children)
    ? props.children
    : props.children
      ? [props.children]
      : []

  // Create view node as plain object to avoid NAPI deserialization bugs
  const node: Element = {
    type: 'View',
    children,
  }

  // Display and positioning
  if (props.display) {
    node.display = props.display
  }
  if (props.position) {
    node.position = props.position
  }

  // Inset positioning
  if (props.bottom !== undefined) {
    node.bottom = props.bottom
  }
  if (props.inset !== undefined) {
    node.inset = props.inset
  }
  if (props.left !== undefined) {
    node.left = props.left
  }
  if (props.right !== undefined) {
    node.right = props.right
  }
  if (props.top !== undefined) {
    node.top = props.top
  }

  // Flex layout
  if (props.alignContent) {
    node.align_content = props.alignContent
  }
  if (props.alignItems) {
    node.align_items = props.alignItems
  }
  if (props.columnGap !== undefined) {
    node.column_gap = props.columnGap
  }
  if (props.flexBasis !== undefined) {
    node.flex_basis = props.flexBasis
  }
  if (props.flexDirection) {
    node.flex_direction = props.flexDirection
  }
  if (props.flexGrow !== undefined) {
    node.flex_grow = props.flexGrow
  }
  if (props.flexShrink !== undefined) {
    node.flex_shrink = props.flexShrink
  }
  if (props.flexWrap) {
    node.flex_wrap = props.flexWrap
  }
  if (props.gap !== undefined) {
    node.gap = props.gap
  }
  if (props.justifyContent) {
    node.justify_content = props.justifyContent
  }
  if (props.rowGap !== undefined) {
    node.row_gap = props.rowGap
  }

  // Dimensions
  if (props.height !== undefined) {
    node.height = props.height
  }
  if (props.maxHeight !== undefined) {
    node.max_height = props.maxHeight
  }
  if (props.maxWidth !== undefined) {
    node.max_width = props.maxWidth
  }
  if (props.minHeight !== undefined) {
    node.min_height = props.minHeight
  }
  if (props.minWidth !== undefined) {
    node.min_width = props.minWidth
  }
  if (props.width !== undefined) {
    node.width = props.width
  }

  // Overflow
  if (props.overflow) {
    node.overflow_x = props.overflow
    node.overflow_y = props.overflow
  }
  if (props.overflowX) {
    node.overflow_x = props.overflowX
  }
  if (props.overflowY) {
    node.overflow_y = props.overflowY
  }

  // Padding (handle both individual and shorthand)
  if (props.padding !== undefined) {
    node.padding = props.padding
  }
  if (props.paddingX !== undefined) {
    node.padding_x = props.paddingX
  }
  if (props.paddingY !== undefined) {
    node.padding_y = props.paddingY
  }
  if (props.paddingTop !== undefined) {
    node.padding_top = props.paddingTop
  }
  if (props.paddingRight !== undefined) {
    node.padding_right = props.paddingRight
  }
  if (props.paddingBottom !== undefined) {
    node.padding_bottom = props.paddingBottom
  }
  if (props.paddingLeft !== undefined) {
    node.padding_left = props.paddingLeft
  }

  // Margin (handle both individual and shorthand)
  if (props.margin !== undefined) {
    node.margin = props.margin
  }
  if (props.marginX !== undefined) {
    node.margin_x = props.marginX
  }
  if (props.marginY !== undefined) {
    node.margin_y = props.marginY
  }
  if (props.marginTop !== undefined) {
    node.margin_top = props.marginTop
  }
  if (props.marginRight !== undefined) {
    node.margin_right = props.marginRight
  }
  if (props.marginBottom !== undefined) {
    node.margin_bottom = props.marginBottom
  }
  if (props.marginLeft !== undefined) {
    node.margin_left = props.marginLeft
  }

  // Border
  if (props.borderColor) {
    node.border_color = props.borderColor
  }
  if (props.borderEdges) {
    node.border_edges = props.borderEdges
  }
  if (props.borderStyle) {
    node.border_style = props.borderStyle
  }
  if (props.customBorderChars) {
    node.custom_border_chars = {
      top_left: props.customBorderChars.topLeft,
      top_right: props.customBorderChars.topRight,
      bottom_left: props.customBorderChars.bottomLeft,
      bottom_right: props.customBorderChars.bottomRight,
      top: props.customBorderChars.top,
      bottom: props.customBorderChars.bottom,
      left: props.customBorderChars.left,
      right: props.customBorderChars.right,
    }
  }

  // Background
  if (props.backgroundColor) {
    node.background_color = props.backgroundColor
  }

  return node
}

/**
 * Create a fragment element that groups children without layout impact.
 *
 * Fragments are transparent wrappers that allow returning multiple elements
 * without affecting the layout hierarchy.
 *
 * @example
 *   ```typescript
 *   Fragment({
 *     children: [
 *       Text({ children: 'Line 1' }),
 *       Text({ children: 'Line 2' }),
 *       Text({ children: 'Line 3' }),
 *     ],
 *   })
 *   ```
 */
export function Fragment(props: FragmentProps): Element {
  const children = Array.isArray(props.children)
    ? props.children
    : [props.children]

  return {
    type: 'Fragment',
    children,
  }
}

/**
 * Create a mixed text element with multiple styled sections.
 *
 * @example
 *   ```typescript
 *   MixedText({
 *     contents: [
 *       { text: 'Success: ', color: 'green', weight: 'bold' },
 *       { text: 'Operation completed', color: 'white' },
 *     ],
 *     align: 'center',
 *   })
 *   ```
 */
export function MixedText(props: MixedTextProps): Element {
  const node: Element = {
    type: 'MixedText',
    mixed_text_contents: props.contents.map(section => ({
      text: section.text,
      color: section.color,
      weight: section.weight,
      decoration: section.decoration,
      italic: section.italic,
    })),
  }

  if (props.align) {
    node.align = props.align
  }
  if (props.wrap) {
    node.wrap = props.wrap
  }

  return node
}

/**
 * Text weight values for controlling font boldness.
 *
 * @example
 *   ```typescript
 *   Text({ children: 'Normal', weight: 'normal' })
 *   Text({ children: 'Bold', weight: 'bold' })
 *   Text({ children: 'Light', weight: 'light' })
 *   ```
 */
export type TextWeight = 'normal' | 'bold' | 'light'

/**
 * Text alignment options for horizontal positioning.
 *
 * @example
 *   ```typescript
 *   Text({ children: 'Left aligned', align: 'left' })
 *   Text({ children: 'Centered', align: 'center' })
 *   Text({ children: 'Right aligned', align: 'right' })
 *   ```
 */
export type TextAlign = 'left' | 'center' | 'right'

/**
 * Text wrapping behavior for long text content.
 *
 * @example
 *   ```typescript
 *   Text({ children: 'Wraps at width', wrap: 'wrap' })
 *   Text({ children: 'No wrapping', wrap: 'nowrap' })
 *   ```
 */
export type TextWrap = 'wrap' | 'nowrap'

/**
 * Text styling options for visual appearance.
 *
 * @example
 *   ```typescript
 *   // Named colors
 *   Text({ children: 'Red text', color: 'red' })
 *
 *   // Hex colors
 *   Text({ children: 'Custom', color: '#FF5733' })
 *
 *   // ANSI 256 colors
 *   Text({ children: 'Orange', color: 'ansi:208' })
 *   Text({ children: 'Pink', color: '213' }) // Bare number also works
 *   ```
 */
export interface TextStyle {
  /**
   * Apply bold styling to text.
   */
  bold?: boolean | undefined
  /**
   * Set text color (named colors like 'red', hex like '#FF0000', or ANSI 256
   * codes like 'ansi:123' or '196')
   */
  color?: string | undefined
  /**
   * Apply dim/faded styling to text (maps to light weight)
   */
  dimColor?: boolean | undefined
  /**
   * Apply italic styling to text.
   */
  italic?: boolean | undefined
  /**
   * Apply strikethrough decoration to text.
   */
  strikethrough?: boolean | undefined
  /**
   * Apply underline decoration to text.
   */
  underline?: boolean | undefined
  /**
   * Set text weight (overrides bold if specified)
   */
  weight?: TextWeight | undefined
}

/**
 * Display type for layout positioning.
 *
 * @example
 *   ```typescript
 *   Box({ display: 'flex' }) // Default, enables flexbox layout
 *   Box({ display: 'none' }) // Hides the element
 *   ```
 */
export type DisplayType = 'flex' | 'none'

/**
 * Position type for element positioning in layout.
 *
 * @example
 *   ```typescript
 *   Box({ position: 'relative' }) // Normal document flow
 *   Box({ position: 'absolute', top: 0, left: 0 }) // Absolute positioning
 *   ```
 */
export type PositionType = 'relative' | 'absolute'

/**
 * Overflow behavior for content that exceeds container bounds.
 *
 * @example
 *   ```typescript
 *   Box({ overflow: 'visible' }) // Content can overflow
 *   Box({ overflow: 'hidden' }) // Clip overflow content
 *   Box({ overflowX: 'hidden', overflowY: 'visible' }) // Per-axis control
 *   ```
 */
export type OverflowType = 'visible' | 'hidden'

/**
 * Border edges configuration for selective border rendering.
 *
 * @example
 *   ```typescript
 *   Box({ borderEdges: { top: true, bottom: true } }) // Top and bottom only
 *   Box({ borderEdges: { left: false, right: false } }) // Hide left/right
 *   ```
 */
export interface BorderEdges {
  /**
   * Show border on bottom edge.
   */
  bottom?: boolean | undefined
  /**
   * Show border on left edge.
   */
  left?: boolean | undefined
  /**
   * Show border on right edge.
   */
  right?: boolean | undefined
  /**
   * Show border on top edge.
   */
  top?: boolean | undefined
}

/**
 * Custom border characters for completely custom border rendering.
 *
 * @example
 *   ```typescript
 *   Box({
 *     customBorderChars: {
 *       topLeft: '╔',
 *       topRight: '╗',
 *       bottomLeft: '╚',
 *       bottomRight: '╝',
 *       top: '═',
 *       bottom: '═',
 *       left: '║',
 *       right: '║',
 *     },
 *   })
 *   ```
 */
export interface CustomBorderChars {
  /**
   * Bottom border character.
   */
  bottom: string
  /**
   * Bottom-left corner character.
   */
  bottomLeft: string
  /**
   * Bottom-right corner character.
   */
  bottomRight: string
  /**
   * Left border character.
   */
  left: string
  /**
   * Right border character.
   */
  right: string
  /**
   * Top border character.
   */
  top: string
  /**
   * Top-left corner character.
   */
  topLeft: string
  /**
   * Top-right corner character.
   */
  topRight: string
}

/**
 * Border style for Box/View components.
 *
 * @example
 *   ```typescript
 *   Box({ borderStyle: 'single' }) // ┌──┐
 *   Box({ borderStyle: 'double' }) // ╔══╗
 *   Box({ borderStyle: 'rounded' }) // ╭──╮
 *   Box({ borderStyle: 'bold' }) // ┏━━┓
 *   Box({ borderStyle: 'double-left-right' }) // ╓──╖
 *   Box({ borderStyle: 'double-top-bottom' }) // ╒══╕
 *   Box({ borderStyle: 'classic' }) // +--+
 *   ```
 */
export type BorderStyle =
  | 'none'
  | 'single'
  | 'double'
  | 'rounded'
  | 'bold'
  | 'double-left-right'
  | 'double-top-bottom'
  | 'classic'

/**
 * Mixed text content with individual styling per section.
 *
 * @example
 *   ```typescript
 *   ;({
 *     text: 'Error:',
 *     color: 'red',
 *     weight: 'bold',
 *     decoration: 'underline',
 *     italic: false
 *   })
 *   ```
 */
export interface MixedTextContentSection {
  /**
   * Text color (named colors, hex, or ANSI codes)
   */
  color?: string | undefined
  /**
   * Text decoration (underline, strikethrough, or none)
   */
  decoration?: 'underline' | 'strikethrough' | 'none' | undefined
  /**
   * Apply italic styling.
   */
  italic?: boolean | undefined
  /**
   * The text content for this section.
   */
  text: string
  /**
   * Text weight (normal, bold, or light)
   */
  weight?: TextWeight | undefined
}

/**
 * Box/View layout properties (flexbox).
 *
 * Supports comprehensive flexbox layout with positioning, dimensions, spacing,
 * and styling.
 *
 * @example
 *   ```typescript
 *   // Simple container
 *   Box({ padding: 2, children: [Text({ children: 'Hello' })] })
 *
 *   // Flex layout
 *   Box({
 *   flexDirection: 'row',
 *   gap: 1,
 *   justifyContent: 'space-between',
 *   alignItems: 'center',
 *   children: [...]
 *   })
 *
 *   // Absolute positioning
 *   Box({
 *   position: 'absolute',
 *   top: 0,
 *   right: 0,
 *   width: 20,
 *   height: 10
 *   })
 *   ```
 */
export interface BoxProps {
  /**
   * Align flex lines when there's extra space on the cross axis.
   */
  alignContent?:
    | 'flex-start'
    | 'flex-end'
    | 'center'
    | 'stretch'
    | 'space-between'
    | 'space-around'
    | undefined
  /**
   * Align items on the cross axis.
   */
  alignItems?: 'flex-start' | 'flex-end' | 'center' | 'stretch' | undefined
  /**
   * Background color (named colors or hex)
   */
  backgroundColor?: string | undefined
  /**
   * Border color (named colors, hex, or ANSI codes like 'ansi:123' or '196')
   */
  borderColor?: string | undefined
  /**
   * Configure which border edges to render.
   */
  borderEdges?: BorderEdges | undefined
  /**
   * Border style (supports all variants including double-left-right,
   * double-top-bottom, classic)
   */
  borderStyle?: BorderStyle | undefined
  /**
   * Bottom inset for absolute positioning (can be negative)
   */
  bottom?: number | undefined
  /**
   * Custom border characters (when using custom border style)
   */
  customBorderChars?: CustomBorderChars | undefined
  /**
   * Child elements to render inside this box.
   */
  children?: Element | Element[] | undefined
  /**
   * Gap between columns in flex layout.
   */
  columnGap?: number | undefined
  /**
   * Display type (flex or none)
   */
  display?: DisplayType | undefined
  /**
   * Initial size on the main axis (number, 'auto', or percentage string)
   */
  flexBasis?: number | string | undefined
  /**
   * Main axis direction (row or column)
   */
  flexDirection?: 'row' | 'column' | undefined
  /**
   * Flex grow factor (how much to grow relative to siblings)
   */
  flexGrow?: number | undefined
  /**
   * Flex shrink factor (how much to shrink relative to siblings)
   */
  flexShrink?: number | undefined
  /**
   * Flex wrap behavior (wrap or nowrap)
   */
  flexWrap?: 'wrap' | 'nowrap' | undefined
  /**
   * Gap between children (shorthand for rowGap and columnGap)
   */
  gap?: number | undefined
  /**
   * Height in characters.
   */
  height?: number | undefined
  /**
   * Inset for all sides (shorthand for top/right/bottom/left)
   */
  inset?: number | undefined
  /**
   * Align items on the main axis.
   */
  justifyContent?:
    | 'flex-start'
    | 'flex-end'
    | 'center'
    | 'space-between'
    | 'space-around'
    | undefined
  /**
   * Left inset for absolute positioning (can be negative)
   */
  left?: number | undefined
  /**
   * Margin on all sides.
   */
  margin?: number | undefined
  /**
   * Margin on bottom.
   */
  marginBottom?: number | undefined
  /**
   * Margin on left.
   */
  marginLeft?: number | undefined
  /**
   * Margin on right.
   */
  marginRight?: number | undefined
  /**
   * Margin on top.
   */
  marginTop?: number | undefined
  /**
   * Margin on left and right.
   */
  marginX?: number | undefined
  /**
   * Margin on top and bottom.
   */
  marginY?: number | undefined
  /**
   * Maximum height constraint.
   */
  maxHeight?: number | undefined
  /**
   * Maximum width constraint.
   */
  maxWidth?: number | undefined
  /**
   * Minimum height constraint.
   */
  minHeight?: number | undefined
  /**
   * Minimum width constraint.
   */
  minWidth?: number | undefined
  /**
   * Overflow behavior for both axes (shorthand)
   */
  overflow?: OverflowType | undefined
  /**
   * Overflow behavior on horizontal axis.
   */
  overflowX?: OverflowType | undefined
  /**
   * Overflow behavior on vertical axis.
   */
  overflowY?: OverflowType | undefined
  /**
   * Padding on all sides.
   */
  padding?: number | undefined
  /**
   * Padding on bottom.
   */
  paddingBottom?: number | undefined
  /**
   * Padding on left.
   */
  paddingLeft?: number | undefined
  /**
   * Padding on right.
   */
  paddingRight?: number | undefined
  /**
   * Padding on top.
   */
  paddingTop?: number | undefined
  /**
   * Padding on left and right.
   */
  paddingX?: number | undefined
  /**
   * Padding on top and bottom.
   */
  paddingY?: number | undefined
  /**
   * Position type (relative or absolute)
   */
  position?: PositionType | undefined
  /**
   * Right inset for absolute positioning (can be negative)
   */
  right?: number | undefined
  /**
   * Gap between rows in flex layout.
   */
  rowGap?: number | undefined
  /**
   * Top inset for absolute positioning (can be negative)
   */
  top?: number | undefined
  /**
   * Width in characters.
   */
  width?: number | undefined
}

/**
 * Text properties for rendering styled text content.
 *
 * @example
 *   ```typescript
 *   // Simple text
 *   Text({ children: 'Hello, world!' })
 *
 *   // Styled text
 *   Text({
 *     children: 'Important',
 *     color: 'red',
 *     weight: 'bold',
 *     align: 'center',
 *   })
 *
 *   // Decorated text
 *   Text({
 *     children: 'Completed',
 *     strikethrough: true,
 *     dimColor: true,
 *   })
 *   ```
 */
export interface TextProps extends TextStyle {
  /**
   * Horizontal text alignment (left, center, right)
   */
  align?: TextAlign | undefined
  /**
   * Text content to display (string or array of strings)
   */
  children?: string | string[] | undefined
  /**
   * Text wrapping behavior (wrap or nowrap)
   */
  wrap?: TextWrap | undefined
}

/**
 * Mixed text properties for rendering text with multiple styles.
 *
 * @example
 *   ```typescript
 *   MixedText({
 *     contents: [
 *       { text: 'Error: ', color: 'red', weight: 'bold' },
 *       { text: 'File not found', color: 'white', italic: true },
 *     ],
 *   })
 *   ```
 */
export interface MixedTextProps {
  /**
   * Horizontal text alignment.
   */
  align?: TextAlign | undefined
  /**
   * Array of text sections with individual styling.
   */
  contents: MixedTextContentSection[]
  /**
   * Text wrapping behavior.
   */
  wrap?: TextWrap | undefined
}

/**
 * Fragment properties for grouping elements without layout impact.
 *
 * @example
 *   ```typescript
 *   Fragment({
 *     children: [Text({ children: 'Line 1' }), Text({ children: 'Line 2' })],
 *   })
 *   ```
 */
export interface FragmentProps {
  /**
   * Child elements to group.
   */
  children: Element | Element[]
}

/**
 * Element type (iocraft element). We define our own interface instead of using
 * ComponentNode directly because we need to support all properties when
 * building elements.
 */
export interface Element {
  type: 'Text' | 'View' | 'MixedText' | 'Fragment'
  children?: Element[] | undefined

  // Text properties
  content?: string | undefined
  align?: string | undefined
  bold?: boolean | undefined
  color?: string | undefined
  dim_color?: boolean | undefined
  italic?: boolean | undefined
  strikethrough?: boolean | undefined
  underline?: boolean | undefined
  weight?: string | undefined
  wrap?: string | undefined

  // View properties
  display?: string | undefined
  position?: string | undefined
  bottom?: number | undefined
  inset?: number | undefined
  left?: number | undefined
  right?: number | undefined
  top?: number | undefined

  // Flex layout
  align_content?: string | undefined
  align_items?: string | undefined
  column_gap?: number | undefined
  flex_basis?: number | string | undefined
  flex_direction?: string | undefined
  flex_grow?: number | undefined
  flex_shrink?: number | undefined
  flex_wrap?: string | undefined
  gap?: number | undefined
  justify_content?: string | undefined
  row_gap?: number | undefined

  // Dimensions
  height?: number | undefined
  max_height?: number | undefined
  max_width?: number | undefined
  min_height?: number | undefined
  min_width?: number | undefined
  width?: number | undefined

  // Overflow
  overflow_x?: string | undefined
  overflow_y?: string | undefined

  // Padding
  padding?: number | undefined
  padding_x?: number | undefined
  padding_y?: number | undefined
  padding_top?: number | undefined
  padding_right?: number | undefined
  padding_bottom?: number | undefined
  padding_left?: number | undefined

  // Margin
  margin?: number | undefined
  margin_x?: number | undefined
  margin_y?: number | undefined
  margin_top?: number | undefined
  margin_right?: number | undefined
  margin_bottom?: number | undefined
  margin_left?: number | undefined

  // Border
  border_color?: string | undefined
  border_edges?:
    | {
        top?: boolean | undefined
        right?: boolean | undefined
        bottom?: boolean | undefined
        left?: boolean | undefined
      }
    | undefined
  border_style?: string | undefined
  custom_border_chars?:
    | {
        top_left: string
        top_right: string
        bottom_left: string
        bottom_right: string
        top: string
        bottom: string
        left: string
        right: string
      }
    | undefined

  // Background
  background_color?: string | undefined

  // MixedText
  mixed_text_contents?:
    | Array<{
        text: string
        color?: string | undefined
        weight?: string | undefined
        decoration?: string | undefined
        italic?: boolean | undefined
      }>
    | undefined
}

/**
 * Create a text element with styling.
 */
export function Text(props: TextProps): Element {
  const content =
    typeof props.children === 'string'
      ? props.children
      : Array.isArray(props.children)
        ? props.children.join('')
        : ''

  // Create text node as plain object to avoid NAPI deserialization bugs
  const node: Element = {
    type: 'Text',
    content,
  }

  // Apply styling properties
  if (props.align) {
    node.align = props.align
  }
  if (props.bold) {
    node.bold = true
  }
  if (props.color) {
    node.color = props.color
  }
  if (props.dimColor) {
    node.dim_color = true
  }
  if (props.italic) {
    node.italic = true
  }
  if (props.strikethrough) {
    node.strikethrough = true
  }
  if (props.underline) {
    node.underline = true
  }
  if (props.weight) {
    node.weight = props.weight
  }
  if (props.wrap) {
    node.wrap = props.wrap
  }

  return node
}

/**
 * Print an element to stderr.
 */
export function eprint(element: Element): void {
  const io = getIocraft()
  io.eprintComponent(element as IocraftNs.ComponentNode)
}

export function getIocraft(): typeof iocraft {
  if (!iocraftInstance) {
    try {
      // Use createRequire to load native .node module from ESM.
      const require = createRequire(import.meta.url)
      const loaded = require('@socketaddon/iocraft')
      // Handle ESM default export when loaded via require().
      iocraftInstance = loaded.default || loaded
    } catch (e) {
      throw new Error(
        `could not load @socketaddon/iocraft native module (${getErrorCause(e)}); reinstall socket-cli to pull the prebuilt for your platform, or check that your platform (${process.platform}-${process.arch}) has a published prebuilt`,
      )
    }
  }
  return iocraftInstance!
}

/**
 * Get terminal size.
 */
export function getTerminalSize(): { columns: number; rows: number } {
  const io = getIocraft()
  const size = io.getTerminalSize()
  return { columns: size[0], rows: size[1] }
}

/**
 * Print an element to stdout.
 */
export function print(element: Element): void {
  const io = getIocraft()
  io.printComponent(element as IocraftNs.ComponentNode)
}

/**
 * Render an element to a string.
 */
export function renderToString(element: Element): string {
  const io = getIocraft()
  return io.renderToString(element as IocraftNs.ComponentNode)
}
