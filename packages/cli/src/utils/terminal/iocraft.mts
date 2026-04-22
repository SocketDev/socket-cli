/**
 * @fileoverview iocraft abstraction layer for terminal UI.
 *
 * Provides a React-like API for building terminal interfaces using iocraft native bindings.
 * This layer is designed to be a drop-in replacement for the Ink-based UI.
 */

import { createRequire } from 'node:module'

import type iocraft from '@socketaddon/iocraft'

// Re-export iocraft types for direct access when needed.
export type { default as IocraftNative } from '@socketaddon/iocraft'

/**
 * Lazy-load iocraft to avoid import errors if the native module isn't available.
 */
let iocraftInstance: typeof iocraft | undefined

function getIocraft(): typeof iocraft {
  if (!iocraftInstance) {
    try {
      // Use createRequire to load native .node module from ESM.
      const require = createRequire(import.meta.url)
      const loaded = require('@socketaddon/iocraft')
      // Handle ESM default export when loaded via require().
      iocraftInstance = loaded.default || loaded
    } catch (e) {
      throw new Error(
        `could not load @socketaddon/iocraft native module (${e instanceof Error ? e.message : String(e)}); reinstall socket-cli to pull the prebuilt for your platform, or check that your platform (${process.platform}-${process.arch}) has a published prebuilt`,
      )
    }
  }
  return iocraftInstance!
}

/**
 * Text weight values for controlling font boldness.
 *
 * @example
 * ```typescript
 * Text({ children: 'Normal', weight: 'normal' })
 * Text({ children: 'Bold', weight: 'bold' })
 * Text({ children: 'Light', weight: 'light' })
 * ```
 */
export type TextWeight = 'normal' | 'bold' | 'light'

/**
 * Text alignment options for horizontal positioning.
 *
 * @example
 * ```typescript
 * Text({ children: 'Left aligned', align: 'left' })
 * Text({ children: 'Centered', align: 'center' })
 * Text({ children: 'Right aligned', align: 'right' })
 * ```
 */
export type TextAlign = 'left' | 'center' | 'right'

/**
 * Text wrapping behavior for long text content.
 *
 * @example
 * ```typescript
 * Text({ children: 'Wraps at width', wrap: 'wrap' })
 * Text({ children: 'No wrapping', wrap: 'nowrap' })
 * ```
 */
export type TextWrap = 'wrap' | 'nowrap'

/**
 * Text styling options for visual appearance.
 *
 * @example
 * ```typescript
 * // Named colors
 * Text({ children: 'Red text', color: 'red' })
 *
 * // Hex colors
 * Text({ children: 'Custom', color: '#FF5733' })
 *
 * // ANSI 256 colors
 * Text({ children: 'Orange', color: 'ansi:208' })
 * Text({ children: 'Pink', color: '213' }) // Bare number also works
 * ```
 */
export interface TextStyle {
  /** Apply bold styling to text */
  bold?: boolean
  /** Set text color (named colors like 'red', hex like '#FF0000', or ANSI 256 codes like 'ansi:123' or '196') */
  color?: string
  /** Apply dim/faded styling to text (maps to light weight) */
  dimColor?: boolean
  /** Apply italic styling to text */
  italic?: boolean
  /** Apply strikethrough decoration to text */
  strikethrough?: boolean
  /** Apply underline decoration to text */
  underline?: boolean
  /** Set text weight (overrides bold if specified) */
  weight?: TextWeight
}

/**
 * Display type for layout positioning.
 *
 * @example
 * ```typescript
 * Box({ display: 'flex' }) // Default, enables flexbox layout
 * Box({ display: 'none' }) // Hides the element
 * ```
 */
export type DisplayType = 'flex' | 'none'

/**
 * Position type for element positioning in layout.
 *
 * @example
 * ```typescript
 * Box({ position: 'relative' }) // Normal document flow
 * Box({ position: 'absolute', top: 0, left: 0 }) // Absolute positioning
 * ```
 */
export type PositionType = 'relative' | 'absolute'

/**
 * Overflow behavior for content that exceeds container bounds.
 *
 * @example
 * ```typescript
 * Box({ overflow: 'visible' }) // Content can overflow
 * Box({ overflow: 'hidden' }) // Clip overflow content
 * Box({ overflowX: 'hidden', overflowY: 'visible' }) // Per-axis control
 * ```
 */
export type OverflowType = 'visible' | 'hidden'

/**
 * Border edges configuration for selective border rendering.
 *
 * @example
 * ```typescript
 * Box({ borderEdges: { top: true, bottom: true } }) // Top and bottom only
 * Box({ borderEdges: { left: false, right: false } }) // Hide left/right
 * ```
 */
export interface BorderEdges {
  /** Show border on bottom edge */
  bottom?: boolean
  /** Show border on left edge */
  left?: boolean
  /** Show border on right edge */
  right?: boolean
  /** Show border on top edge */
  top?: boolean
}

/**
 * Custom border characters for completely custom border rendering.
 *
 * @example
 * ```typescript
 * Box({
 *   customBorderChars: {
 *     topLeft: '╔',
 *     topRight: '╗',
 *     bottomLeft: '╚',
 *     bottomRight: '╝',
 *     top: '═',
 *     bottom: '═',
 *     left: '║',
 *     right: '║'
 *   }
 * })
 * ```
 */
export interface CustomBorderChars {
  /** Bottom border character */
  bottom: string
  /** Bottom-left corner character */
  bottomLeft: string
  /** Bottom-right corner character */
  bottomRight: string
  /** Left border character */
  left: string
  /** Right border character */
  right: string
  /** Top border character */
  top: string
  /** Top-left corner character */
  topLeft: string
  /** Top-right corner character */
  topRight: string
}

/**
 * Border style for Box/View components.
 *
 * @example
 * ```typescript
 * Box({ borderStyle: 'single' }) // ┌──┐
 * Box({ borderStyle: 'double' }) // ╔══╗
 * Box({ borderStyle: 'rounded' }) // ╭──╮
 * Box({ borderStyle: 'bold' }) // ┏━━┓
 * Box({ borderStyle: 'double-left-right' }) // ╓──╖
 * Box({ borderStyle: 'double-top-bottom' }) // ╒══╕
 * Box({ borderStyle: 'classic' }) // +--+
 * ```
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
 * ```typescript
 * {
 *   text: 'Error:',
 *   color: 'red',
 *   weight: 'bold',
 *   decoration: 'underline',
 *   italic: false
 * }
 * ```
 */
export interface MixedTextContentSection {
  /** Text color (named colors, hex, or ANSI codes) */
  color?: string
  /** Text decoration (underline, strikethrough, or none) */
  decoration?: 'underline' | 'strikethrough' | 'none'
  /** Apply italic styling */
  italic?: boolean
  /** The text content for this section */
  text: string
  /** Text weight (normal, bold, or light) */
  weight?: TextWeight
}

/**
 * Box/View layout properties (flexbox).
 *
 * Supports comprehensive flexbox layout with positioning, dimensions, spacing, and styling.
 *
 * @example
 * ```typescript
 * // Simple container
 * Box({ padding: 2, children: [Text({ children: 'Hello' })] })
 *
 * // Flex layout
 * Box({
 *   flexDirection: 'row',
 *   gap: 1,
 *   justifyContent: 'space-between',
 *   alignItems: 'center',
 *   children: [...]
 * })
 *
 * // Absolute positioning
 * Box({
 *   position: 'absolute',
 *   top: 0,
 *   right: 0,
 *   width: 20,
 *   height: 10
 * })
 * ```
 */
export interface BoxProps {
  /** Align flex lines when there's extra space on the cross axis */
  alignContent?:
    | 'flex-start'
    | 'flex-end'
    | 'center'
    | 'stretch'
    | 'space-between'
    | 'space-around'
  /** Align items on the cross axis */
  alignItems?: 'flex-start' | 'flex-end' | 'center' | 'stretch'
  /** Background color (named colors or hex) */
  backgroundColor?: string
  /** Border color (named colors, hex, or ANSI codes like 'ansi:123' or '196') */
  borderColor?: string
  /** Configure which border edges to render */
  borderEdges?: BorderEdges
  /** Border style (supports all variants including double-left-right, double-top-bottom, classic) */
  borderStyle?: BorderStyle
  /** Bottom inset for absolute positioning (can be negative) */
  bottom?: number
  /** Custom border characters (when using custom border style) */
  customBorderChars?: CustomBorderChars
  /** Child elements to render inside this box */
  children?: Element | Element[]
  /** Gap between columns in flex layout */
  columnGap?: number
  /** Display type (flex or none) */
  display?: DisplayType
  /** Initial size on the main axis (number, 'auto', or percentage string) */
  flexBasis?: number | string
  /** Main axis direction (row or column) */
  flexDirection?: 'row' | 'column'
  /** Flex grow factor (how much to grow relative to siblings) */
  flexGrow?: number
  /** Flex shrink factor (how much to shrink relative to siblings) */
  flexShrink?: number
  /** Flex wrap behavior (wrap or nowrap) */
  flexWrap?: 'wrap' | 'nowrap'
  /** Gap between children (shorthand for rowGap and columnGap) */
  gap?: number
  /** Height in characters */
  height?: number
  /** Inset for all sides (shorthand for top/right/bottom/left) */
  inset?: number
  /** Align items on the main axis */
  justifyContent?:
    | 'flex-start'
    | 'flex-end'
    | 'center'
    | 'space-between'
    | 'space-around'
  /** Left inset for absolute positioning (can be negative) */
  left?: number
  /** Margin on all sides */
  margin?: number
  /** Margin on bottom */
  marginBottom?: number
  /** Margin on left */
  marginLeft?: number
  /** Margin on right */
  marginRight?: number
  /** Margin on top */
  marginTop?: number
  /** Margin on left and right */
  marginX?: number
  /** Margin on top and bottom */
  marginY?: number
  /** Maximum height constraint */
  maxHeight?: number
  /** Maximum width constraint */
  maxWidth?: number
  /** Minimum height constraint */
  minHeight?: number
  /** Minimum width constraint */
  minWidth?: number
  /** Overflow behavior for both axes (shorthand) */
  overflow?: OverflowType
  /** Overflow behavior on horizontal axis */
  overflowX?: OverflowType
  /** Overflow behavior on vertical axis */
  overflowY?: OverflowType
  /** Padding on all sides */
  padding?: number
  /** Padding on bottom */
  paddingBottom?: number
  /** Padding on left */
  paddingLeft?: number
  /** Padding on right */
  paddingRight?: number
  /** Padding on top */
  paddingTop?: number
  /** Padding on left and right */
  paddingX?: number
  /** Padding on top and bottom */
  paddingY?: number
  /** Position type (relative or absolute) */
  position?: PositionType
  /** Right inset for absolute positioning (can be negative) */
  right?: number
  /** Gap between rows in flex layout */
  rowGap?: number
  /** Top inset for absolute positioning (can be negative) */
  top?: number
  /** Width in characters */
  width?: number
}

/**
 * Text properties for rendering styled text content.
 *
 * @example
 * ```typescript
 * // Simple text
 * Text({ children: 'Hello, world!' })
 *
 * // Styled text
 * Text({
 *   children: 'Important',
 *   color: 'red',
 *   weight: 'bold',
 *   align: 'center'
 * })
 *
 * // Decorated text
 * Text({
 *   children: 'Completed',
 *   strikethrough: true,
 *   dimColor: true
 * })
 * ```
 */
export interface TextProps extends TextStyle {
  /** Horizontal text alignment (left, center, right) */
  align?: TextAlign
  /** Text content to display (string or array of strings) */
  children?: string | string[]
  /** Text wrapping behavior (wrap or nowrap) */
  wrap?: TextWrap
}

/**
 * Mixed text properties for rendering text with multiple styles.
 *
 * @example
 * ```typescript
 * MixedText({
 *   contents: [
 *     { text: 'Error: ', color: 'red', weight: 'bold' },
 *     { text: 'File not found', color: 'white', italic: true }
 *   ]
 * })
 * ```
 */
export interface MixedTextProps {
  /** Horizontal text alignment */
  align?: TextAlign
  /** Array of text sections with individual styling */
  contents: MixedTextContentSection[]
  /** Text wrapping behavior */
  wrap?: TextWrap
}

/**
 * Fragment properties for grouping elements without layout impact.
 *
 * @example
 * ```typescript
 * Fragment({
 *   children: [
 *     Text({ children: 'Line 1' }),
 *     Text({ children: 'Line 2' })
 *   ]
 * })
 * ```
 */
export interface FragmentProps {
  /** Child elements to group */
  children: Element | Element[]
}

/**
 * Element type (iocraft element).
 * We define our own interface instead of using ComponentNode directly
 * because we need to support all properties when building elements.
 */
export interface Element {
  type: 'Text' | 'View' | 'MixedText' | 'Fragment'
  children?: Element[]

  // Text properties
  content?: string
  align?: string
  bold?: boolean
  color?: string
  dim_color?: boolean
  italic?: boolean
  strikethrough?: boolean
  underline?: boolean
  weight?: string
  wrap?: string

  // View properties
  display?: string
  position?: string
  bottom?: number
  inset?: number
  left?: number
  right?: number
  top?: number

  // Flex layout
  align_content?: string
  align_items?: string
  column_gap?: number
  flex_basis?: number | string
  flex_direction?: string
  flex_grow?: number
  flex_shrink?: number
  flex_wrap?: string
  gap?: number
  justify_content?: string
  row_gap?: number

  // Dimensions
  height?: number
  max_height?: number
  max_width?: number
  min_height?: number
  min_width?: number
  width?: number

  // Overflow
  overflow_x?: string
  overflow_y?: string

  // Padding
  padding?: number
  padding_x?: number
  padding_y?: number
  padding_top?: number
  padding_right?: number
  padding_bottom?: number
  padding_left?: number

  // Margin
  margin?: number
  margin_x?: number
  margin_y?: number
  margin_top?: number
  margin_right?: number
  margin_bottom?: number
  margin_left?: number

  // Border
  border_color?: string
  border_edges?: {
    top?: boolean
    right?: boolean
    bottom?: boolean
    left?: boolean
  }
  border_style?: string
  custom_border_chars?: {
    top_left: string
    top_right: string
    bottom_left: string
    bottom_right: string
    top: string
    bottom: string
    left: string
    right: string
  }

  // Background
  background_color?: string

  // MixedText
  mixed_text_contents?: Array<{
    text: string
    color?: string | undefined
    weight?: string | undefined
    decoration?: string | undefined
    italic?: boolean | undefined
  }>
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
 * Create a mixed text element with multiple styled sections.
 *
 * @example
 * ```typescript
 * MixedText({
 *   contents: [
 *     { text: 'Success: ', color: 'green', weight: 'bold' },
 *     { text: 'Operation completed', color: 'white' }
 *   ],
 *   align: 'center'
 * })
 * ```
 */
export function MixedText(props: MixedTextProps): Element {
  const node: Element = {
    type: 'MixedText',
    mixed_text_contents: props.contents.map((section) => ({
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
 * Create a fragment element that groups children without layout impact.
 *
 * Fragments are transparent wrappers that allow returning multiple elements
 * without affecting the layout hierarchy.
 *
 * @example
 * ```typescript
 * Fragment({
 *   children: [
 *     Text({ children: 'Line 1' }),
 *     Text({ children: 'Line 2' }),
 *     Text({ children: 'Line 3' })
 *   ]
 * })
 * ```
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
 * Render an element to a string.
 */
export function renderToString(element: Element): string {
  const io = getIocraft()
  return io.renderToString(element as import('@socketaddon/iocraft').ComponentNode)
}

/**
 * Print an element to stdout.
 */
export function print(element: Element): void {
  const io = getIocraft()
  io.printComponent(element as import('@socketaddon/iocraft').ComponentNode)
}

/**
 * Print an element to stderr.
 */
export function eprint(element: Element): void {
  const io = getIocraft()
  io.eprintComponent(element as import('@socketaddon/iocraft').ComponentNode)
}

/**
 * Get terminal size.
 */
export function getTerminalSize(): { columns: number; rows: number } {
  const io = getIocraft()
  const size = io.getTerminalSize()
  return { columns: size[0], rows: size[1] }
}
