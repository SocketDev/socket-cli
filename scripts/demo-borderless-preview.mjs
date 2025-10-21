/**
 * Preview the borderless output box design.
 */

// Simulate the borderless output box.
const width = 80
const label = ' Command Output '

// Label bar (centered with separator).
const labelPadding = Math.floor((width - label.length - 4) / 2)
const leftPad = '─'.repeat(labelPadding)
const rightPad = '─'.repeat(width - labelPadding - label.length - 4)
const labelBar = `${leftPad}[ ${label} ]${rightPad}`

// Sample content lines.
const content1 = 'Socket CLI v1.0.80'.padEnd(width, ' ')
const content2 = ''.padEnd(width, ' ')
const content3 = 'Welcome to Socket CLI!'.padEnd(width, ' ')
const content4 = 'Type commands below...'.padEnd(width, ' ')
const emptyLine = ' '.repeat(width)

// Outer frame for context.
const outerTop = `╔${'═'.repeat(width + 4)}╗`
const outerSide = '║  '
const outerEnd = '  ║'
const outerBottom = `╚${'═'.repeat(width + 4)}╝`

console.log('\nBorderless Output Box Design:\n')
console.log(outerTop)
console.log(outerSide + labelBar + outerEnd)
console.log(outerSide + content1 + outerEnd)
console.log(outerSide + content2 + outerEnd)
console.log(outerSide + content3 + outerEnd)
console.log(outerSide + content4 + outerEnd)
console.log(outerSide + emptyLine + outerEnd)
console.log(outerSide + emptyLine + outerEnd)
console.log(outerBottom)

console.log('\nKey features:')
console.log('- Clean label bar with centered text')
console.log('- No side borders (uses outer frame)')
console.log('- Content spans full width')
console.log('- Scroll indicator appears in top-right when needed')
console.log('- Themeable via label bar styling\n')
