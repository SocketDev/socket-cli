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
        `Failed to load iocraft native module: ${e}\n` +
          `Make sure @socketaddon/iocraft is installed and your platform is supported.`,
      )
    }
  }
  return iocraftInstance!
}

/**
 * Text styling options.
 */
export interface TextStyle {
  bold?: boolean
  color?: string
  dimColor?: boolean
  italic?: boolean
  strikethrough?: boolean
  underline?: boolean
}

/**
 * Box/View layout properties (flexbox).
 */
export interface BoxProps {
  alignItems?: 'flex-start' | 'flex-end' | 'center' | 'stretch'
  backgroundColor?: string
  borderColor?: string
  borderStyle?: 'single' | 'double' | 'rounded' | 'bold' | 'none'
  children?: Element | Element[]
  flexBasis?: number | string
  flexDirection?: 'row' | 'column'
  flexGrow?: number
  flexShrink?: number
  flexWrap?: 'wrap' | 'nowrap'
  gap?: number
  height?: number
  justifyContent?:
    | 'flex-start'
    | 'flex-end'
    | 'center'
    | 'space-between'
    | 'space-around'
  marginBottom?: number
  marginLeft?: number
  marginRight?: number
  marginTop?: number
  marginX?: number
  marginY?: number
  overflowX?: 'visible' | 'hidden'
  overflowY?: 'visible' | 'hidden'
  paddingBottom?: number
  paddingLeft?: number
  paddingRight?: number
  paddingTop?: number
  paddingX?: number
  paddingY?: number
  width?: number
}

/**
 * Text properties.
 */
export interface TextProps extends TextStyle {
  children?: string | string[]
}

/**
 * Element type (iocraft element).
 */
export type Element = import('@socketaddon/iocraft').ComponentNode

/**
 * Create a text element with styling.
 */
export function Text(props: TextProps): Element {
  const io = getIocraft()
  const content =
    typeof props.children === 'string'
      ? props.children
      : Array.isArray(props.children)
        ? props.children.join('')
        : ''

  // Create basic text node.
  const node = io.text(content)

  // Apply styling properties.
  if (props.bold) {
    node.bold = true
  }
  if (props.color) {
    node.color = props.color
  }
  if (props.underline) {
    node.underline = true
  }
  if (props.italic) {
    node.italic = true
  }

  return node
}

/**
 * Create a box/view element with layout properties.
 */
export function Box(props: BoxProps): Element {
  const io = getIocraft()
  const children = Array.isArray(props.children)
    ? props.children
    : props.children
      ? [props.children]
      : []

  // Create basic view node.
  const node = io.view(children)

  // Apply layout properties.
  if (props.flexDirection) {
    node.flex_direction = props.flexDirection
  }
  if (props.flexGrow !== undefined) {
    node.flex_grow = props.flexGrow
  }
  if (props.flexShrink !== undefined) {
    node.flex_shrink = props.flexShrink
  }
  if (props.justifyContent) {
    node.justify_content = props.justifyContent
  }
  if (props.alignItems) {
    node.align_items = props.alignItems
  }
  if (props.gap !== undefined) {
    node.gap = props.gap
  }

  // Dimensions.
  if (props.width !== undefined) {
    node.width = props.width
  }
  if (props.height !== undefined) {
    node.height = props.height
  }

  // Padding (handle both individual and shorthand).
  if (props.paddingX !== undefined) {
    node.padding_left = props.paddingX
    node.padding_right = props.paddingX
  }
  if (props.paddingY !== undefined) {
    node.padding_top = props.paddingY
    node.padding_bottom = props.paddingY
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

  // Margin (handle both individual and shorthand).
  if (props.marginX !== undefined) {
    node.margin_left = props.marginX
    node.margin_right = props.marginX
  }
  if (props.marginY !== undefined) {
    node.margin_top = props.marginY
    node.margin_bottom = props.marginY
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

  // Border.
  if (props.borderStyle) {
    node.border_style = props.borderStyle
  }
  if (props.borderColor) {
    node.border_color = props.borderColor
  }

  // Background.
  if (props.backgroundColor) {
    node.background_color = props.backgroundColor
  }

  return node
}

/**
 * Render an element to a string.
 */
export function renderToString(element: Element): string {
  const io = getIocraft()
  return io.renderToString(element)
}

/**
 * Print an element to stdout.
 */
export function print(element: Element): void {
  const io = getIocraft()
  io.printComponent(element)
}

/**
 * Print an element to stderr.
 */
export function eprint(element: Element): void {
  const io = getIocraft()
  io.eprintComponent(element)
}

/**
 * Get terminal size.
 */
export function getTerminalSize(): { columns: number; rows: number } {
  const io = getIocraft()
  const size = io.getTerminalSize()
  return { columns: size[0], rows: size[1] }
}
