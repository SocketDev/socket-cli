/**
 * Interactive TUI development session.
 * Allows real-time tweaking of console window design.
 */

/**
 * UI State for the console window rectangle.
 */
const state = {
  // Console window dimensions (percentage of screen).
  consoleWidth: 40,
  consoleHeight: 30,
  // Console window position.
  consoleX: 0,
  consoleY: 0,
  // Visual properties.
  showBorder: true,
  borderStyle: 'double',
  theme: 'default',
  // Animation.
  frame: 0,
  showHelp: true,
}

/**
 * Border styles.
 */
const BORDER_STYLES = {
  single: {
    topLeft: '┌',
    topRight: '┐',
    bottomLeft: '└',
    bottomRight: '┘',
    horizontal: '─',
    vertical: '│',
  },
  double: {
    topLeft: '╔',
    topRight: '╗',
    bottomLeft: '╚',
    bottomRight: '╝',
    horizontal: '═',
    vertical: '║',
  },
  rounded: {
    topLeft: '╭',
    topRight: '╮',
    bottomLeft: '╰',
    bottomRight: '╯',
    horizontal: '─',
    vertical: '│',
  },
  heavy: {
    topLeft: '┏',
    topRight: '┓',
    bottomLeft: '┗',
    bottomRight: '┛',
    horizontal: '━',
    vertical: '┃',
  },
}

/**
 * Get terminal dimensions.
 */
function getTerminalSize() {
  const cols = Math.max(40, Math.min(500, process.stdout.columns || 80))
  const rows = Math.max(10, Math.min(200, process.stdout.rows || 24))
  return { cols, rows }
}

/**
 * Calculate console window dimensions in characters.
 */
function getConsoleRect() {
  const { cols, rows } = getTerminalSize()
  const width = Math.floor((cols * state.consoleWidth) / 100)
  const height = Math.floor((rows * state.consoleHeight) / 100)
  const x = cols - width
  const y = 0
  return { x, y, width, height }
}

/**
 * Draw the console window rectangle.
 */
function drawConsoleWindow() {
  const { cols, rows } = getTerminalSize()
  const rect = getConsoleRect()
  const borders = BORDER_STYLES[state.borderStyle]

  // Create empty screen buffer.
  const buffer = Array(rows)
    .fill(null)
    .map(() => ' '.repeat(cols))

  // Draw border if enabled.
  if (state.showBorder) {
    // Top border.
    const topBorder =
      borders.topLeft +
      borders.horizontal.repeat(rect.width - 2) +
      borders.topRight
    buffer[rect.y] =
      buffer[rect.y].slice(0, rect.x) +
      topBorder +
      buffer[rect.y].slice(rect.x + topBorder.length)

    // Bottom border.
    const bottomY = rect.y + rect.height - 1
    const bottomBorder =
      borders.bottomLeft +
      borders.horizontal.repeat(rect.width - 2) +
      borders.bottomRight
    buffer[bottomY] =
      buffer[bottomY].slice(0, rect.x) +
      bottomBorder +
      buffer[bottomY].slice(rect.x + bottomBorder.length)

    // Side borders.
    for (let i = rect.y + 1; i < rect.y + rect.height - 1; i++) {
      buffer[i] =
        buffer[i].slice(0, rect.x) +
        borders.vertical +
        buffer[i].slice(rect.x + 1, rect.x + rect.width - 1) +
        borders.vertical +
        buffer[i].slice(rect.x + rect.width)
    }
  }

  // Add title.
  const title = ` Console Window (${rect.width}x${rect.height}) `
  if (title.length < rect.width - 2) {
    const titleX = rect.x + Math.floor((rect.width - title.length) / 2)
    buffer[rect.y] =
      buffer[rect.y].slice(0, titleX) +
      title +
      buffer[rect.y].slice(titleX + title.length)
  }

  return buffer.join('\n')
}

/**
 * Draw help panel.
 */
function drawHelp() {
  if (!state.showHelp) {
    return ''
  }

  const help = [
    '',
    '╔═══════════════════════════════════════╗',
    '║  Interactive TUI Designer             ║',
    '╠═══════════════════════════════════════╣',
    '║  Arrow Keys    Adjust size            ║',
    '║  w/a/s/d       Move window            ║',
    '║  b             Toggle border          ║',
    '║  1-4           Border style           ║',
    '║  t             Cycle theme            ║',
    '║  h             Toggle help            ║',
    '║  q/Ctrl+C      Exit                   ║',
    '╚═══════════════════════════════════════╝',
    '',
  ]

  return help.join('\n')
}

/**
 * Draw status bar.
 */
function drawStatusBar() {
  const { cols } = getTerminalSize()
  const rect = getConsoleRect()
  const status = `Size: ${state.consoleWidth}%x${state.consoleHeight}% (${rect.width}x${rect.height} chars) | Border: ${state.borderStyle} | Theme: ${state.theme} | Press 'h' for help`

  return status.slice(0, cols)
}

/**
 * Render complete frame.
 */
function renderFrame() {
  const { cols } = getTerminalSize()

  // Draw base screen with console window.
  const screen = drawConsoleWindow()

  // Overlay help if visible.
  const help = drawHelp()

  // Create status bar.
  const statusBar = drawStatusBar()

  // Combine everything.
  let output = '\x1B[H'

  if (state.showHelp) {
    output += help
  }

  output += screen + '\n'
  output += '─'.repeat(cols) + '\n'
  output += statusBar

  process.stdout.write(output)
  state.frame++
}

/**
 * Handle keyboard input.
 */
function handleInput(chunk) {
  const key = chunk[0]

  // Exit keys.
  if (key === 3 || key === 113) {
    // Ctrl+C or 'q'.
    cleanup()
    return
  }

  // Help toggle.
  if (key === 104) {
    // 'h'.
    state.showHelp = !state.showHelp
  }

  // Border toggle.
  if (key === 98) {
    // 'b'.
    state.showBorder = !state.showBorder
  }

  // Border styles.
  if (key === 49) {
    state.borderStyle = 'single'
  }
  if (key === 50) {
    state.borderStyle = 'double'
  }
  if (key === 51) {
    state.borderStyle = 'rounded'
  }
  if (key === 52) {
    state.borderStyle = 'heavy'
  }

  // Theme cycling.
  if (key === 116) {
    // 't'.
    const themes = ['default', 'cyberpunk', 'forest', 'ocean', 'sunset']
    const currentIndex = themes.indexOf(state.theme)
    state.theme = themes[(currentIndex + 1) % themes.length]
  }

  // Arrow keys for size adjustment.
  if (chunk.length === 3 && chunk[0] === 27 && chunk[1] === 91) {
    if (chunk[2] === 65) {
      // Up arrow - increase height.
      state.consoleHeight = Math.min(100, state.consoleHeight + 5)
    }
    if (chunk[2] === 66) {
      // Down arrow - decrease height.
      state.consoleHeight = Math.max(10, state.consoleHeight - 5)
    }
    if (chunk[2] === 67) {
      // Right arrow - increase width.
      state.consoleWidth = Math.min(100, state.consoleWidth + 5)
    }
    if (chunk[2] === 68) {
      // Left arrow - decrease width.
      state.consoleWidth = Math.max(10, state.consoleWidth - 5)
    }
  }

  // WASD for position (future use).
  if (key === 119) {
    state.consoleY = Math.max(0, state.consoleY - 1)
  }
  if (key === 115) {
    state.consoleY = Math.min(10, state.consoleY + 1)
  }
  if (key === 97) {
    state.consoleX = Math.max(0, state.consoleX - 1)
  }
  if (key === 100) {
    state.consoleX = Math.min(10, state.consoleX + 1)
  }

  // Immediate re-render.
  renderFrame()
}

/**
 * Global cleanup state.
 */
let isCleaningUp = false

/**
 * Cleanup and exit.
 */
function cleanup() {
  if (isCleaningUp) {
    return
  }
  isCleaningUp = true

  try {
    if (process.stdin.isTTY && process.stdin.isRaw) {
      process.stdin.setRawMode(false)
    }
    process.stdout.write('\x1B[?1049l')
    process.stdout.write('\x1B[?25h')
    process.stdout.write('\x1B[2J\x1B[H')
    // Ignore cleanup errors.
  } catch {}

  console.log('\nExiting interactive TUI designer...\n')
  process.exit(0)
}

/**
 * Initialize interactive session.
 */
function init() {
  // Check TTY.
  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    console.error('Error: This requires a TTY environment.')
    process.exit(1)
  }

  // Enter alternate screen.
  process.stdout.write('\x1B[?1049h')
  process.stdout.write('\x1B[?25l')
  process.stdout.write('\x1B[2J\x1B[H')

  // Set up raw mode for input.
  process.stdin.setRawMode(true)
  process.stdin.resume()
  process.stdin.on('data', handleInput)

  // Set up signal handlers.
  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)
  process.on('uncaughtException', e => {
    console.error('Error:', e.message)
    cleanup()
  })

  // Handle resize.
  process.stdout.on('resize', renderFrame)

  // Initial render.
  renderFrame()
}

// Start interactive session.
init()
