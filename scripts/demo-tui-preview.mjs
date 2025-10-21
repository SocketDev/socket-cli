/**
 * Generate static previews of TUI console window designs.
 */

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
 * Draw a console window preview.
 */
function drawConsolePreview(options) {
  const {
    borderStyle = 'double',
    consoleHeightPercent = 30,
    consoleWidthPercent = 40,
    terminalCols = 120,
    terminalRows = 30,
    title = 'Console Window',
  } = options

  const consoleWidth = Math.floor((terminalCols * consoleWidthPercent) / 100)
  const consoleHeight = Math.floor((terminalRows * consoleHeightPercent) / 100)
  const consoleX = terminalCols - consoleWidth
  const consoleY = 0

  const borders = BORDER_STYLES[borderStyle]

  // Create screen buffer.
  const buffer = Array(terminalRows)
    .fill(null)
    .map(() => ' '.repeat(terminalCols))

  // Draw top border.
  const topBorder =
    borders.topLeft +
    borders.horizontal.repeat(consoleWidth - 2) +
    borders.topRight
  buffer[consoleY] =
    buffer[consoleY].slice(0, consoleX) +
    topBorder +
    buffer[consoleY].slice(consoleX + topBorder.length)

  // Draw bottom border.
  const bottomY = consoleY + consoleHeight - 1
  const bottomBorder =
    borders.bottomLeft +
    borders.horizontal.repeat(consoleWidth - 2) +
    borders.bottomRight
  buffer[bottomY] =
    buffer[bottomY].slice(0, consoleX) +
    bottomBorder +
    buffer[bottomY].slice(consoleX + bottomBorder.length)

  // Draw side borders.
  for (let i = consoleY + 1; i < consoleY + consoleHeight - 1; i++) {
    buffer[i] =
      buffer[i].slice(0, consoleX) +
      borders.vertical +
      buffer[i].slice(consoleX + 1, consoleX + consoleWidth - 1) +
      borders.vertical +
      buffer[i].slice(consoleX + consoleWidth)
  }

  // Add title.
  const titleText = ` ${title} (${consoleWidth}x${consoleHeight}) `
  if (titleText.length < consoleWidth - 2) {
    const titleX = consoleX + Math.floor((consoleWidth - titleText.length) / 2)
    buffer[consoleY] =
      buffer[consoleY].slice(0, titleX) +
      titleText +
      buffer[consoleY].slice(titleX + titleText.length)
  }

  // Add sample content inside console.
  const sampleLines = [
    'Socket CLI Output',
    '',
    '✓ Package scanned',
    '✓ No issues found',
    '',
    '> socket npm install',
    '',
  ]

  for (let i = 0; i < sampleLines.length && i < consoleHeight - 2; i++) {
    const lineY = consoleY + 1 + i
    const content = sampleLines[i]
    const contentX = consoleX + 2
    buffer[lineY] =
      buffer[lineY].slice(0, contentX) +
      content +
      buffer[lineY].slice(contentX + content.length)
  }

  return buffer.join('\n')
}

/**
 * Generate multiple preview variations.
 */
function generatePreviews() {
  const configs = [
    {
      name: 'Small (30% x 25%)',
      consoleWidthPercent: 30,
      consoleHeightPercent: 25,
      borderStyle: 'rounded',
    },
    {
      name: 'Medium (40% x 30%)',
      consoleWidthPercent: 40,
      consoleHeightPercent: 30,
      borderStyle: 'double',
    },
    {
      name: 'Large (50% x 40%)',
      consoleWidthPercent: 50,
      consoleHeightPercent: 40,
      borderStyle: 'double',
    },
    {
      name: 'Tall (35% x 50%)',
      consoleWidthPercent: 35,
      consoleHeightPercent: 50,
      borderStyle: 'single',
    },
  ]

  console.log('═'.repeat(120))
  console.log('Console Window Design Previews'.padStart(70))
  console.log('═'.repeat(120))
  console.log()

  for (const config of configs) {
    console.log()
    console.log(`▼ ${config.name} - ${config.borderStyle} border`)
    console.log('─'.repeat(120))
    const preview = drawConsolePreview(config)
    console.log(preview)
    console.log('─'.repeat(120))
    console.log()
  }

  console.log()
  console.log('Border Style Comparison:')
  console.log('─'.repeat(120))

  const styles = ['single', 'double', 'rounded', 'heavy']
  for (const style of styles) {
    console.log()
    console.log(`▼ ${style.toUpperCase()} border style (40% x 30%)`)
    const preview = drawConsolePreview({
      consoleWidthPercent: 40,
      consoleHeightPercent: 30,
      borderStyle: style,
      title: `${style} style`,
    })
    console.log(preview.split('\n').slice(0, 12).join('\n'))
    console.log('...')
  }

  console.log()
  console.log('═'.repeat(120))
  console.log()
}

// Generate previews.
generatePreviews()
