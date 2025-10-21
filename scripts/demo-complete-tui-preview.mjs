/**
 * Static preview of complete TUI layout.
 */

import { renderShimmerFrame } from '../src/utils/terminal/ascii-header.mts'

/**
 * Draw complete TUI layout preview.
 */
function drawCompleteTUIPreview() {
  const cols = 120
  const rows = 30

  // Console window config.
  const consoleWidthPercent = 40
  const consoleHeightPercent = 30
  const consoleWidth = Math.floor((cols * consoleWidthPercent) / 100)
  const consoleHeight = Math.floor((rows * consoleHeightPercent) / 100)
  const consoleX = cols - consoleWidth - 1
  const consoleY = 1

  // Create buffer.
  const buffer = Array(rows)
    .fill(null)
    .map(() => ' '.repeat(cols))

  // Outer screen border (double).
  const outerTopBorder = `╔${'═'.repeat(cols - 2)}╗`
  const outerBottomBorder = `╚${'═'.repeat(cols - 2)}╝`
  buffer[0] = outerTopBorder
  buffer[rows - 1] = outerBottomBorder

  // Outer side borders.
  for (let i = 1; i < rows - 1; i++) {
    buffer[i] = `║${buffer[i].slice(1, cols - 1)}║`
  }

  // Header frame (centered).
  const headerStartRow = 2
  const logo = renderShimmerFrame(0, 'default')
  const logoLines = logo.split('\n')
  const headerWidth = 35
  const headerX = Math.floor((cols - headerWidth) / 2)

  // Header top border.
  const headerTopBorder = `╭${'─'.repeat(headerWidth - 2)}╮`
  buffer[headerStartRow] =
    buffer[headerStartRow].slice(0, headerX) +
    headerTopBorder +
    buffer[headerStartRow].slice(headerX + headerTopBorder.length)

  // Header content.
  for (let i = 0; i < logoLines.length; i++) {
    const lineY = headerStartRow + 1 + i
    const line = logoLines[i]
    const lineLength = line.replace(/\x1B\[[0-9;]*m/g, '').length
    const leftPad = Math.floor((headerWidth - 2 - lineLength) / 2)
    const rightPad = headerWidth - 2 - lineLength - leftPad

    buffer[lineY] =
      buffer[lineY].slice(0, headerX) +
      '│' +
      ' '.repeat(leftPad) +
      line +
      ' '.repeat(rightPad) +
      '│' +
      buffer[lineY].slice(headerX + headerWidth)
  }

  // Header bottom border.
  const headerBottomY = headerStartRow + logoLines.length + 1
  const headerBottomBorder = `╰${'─'.repeat(headerWidth - 2)}╯`
  buffer[headerBottomY] =
    buffer[headerBottomY].slice(0, headerX) +
    headerBottomBorder +
    buffer[headerBottomY].slice(headerX + headerBottomBorder.length)

  // Console window (top-right, double border).
  const consoleTopBorder = `╔${' Console Output '.padEnd(consoleWidth - 2, '═')}╗`
  buffer[consoleY] =
    buffer[consoleY].slice(0, consoleX) +
    consoleTopBorder +
    buffer[consoleY].slice(consoleX + consoleTopBorder.length)

  // Console content.
  const consoleLines = [
    'Socket CLI Output',
    '',
    '✓ Package scanned',
    '✓ No issues found',
    '',
    '> socket npm install',
    '',
    'Installing dependencies...',
  ]

  for (let i = 0; i < consoleHeight - 2 && i < consoleLines.length; i++) {
    const lineY = consoleY + 1 + i
    const content = consoleLines[i].padEnd(consoleWidth - 4)
    buffer[lineY] =
      buffer[lineY].slice(0, consoleX) +
      `║ ${content} ║` +
      buffer[lineY].slice(consoleX + consoleWidth)
  }

  // Fill remaining console lines.
  for (let i = consoleLines.length; i < consoleHeight - 2; i++) {
    const lineY = consoleY + 1 + i
    buffer[lineY] =
      buffer[lineY].slice(0, consoleX) +
      `║${' '.repeat(consoleWidth - 2)}║` +
      buffer[lineY].slice(consoleX + consoleWidth)
  }

  // Console bottom border.
  const consoleBottomY = consoleY + consoleHeight - 1
  const consoleBottomBorder = `╚${'═'.repeat(consoleWidth - 2)}╝`
  buffer[consoleBottomY] =
    buffer[consoleBottomY].slice(0, consoleX) +
    consoleBottomBorder +
    buffer[consoleBottomY].slice(consoleX + consoleBottomBorder.length)

  // Input text block (bottom).
  const inputBlockHeight = 3
  const inputBlockY = rows - inputBlockHeight - 1
  const inputBlockWidth = Math.floor(cols * 0.6)
  const inputBlockX = Math.floor((cols - inputBlockWidth) / 2)

  // Input top border.
  const inputTopBorder = `┌${'─'.repeat(inputBlockWidth - 2)}┐`
  buffer[inputBlockY] =
    buffer[inputBlockY].slice(0, inputBlockX) +
    inputTopBorder +
    buffer[inputBlockY].slice(inputBlockX + inputTopBorder.length)

  // Input text with cursor.
  const inputLineY = inputBlockY + 1
  const inputText = '> socket scan --json█'
  const displayText = inputText.padEnd(inputBlockWidth - 4)
  buffer[inputLineY] =
    buffer[inputLineY].slice(0, inputBlockX) +
    `│ ${displayText} │` +
    buffer[inputLineY].slice(inputBlockX + inputBlockWidth)

  // Input bottom border.
  const inputBottomY = inputBlockY + 2
  const inputBottomBorder = `└${'─'.repeat(inputBlockWidth - 2)}┘`
  buffer[inputBottomY] =
    buffer[inputBottomY].slice(0, inputBlockX) +
    inputBottomBorder +
    buffer[inputBottomY].slice(inputBlockX + inputBottomBorder.length)

  // Status bar (below input block).
  const statusY = rows - 2
  const statusText = '  Connected • Socket CLI v1.0.80 • Theme: default • Press q to exit'
  const statusPadded = statusText.padEnd(cols - 2)
  buffer[statusY] =
    buffer[statusY].slice(0, 1) +
    statusPadded +
    buffer[statusY].slice(cols - 1)

  return buffer.join('\n')
}

console.log('\n')
console.log('═'.repeat(120))
console.log('Complete TUI Layout Preview'.padStart(70))
console.log('═'.repeat(120))
console.log('\n')
console.log(drawCompleteTUIPreview())
console.log('\n')
console.log('═'.repeat(120))
console.log('Components:')
console.log('  • Double border around entire screen')
console.log('  • Header frame (centered) with Socket CLI logo and shimmer animation')
console.log('  • Console output window (top-right, 40% × 30%)')
console.log('  • Input text block (bottom, 60% width) with cursor')
console.log('═'.repeat(120))
console.log('\n')
