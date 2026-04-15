/**
 * OpenTUI render engine — iocraft-compatible API.
 */

export interface ComponentNode {
  type: 'Text' | 'View' | 'MixedText' | 'Fragment'
  children?: ComponentNode[]
  content?: string
  [key: string]: unknown
}

export interface OpenTuiEngine {
  renderToString(element: ComponentNode): string
  renderToStringWithWidth(element: ComponentNode, maxWidth: number): string
  printComponent(element: ComponentNode): void
  eprintComponent(element: ComponentNode): void
  getTerminalSize(): [number, number]
}

declare const engine: OpenTuiEngine
export default engine
