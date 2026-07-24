/**
 * TypeScript definitions for @socketaddon/iocraft.
 *
 * Node.js bindings for iocraft TUI library.
 */

/**
 * Component node in the render tree.
 */
export interface ComponentNode {
  children?: ComponentNode[] | undefined
  type: 'View' | 'Text'
  content?: string | undefined

  // Border properties
  border_style?: string | undefined
  border_color?: string | undefined

  // Background
  background_color?: string | undefined

  // Text properties
  color?: string | undefined
  weight?: string | undefined
  align?: string | undefined
  wrap?: string | undefined
  underline?: boolean | undefined
  italic?: boolean | undefined
  bold?: boolean | undefined
  dim_color?: boolean | undefined
  strikethrough?: boolean | undefined

  // Layout properties
  flex_direction?: string | undefined
  justify_content?: string | undefined
  align_items?: string | undefined
  flex_grow?: number | undefined
  flex_shrink?: number | undefined
  flex_basis?: number | string | undefined
  flex_wrap?: string | undefined
  overflow_x?: string | undefined
  overflow_y?: string | undefined

  // Dimensions
  width?: number | undefined
  height?: number | undefined
  width_percent?: number | undefined
  height_percent?: number | undefined

  // Padding
  padding?: number | undefined
  padding_top?: number | undefined
  padding_right?: number | undefined
  padding_bottom?: number | undefined
  padding_left?: number | undefined
  padding_x?: number | undefined
  padding_y?: number | undefined

  // Margin
  margin?: number | undefined
  margin_top?: number | undefined
  margin_right?: number | undefined
  margin_bottom?: number | undefined
  margin_left?: number | undefined
  margin_x?: number | undefined
  margin_y?: number | undefined

  // Gap
  gap?: number | undefined
  row_gap?: number | undefined
  column_gap?: number | undefined
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
export function renderToStringWithWidth(
  tree: ComponentNode,
  maxWidth: number,
): string

/**
 * Render a component tree and print to stdout.
 */
export function printComponent(tree: ComponentNode): void

/**
 * Render a component tree and print to stderr.
 */
export function eprintComponent(tree: ComponentNode): void

/**
 * Get the current terminal size. Returns [width, height] in characters.
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
