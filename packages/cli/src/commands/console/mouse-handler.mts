/**
 * @fileoverview Mouse event handling for raw mode terminal input.
 *
 * Parses ANSI mouse tracking escape sequences and provides click detection.
 * Supports SGR (Select Graphic Rendition) mouse mode encoding.
 */

export interface MouseEvent {
  button: number
  x: number
  y: number
  type: 'down' | 'up' | 'move'
  shift: boolean
  alt: boolean
  ctrl: boolean
}

/**
 * Parse SGR mouse mode escape sequence.
 * Format: \x1b[<button;x;y;type>M or \x1b[<button;x;y;type>m
 * With modifiers (SGR extended): shift adds 4, alt adds 8, ctrl adds 16.
 * Example: \x1b[<0;10;5;M for left click at column 10, row 5.
 * Example: \x1b[<4;10;5;M for shift+left click (button 0+4 for shift).
 */
export function parseMouseEvent(sequence: string): MouseEvent | null {
  // Match SGR format: \x1b[<button;x;y;type>M/m.
  const match = sequence.match(/\x1b\[<(\d+);(\d+);(\d+);?[Mm]/)
  if (!match) {
    return null
  }

  const button = Number.parseInt(match[1]!, 10)
  const x = Number.parseInt(match[2]!, 10)
  const y = Number.parseInt(match[3]!, 10)

  // Extract modifiers from button code (SGR extended format).
  // Shift = 4, Alt = 8, Ctrl = 16.
  const shift = (button & 4) !== 0
  const alt = (button & 8) !== 0
  const ctrl = (button & 16) !== 0

  // Determine event type based on button code.
  // Button 64+ indicates movement, 96+ indicates release.
  let type: 'down' | 'up' | 'move' = 'down'
  if (button >= 96) {
    type = 'up'
  } else if (button >= 64) {
    type = 'move'
  }

  return {
    alt,
    button: button % 64,
    ctrl,
    shift,
    type,
    x,
    y,
  }
}

/**
 * Check if a click occurred within a given box region.
 */
export function isClickInRegion(
  mouseEvent: MouseEvent,
  x: number,
  y: number,
  width: number,
  height: number,
): boolean {
  return (
    mouseEvent.type === 'down' &&
    mouseEvent.x >= x &&
    mouseEvent.x < x + width &&
    mouseEvent.y >= y &&
    mouseEvent.y < y + height
  )
}
