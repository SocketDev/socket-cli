/**
 * Test how ANSI codes affect line length and padding.
 */

function visibleLength(str) {
  return str.replace(/\x1B\[[0-9;]*m/g, '').length
}

// Simulate a line with ANSI codes (like the shimmer logo).
const line = '\x1B[1m\x1B[38;2;139;92;246mSocket\x1B[0m'
console.log('Original line:', JSON.stringify(line))
console.log('Visible length:', visibleLength(line))
console.log('Actual byte length:', line.length)
console.log('Bytes:', Buffer.from(line).length)
console.log('')

// Now pad it to 120 chars.
const cols = 120
const visible = visibleLength(line)
const padded = line + ' '.repeat(cols - visible)

console.log('After padding to 120:')
console.log('Visible length:', visibleLength(padded))
console.log('Actual byte length:', padded.length)
console.log('Bytes:', Buffer.from(padded).length)
console.log('')

console.log('🔴 THE PROBLEM:')
console.log(
  `We want 120 visible chars, we got ${visibleLength(padded)} visible chars. ✅`,
)
console.log(`But the actual string is ${padded.length} bytes long!`)
console.log('When terminal renders this, it sees:')
console.log(`  - ANSI codes (control sequences, don't move cursor)`)
console.log(`  - ${visibleLength(line)} visible chars from original`)
console.log(`  - ${cols - visible} spaces`)
console.log(`  - Total visible: ${visibleLength(padded)} chars ✅`)
console.log('')

console.log('✅ This should actually be OK!')
console.log('ANSI codes do NOT move the cursor.')
console.log('So padding based on visible length is correct.')
console.log('')

console.log('🔍 So why is there STILL garbling?')
console.log('')
console.log('Theory 1: replaceAt() is breaking ANSI codes')
console.log('Theory 2: The buffer lines are getting truncated somewhere')
console.log('Theory 3: We are not actually rendering all rows')
console.log('Theory 4: The animation loop is interfering')
