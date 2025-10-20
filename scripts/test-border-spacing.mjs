/**
 * Test border spacing consistency.
 */

const width = 60

console.log('Testing OutputBoxControl border spacing:\n')

// Content line (with text).
const content = 'Socket CLI v1.0.80'.slice(0, width - 4).padEnd(width - 4, ' ')
const contentLine = `│ ${content} │`

// Empty line (no text).
const emptyLine = `│ ${' '.repeat(width - 4)} │`

// Old broken empty line (for comparison).
const brokenEmptyLine = `│${' '.repeat(width - 2)}│`

console.log('Width:', width)
console.log('Content width (width - 4):', width - 4)
console.log('')

console.log('Content line:')
console.log(contentLine)
console.log('Length:', contentLine.length, '| Visible:', contentLine.length)

console.log('')

console.log('Fixed empty line:')
console.log(emptyLine)
console.log('Length:', emptyLine.length, '| Visible:', emptyLine.length)

console.log('')

console.log('OLD BROKEN empty line (for comparison):')
console.log(brokenEmptyLine)
console.log('Length:', brokenEmptyLine.length, '| Visible:', brokenEmptyLine.length)

console.log('')

// Visual comparison.
console.log('=== VISUAL COMPARISON ===')
console.log('┌' + '─'.repeat(width - 2) + '┐')
console.log(contentLine)
console.log(emptyLine)
console.log(emptyLine)
console.log(contentLine)
console.log('└' + '─'.repeat(width - 2) + '┘')

console.log('')
console.log('=== OLD BROKEN VERSION ===')
console.log('┌' + '─'.repeat(width - 2) + '┐')
console.log(contentLine)
console.log(brokenEmptyLine) // This one doesn't match!
console.log(brokenEmptyLine)
console.log(contentLine)
console.log('└' + '─'.repeat(width - 2) + '┘')
