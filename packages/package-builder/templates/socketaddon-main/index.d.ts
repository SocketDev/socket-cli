/**
 * TypeScript definitions for @socketaddon/iocraft
 *
 * Node.js bindings for iocraft TUI library.
 */

/**
 * Component node in the render tree.
 */
export interface ComponentNode {
  children?: ComponentNode[]
  type: 'View' | 'Text'
  content?: string

  // Border properties
  border_style?: string
  border_color?: string

  // Background
  background_color?: string

  // Text properties
  color?: string
  weight?: string
  align?: string
  wrap?: string
  underline?: boolean
  italic?: boolean
  bold?: boolean
  dim_color?: boolean
  strikethrough?: boolean

  // Layout properties
  flex_direction?: string
  justify_content?: string
  align_items?: string
  flex_grow?: number
  flex_shrink?: number
  flex_basis?: number | string
  flex_wrap?: string
  overflow_x?: string
  overflow_y?: string

  // Dimensions
  width?: number
  height?: number
  width_percent?: number
  height_percent?: number

  // Padding
  padding?: number
  padding_top?: number
  padding_right?: number
  padding_bottom?: number
  padding_left?: number
  padding_x?: number
  padding_y?: number

  // Margin
  margin?: number
  margin_top?: number
  margin_right?: number
  margin_bottom?: number
  margin_left?: number
  margin_x?: number
  margin_y?: number

  // Gap
  gap?: number
  row_gap?: number
  column_gap?: number
}

/**
 * Create a simple text component node.
 */
export function text(content: string): ComponentNode

/**
 * Create a View/Box component node with children.
 */
export function view(children: ComponentNode[]): ComponentNode

/**
 * Render a component tree to a string (no terminal interaction).
 */
export function renderToString(tree: ComponentNode): string

/**
 * Render a component tree to a string with a maximum width.
 */
export function renderToStringWithWidth(tree: ComponentNode, maxWidth: number): string

/**
 * Render a component tree and print to stdout.
 */
export function printComponent(tree: ComponentNode): void

/**
 * Render a component tree and print to stderr.
 */
export function eprintComponent(tree: ComponentNode): void

/**
 * Get the current terminal size.
 * Returns [width, height] in characters.
 */
export function getTerminalSize(): [number, number]

/**
 * Interactive TUI renderer with state management.
 */
export class TuiRenderer {
  constructor()
  setTree(tree: ComponentNode): Promise<void>
  isRunning(): boolean
  getSize(): [number, number]
  renderOnce(): Promise<string>
  renderWithWidth(maxWidth: number): Promise<string>
  print(): Promise<void>
  eprint(): Promise<void>
}

/**
 * Initialize the iocraft module.
 */
export function init(): void

declare const iocraft: {
  text: typeof text
  view: typeof view
  renderToString: typeof renderToString
  renderToStringWithWidth: typeof renderToStringWithWidth
  printComponent: typeof printComponent
  eprintComponent: typeof eprintComponent
  getTerminalSize: typeof getTerminalSize
  TuiRenderer: typeof TuiRenderer
  init: typeof init
}

export default iocraft
