/**
 * TUI layout based on John-David's sketch.
 *
 * Layout:
 * - Socket.dev header at top
 * - Left side: menu items with checkmarks
 * - Right side: scroll hint for console output
 * - Bottom: input prompt
 */

/**
 * UI State.
 */
const state = {
  menuItems: [
    { text: 'Scan packages', checked: true },
    { text: 'Review issues', checked: true },
    { text: 'Install dependencies', checked: false },
    { text: 'Run tests', checked: false },
  ],
  consoleLines: [],
  inputText: '> ',
  cursorPosition: 2,
  scrollHint: 'Scroll ↑↓',
  frame: 0,
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
 * Draw the TUI layout from sketch.
 */
function drawSketchTUI() {
  const { cols, rows } = getTerminalSize()

  // Create screen buffer.
  const buffer = Array(rows)
    .fill(null)
    .map(() => ' '.repeat(cols))

  // Outer border.
  const outerTopBorder = `╔${'═'.repeat(cols - 2)}╗`
  const outerBottomBorder = `╚${'═'.repeat(cols - 2)}╝`
  buffer[0] = outerTopBorder
  buffer[rows - 1] = outerBottomBorder

  for (let i = 1; i < rows - 1; i++) {
    buffer[i] = `║${buffer[i].slice(1, cols - 1)}║`
  }

  // Header "Socket.dev" at top.
  const headerY = 2
  const headerText = 'Socket.dev'
  const headerX = 4
  buffer[headerY] = replaceAt(buffer[headerY], headerX, headerText)

  // Header underline.
  const underlineY = headerY + 1
  const underline = '─'.repeat(headerText.length)
  buffer[underlineY] = replaceAt(buffer[underlineY], headerX, underline)

  // Menu items (left side) with checkmarks.
  const menuStartY = 5
  const menuX = 4

  for (let i = 0; i < state.menuItems.length; i++) {
    const item = state.menuItems[i]
    const lineY = menuStartY + i
    const checkbox = item.checked ? '✓' : '✗'
    const menuLine = `${checkbox} ${item.text}`
    buffer[lineY] = replaceAt(buffer[lineY], menuX, menuLine)
  }

  // Scroll hint (right side).
  const scrollHintY = 5
  const scrollHintX = cols - state.scrollHint.length - 4
  buffer[scrollHintY] = replaceAt(
    buffer[scrollHintY],
    scrollHintX,
    state.scrollHint,
  )

  // Console output area (right side, below scroll hint).
  const consoleStartY = 7
  const consoleX = Math.floor(cols / 2) + 2
  const consoleWidth = cols - consoleX - 3

  for (
    let i = 0;
    i < state.consoleLines.length && i < rows - consoleStartY - 5;
    i++
  ) {
    const lineY = consoleStartY + i
    const line = state.consoleLines[i]
      .slice(0, consoleWidth)
      .padEnd(consoleWidth)
    buffer[lineY] = replaceAt(buffer[lineY], consoleX, line)
  }

  // Input prompt at bottom.
  const inputY = rows - 3
  const inputX = 4
  const inputWidth = cols - 8
  const displayText = state.inputText.slice(0, inputWidth)
  const cursorChar = '█'
  const cursorPos = Math.min(state.cursorPosition, displayText.length)
  const textWithCursor =
    displayText.slice(0, cursorPos) + cursorChar + displayText.slice(cursorPos)

  // Input border line above.
  const inputBorderY = inputY - 1
  const inputBorder = '─'.repeat(inputWidth)
  buffer[inputBorderY] = replaceAt(buffer[inputBorderY], inputX, inputBorder)

  buffer[inputY] = replaceAt(buffer[inputY], inputX, textWithCursor)

  return buffer.join('\n')
}

/**
 * Helper to replace text at position.
 */
function replaceAt(str, index, replacement) {
  if (index < 0 || index >= str.length) {
    return str
  }
  const endIndex = Math.min(str.length, index + replacement.length)
  return str.slice(0, index) + replacement + str.slice(endIndex)
}

/**
 * Render frame.
 */
function renderFrame() {
  const screen = drawSketchTUI()
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

  // Toggle menu items with 1-4 keys.
  if (key >= 49 && key <= 52) {
    const itemIndex = key - 49
    if (itemIndex < state.menuItems.length) {
      state.menuItems[itemIndex].checked = !state.menuItems[itemIndex].checked
    }
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

  console.log('\nExiting sketch TUI demo...\n')
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

  // Animation loop (for cursor blink).
  activeInterval = setInterval(renderFrame, 1000 / 15)

  // Initial render.
  renderFrame()
}

// Start.
init()
