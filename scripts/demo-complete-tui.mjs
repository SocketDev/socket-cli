/**
 * Complete TUI layout with header, console window, and input block.
 */

import { renderShimmerFrame } from '../src/utils/terminal/ascii-header.mts'

/**
 * UI State.
 */
const state = {
  // Console window (top-right).
  consoleWidth: 40,
  consoleHeight: 30,
  consoleLines: [
    'Socket CLI Output',
    '',
    '✓ Package scanned',
    '✓ No issues found',
  ],
  // Input block (bottom).
  inputText: '> ',
  cursorPosition: 2,
  // Animation.
  frame: 0,
  theme: 'default',
}

/**
 * Get terminal dimensions.
 */
function getTerminalSize() {
  const cols = Math.max(80, Math.min(500, process.stdout.columns || 120))
  const rows = Math.max(24, Math.min(200, process.stdout.rows || 30))
  return { cols, rows }
}

/**
 * Get console window rectangle.
 */
function getConsoleRect() {
  const { cols, rows } = getTerminalSize()
  const width = Math.floor((cols * state.consoleWidth) / 100)
  const height = Math.floor((rows * state.consoleHeight) / 100)
  const x = cols - width - 1
  const y = 1
  return { x, y, width, height }
}

/**
 * Get visible length (without ANSI codes).
 */
function visibleLength(str) {
  return str.replace(/\x1B\[[0-9;]*m/g, '').length
}

/**
 * Replace substring at position in a string, accounting for visible length.
 */
function replaceAt(str, index, replacement) {
  if (index < 0) {
    return str
  }
  const replacementVisibleLen = visibleLength(replacement)

  // Find the actual character position accounting for ANSI codes.
  let visiblePos = 0
  let actualPos = 0
  while (visiblePos < index && actualPos < str.length) {
    if (str[actualPos] === '\x1B') {
      // Skip ANSI code.
      while (actualPos < str.length && str[actualPos] !== 'm') {
        actualPos++
      }
      actualPos++
    } else {
      visiblePos++
      actualPos++
    }
  }

  // Find end position for visible length.
  let endVisiblePos = visiblePos
  let endActualPos = actualPos
  while (
    endVisiblePos < index + replacementVisibleLen &&
    endActualPos < str.length
  ) {
    if (str[endActualPos] === '\x1B') {
      // Skip ANSI code.
      while (endActualPos < str.length && str[endActualPos] !== 'm') {
        endActualPos++
      }
      endActualPos++
    } else {
      endVisiblePos++
      endActualPos++
    }
  }

  return str.slice(0, actualPos) + replacement + str.slice(endActualPos)
}

/**
 * Draw the complete TUI layout.
 */
function drawCompleteTUI() {
  const { cols, rows } = getTerminalSize()
  const rect = getConsoleRect()

  // Create screen buffer.
  const buffer = Array(rows)
    .fill(null)
    .map(() => ' '.repeat(cols))

  // Draw outer screen border (double).
  const outerTopBorder = `╔${'═'.repeat(cols - 2)}╗`
  const outerBottomBorder = `╚${'═'.repeat(cols - 2)}╝`
  buffer[0] = outerTopBorder
  buffer[rows - 1] = outerBottomBorder

  // Draw outer side borders.
  for (let i = 1; i < rows - 1; i++) {
    buffer[i] = `║${buffer[i].slice(1, cols - 1)}║`
  }

  // Draw header frame (centered, below top border).
  const headerStartRow = 2
  const logo = renderShimmerFrame(state.frame, state.theme)
  const logoLines = logo.split('\n')

  // Calculate header dimensions based on actual logo width.
  const maxLogoWidth = Math.max(...logoLines.map(line => visibleLength(line)))
  const headerWidth = maxLogoWidth + 4
  const headerX = Math.floor((cols - headerWidth) / 2)
  const headerY = headerStartRow

  // Header top border.
  const headerTopBorder = `╭${'─'.repeat(headerWidth - 2)}╮`
  buffer[headerY] = replaceAt(buffer[headerY], headerX, headerTopBorder)

  // Header content.
  for (let i = 0; i < logoLines.length; i++) {
    const lineY = headerY + 1 + i
    if (lineY >= rows - 1) {
      break
    }

    const line = logoLines[i]
    const lineVisibleLen = visibleLength(line)
    const leftPad = Math.floor((headerWidth - 2 - lineVisibleLen) / 2)
    const rightPad = headerWidth - 2 - lineVisibleLen - leftPad

    const framedLine =
      '│' + ' '.repeat(leftPad) + line + ' '.repeat(Math.max(0, rightPad)) + '│'

    buffer[lineY] = replaceAt(buffer[lineY], headerX, framedLine)
  }

  // Header bottom border.
  const headerBottomY = headerY + logoLines.length + 1
  const headerBottomBorder = `╰${'─'.repeat(headerWidth - 2)}╯`
  if (headerBottomY < rows - 1) {
    buffer[headerBottomY] = replaceAt(
      buffer[headerBottomY],
      headerX,
      headerBottomBorder,
    )
  }

  // Draw console window (top-right, double border).
  const consoleTopBorder = `╔${' Console Output '.padEnd(rect.width - 2, '═')}╗`
  buffer[rect.y] = replaceAt(buffer[rect.y], rect.x, consoleTopBorder)

  // Console content lines.
  for (let i = 0; i < rect.height - 2 && i < state.consoleLines.length; i++) {
    const lineY = rect.y + 1 + i
    const content = state.consoleLines[i]
      .slice(0, rect.width - 4)
      .padEnd(rect.width - 4)
    buffer[lineY] = replaceAt(buffer[lineY], rect.x, `║ ${content} ║`)
  }

  // Fill remaining console lines.
  for (let i = state.consoleLines.length; i < rect.height - 2; i++) {
    const lineY = rect.y + 1 + i
    buffer[lineY] = replaceAt(
      buffer[lineY],
      rect.x,
      `║${' '.repeat(rect.width - 2)}║`,
    )
  }

  // Console bottom border.
  const consoleBottomY = rect.y + rect.height - 1
  const consoleBottomBorder = `╚${'═'.repeat(rect.width - 2)}╝`
  buffer[consoleBottomY] = replaceAt(
    buffer[consoleBottomY],
    rect.x,
    consoleBottomBorder,
  )

  // Draw input text block (bottom, above outer border) - same width as console window.
  const inputBlockHeight = 3
  const inputBlockY = rows - inputBlockHeight - 1
  const inputBlockWidth = rect.width
  const inputBlockX = rect.x

  // Input block top border.
  const inputTopBorder = `┌${'─'.repeat(inputBlockWidth - 2)}┐`
  buffer[inputBlockY] = replaceAt(
    buffer[inputBlockY],
    inputBlockX,
    inputTopBorder,
  )

  // Input text line with cursor.
  const inputLineY = inputBlockY + 1
  const maxInputWidth = inputBlockWidth - 4
  const displayText = state.inputText
    .slice(0, maxInputWidth)
    .padEnd(maxInputWidth)
  const cursorChar = '█'
  const cursorPos = Math.min(state.cursorPosition, maxInputWidth - 1)
  const textWithCursor =
    displayText.slice(0, cursorPos) +
    cursorChar +
    displayText.slice(cursorPos + 1)

  buffer[inputLineY] = replaceAt(
    buffer[inputLineY],
    inputBlockX,
    `│ ${textWithCursor} │`,
  )

  // Input block bottom border.
  const inputBottomY = inputBlockY + 2
  const inputBottomBorder = `└${'─'.repeat(inputBlockWidth - 2)}┘`
  buffer[inputBottomY] = replaceAt(
    buffer[inputBottomY],
    inputBlockX,
    inputBottomBorder,
  )

  // Status bar (below input block).
  const statusY = rows - 2
  const statusText = `  Connected • Socket CLI • Theme: ${state.theme} • Frame: ${state.frame} • Press q to exit`
  const statusPadded = statusText.padEnd(cols - 2)
  buffer[statusY] =
    buffer[statusY].slice(0, 1) + statusPadded + buffer[statusY].slice(cols - 1)

  return buffer.join('\n')
}

/**
 * Render frame.
 */
function renderFrame() {
  const screen = drawCompleteTUI()
  process.stdout.write('\x1B[H' + screen)

  state.frame++

  // Blink cursor.
  if (state.frame % 30 === 0) {
    state.cursorPosition = state.cursorPosition === 2 ? 3 : 2
  }
}

/**
 * Handle keyboard input.
 */
function handleInput(chunk) {
  const key = chunk[0]

  // Exit.
  if (key === 3 || key === 113) {
    // Ctrl+C or 'q'.
    cleanup()
    return
  }

  // Add to console output (for demo).
  if (key === 13) {
    // Enter.
    state.consoleLines.push(state.inputText)
    if (state.consoleLines.length > 20) {
      state.consoleLines.shift()
    }
    state.inputText = '> '
    state.cursorPosition = 2
  } else if (key === 127 || key === 8) {
    // Backspace.
    if (state.inputText.length > 2) {
      state.inputText = state.inputText.slice(0, -1)
      state.cursorPosition = Math.max(2, state.cursorPosition - 1)
    }
  } else if (key >= 32 && key <= 126) {
    // Printable character.
    state.inputText += String.fromCharCode(key)
    state.cursorPosition++
  }

  // Theme cycling.
  if (key === 116) {
    // 't'.
    const themes = ['default', 'cyberpunk', 'forest', 'ocean', 'sunset']
    const currentIndex = themes.indexOf(state.theme)
    state.theme = themes[(currentIndex + 1) % themes.length]
  }

  renderFrame()
}

/**
 * Global cleanup state.
 */
let isCleaningUp = false
let activeInterval = null

/**
 * Cleanup and exit.
 */
function cleanup() {
  if (isCleaningUp) {
    return
  }
  isCleaningUp = true

  if (activeInterval) {
    clearInterval(activeInterval)
  }

  try {
    if (process.stdin.isTTY && process.stdin.isRaw) {
      process.stdin.setRawMode(false)
    }
    process.stdout.write('\x1B[?1049l')
    process.stdout.write('\x1B[?25h')
    process.stdout.write('\x1B[2J\x1B[H')
    // Ignore cleanup errors.
  } catch {}

  console.log('\nExiting complete TUI demo...\n')
  process.exit(0)
}

/**
 * Initialize.
 */
function init() {
  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    console.error('Error: This requires a TTY environment.')
    process.exit(1)
  }

  // Enter alternate screen.
  process.stdout.write('\x1B[?1049h')
  process.stdout.write('\x1B[?25l')
  process.stdout.write('\x1B[2J\x1B[H')

  // Set up raw mode.
  process.stdin.setRawMode(true)
  process.stdin.resume()
  process.stdin.on('data', handleInput)

  // Signal handlers.
  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)
  process.on('uncaughtException', cleanup)

  // Resize handler.
  process.stdout.on('resize', renderFrame)

  // Animation loop.
  activeInterval = setInterval(renderFrame, 1000 / 15)

  // Initial render.
  renderFrame()
}

// Start.
init()
