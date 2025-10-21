/**
 * Demo script to showcase full-window framing with animated header.
 */

import { renderShimmerFrame } from '../src/utils/terminal/ascii-header.mts'

const THEMES = ['default', 'cyberpunk', 'forest', 'ocean', 'sunset']

/**
 * Get terminal dimensions with validation.
 */
function getTerminalSize() {
  const cols = Math.max(40, Math.min(500, process.stdout.columns || 80))
  const rows = Math.max(10, Math.min(200, process.stdout.rows || 24))
  return { cols, rows }
}

/**
 * Check if we're in a proper TTY environment.
 */
function canAnimate() {
  return process.stdout.isTTY && process.stdin.isTTY
}

/**
 * Cache for repeated strings to reduce allocation.
 */
const stringCache = new Map()

/**
 * Get cached repeated string.
 */
function getCachedString(char, count) {
  const key = `${char}:${count}`
  if (!stringCache.has(key)) {
    stringCache.set(key, char.repeat(Math.max(0, count)))
  }
  return stringCache.get(key)
}

/**
 * Strip ANSI codes and get visible length.
 */
const ansiRegex = /\x1B\[[0-9;]*m/g
function getVisibleLength(str) {
  return str.replace(ansiRegex, '').length
}

/**
 * Draw a full-window frame with content inside.
 */
function drawFullWindowFrame(content, title = '') {
  const { cols, rows } = getTerminalSize()
  const innerWidth = cols - 2

  // Build top border with title, ensuring exact width.
  let topBorder
  if (title) {
    const titleWithSpacing = `─ ${title} `
    const titleVisibleLength = getVisibleLength(titleWithSpacing)
    const remainingWidth = innerWidth - titleVisibleLength
    topBorder = `╭${titleWithSpacing}${getCachedString('─', remainingWidth)}╮`
  } else {
    topBorder = `╭${getCachedString('─', innerWidth)}╮`
  }

  // Ensure top border is exactly cols characters (visible).
  const topVisibleLength = getVisibleLength(topBorder)
  if (topVisibleLength > cols) {
    topBorder = topBorder.slice(0, cols - 1) + '╮'
  } else if (topVisibleLength < cols) {
    topBorder =
      topBorder.slice(0, -1) +
      getCachedString('─', cols - topVisibleLength) +
      '╮'
  }

  const bottomBorder = `╰${getCachedString('─', innerWidth)}╯`

  // Split content into lines and center/pad them.
  const contentLines = content.split('\n')

  // Calculate available rows for content (minus 2 for top/bottom borders).
  const availableRows = Math.max(1, rows - 2)

  // Calculate vertical centering.
  const topPadding = Math.floor((availableRows - contentLines.length) / 2)

  // Build framed content with pre-allocated array.
  const totalLines = rows
  const framedContent = new Array(totalLines)
  let lineIndex = 0

  // Add top border.
  framedContent[lineIndex++] = topBorder

  // Add top padding.
  const emptyLine = `│${getCachedString(' ', innerWidth)}│`
  for (let i = 0; i < topPadding && lineIndex < totalLines - 1; i++) {
    framedContent[lineIndex++] = emptyLine
  }

  // Add content lines (centered horizontally).
  for (const line of contentLines) {
    if (lineIndex >= totalLines - 1) {
      break
    }
    const strippedLength = getVisibleLength(line)
    const leftPadding = Math.floor((innerWidth - strippedLength) / 2)
    const rightPadding = innerWidth - strippedLength - leftPadding
    framedContent[lineIndex++] =
      `│${getCachedString(' ', leftPadding)}${line}${getCachedString(' ', rightPadding)}│`
  }

  // Add bottom padding to fill exactly to terminal height.
  while (lineIndex < totalLines - 1) {
    framedContent[lineIndex++] = emptyLine
  }

  // Add bottom border.
  framedContent[lineIndex] = bottomBorder

  // Join with newlines.
  return framedContent.join('\n')
}

/**
 * Render full-window frame with animated header for a specific duration.
 */
async function renderFullWindowWithDuration(theme, duration) {
  const startTime = Date.now()
  let frame = 0
  let resizeRequested = false

  const renderFrame = () => {
    if (Date.now() - startTime >= duration) {
      return false
    }

    const logo = renderShimmerFrame(frame, theme)
    const title = `Socket CLI - Theme: ${theme} | Frame: ${frame}`
    const framedWindow = drawFullWindowFrame(logo, title)

    // Move to home position and clear, then render.
    process.stdout.write('\x1B[H\x1B[J' + framedWindow)

    frame++
    resizeRequested = false
    return true
  }

  // Handle terminal resize events with debouncing.
  const onResize = () => {
    if (!resizeRequested) {
      resizeRequested = true
      // Trigger immediate re-render on resize.
      renderFrame()
    }
  }

  resizeHandler = onResize
  process.stdout.on('resize', onResize)
  process.stdout.write('\x1B[?25l')

  return new Promise(resolve => {
    activeInterval = setInterval(() => {
      if (!renderFrame()) {
        clearInterval(activeInterval)
        activeInterval = null
        process.stdout.off('resize', onResize)
        resizeHandler = null
        process.stdout.write('\x1B[?25h')
        resolve()
      }
    }, 1000 / 15)
  })
}

/**
 * Cycle through all themes with full-window framing.
 */
async function cycleThemes() {
  // Enter alternate screen buffer and disable scrolling.
  process.stdout.write('\x1B[?1049h')
  process.stdout.write('\x1B[?47h')
  process.stdout.write('\x1B[2J\x1B[H')

  for (const theme of THEMES) {
    await renderFullWindowWithDuration(theme, 5000)
    await new Promise(resolve => setTimeout(resolve, 500))
  }

  // Exit alternate screen buffer and restore scrolling.
  process.stdout.write('\x1B[?47l')
  process.stdout.write('\x1B[?1049l')
  console.log('\nDemo complete!\n')
  process.exit(0)
}

/**
 * Global cleanup state.
 */
let isCleaningUp = false
let activeInterval = null
let resizeHandler = null

/**
 * Comprehensive cleanup and exit.
 */
function cleanup(exitCode = 0) {
  // Prevent multiple cleanup calls.
  if (isCleaningUp) {
    return
  }
  isCleaningUp = true

  // Clear any active interval.
  if (activeInterval) {
    clearInterval(activeInterval)
    activeInterval = null
  }

  // Remove resize handler.
  if (resizeHandler) {
    process.stdout.off('resize', resizeHandler)
    resizeHandler = null
  }

  try {
    // Restore terminal state in reverse order of setting.
    if (process.stdin.isTTY && process.stdin.isRaw) {
      process.stdin.setRawMode(false)
    }

    // Exit alternate screen buffers.
    process.stdout.write('\x1B[?47l')
    process.stdout.write('\x1B[?1049l')

    // Restore cursor visibility.
    process.stdout.write('\x1B[?25h')

    // Clear screen.
    process.stdout.write('\x1B[2J\x1B[H')
    // Ignore errors during cleanup.
  } catch {}

  if (exitCode === 0) {
    console.log('\nExiting...\n')
  }

  process.exit(exitCode)
}

// Set up global signal handlers.
process.on('SIGINT', () => {
  console.log('\nReceived SIGINT')
  cleanup()
})
process.on('SIGTERM', () => {
  console.log('\nReceived SIGTERM')
  cleanup()
})

// Add comprehensive error handlers.
process.on('uncaughtException', e => {
  console.error('\nUncaught exception:', e.message)
  cleanup(1)
})

process.on('unhandledRejection', reason => {
  console.error('\nUnhandled rejection:', reason)
  cleanup(1)
})

// Set up stdin to listen for Ctrl+C keypresses.
if (process.stdin.isTTY) {
  try {
    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.on('data', chunk => {
      // Check for Ctrl+C (character code 3) or q key.
      if (chunk[0] === 3 || chunk[0] === 113) {
        cleanup()
      }
    })
  } catch (e) {
    console.error('Failed to set up stdin:', e.message)
  }
}

// Check environment before starting.
if (!canAnimate()) {
  console.error('Error: This demo requires a TTY environment.')
  console.error('Cannot run in piped output or non-interactive mode.')
  process.exit(1)
}

const { cols, rows } = getTerminalSize()
if (cols < 40 || rows < 10) {
  console.error(`Error: Terminal too small (${cols}x${rows})`)
  console.error('Please resize to at least 40x10 characters.')
  process.exit(1)
}

// Run demo.
cycleThemes().catch(e => {
  console.error('Demo error:', e)
  cleanup(1)
})
