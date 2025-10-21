/**
 * Test sliceAtVisibleIndex function to ensure it handles ANSI codes correctly.
 */

function visibleLength(str) {
  return str.replace(/\x1B\[[0-9;]*m/g, '').length
}

function sliceAtVisibleIndex(str, maxVisible) {
  let byteIndex = 0
  let visibleCount = 0
  let inAnsiCode = false

  // Find the byte position of the last visible character.
  for (let i = 0; i < str.length; i++) {
    if (str[i] === '\x1B') {
      inAnsiCode = true
    }

    if (!inAnsiCode) {
      if (visibleCount >= maxVisible) {
        byteIndex = i
        break
      }
      visibleCount++
    }

    if (inAnsiCode && str[i] === 'm') {
      inAnsiCode = false
    }

    byteIndex = i + 1
  }

  // Now extend byteIndex to include any trailing ANSI codes.
  inAnsiCode = false
  for (let i = byteIndex; i < str.length; i++) {
    if (str[i] === '\x1B') {
      inAnsiCode = true
    }

    if (!inAnsiCode) {
      // Hit a visible character, stop here.
      break
    }

    if (inAnsiCode && str[i] === 'm') {
      inAnsiCode = false
      byteIndex = i + 1
    }
  }

  return str.slice(0, byteIndex)
}

// Test cases.
console.log('=== Testing sliceAtVisibleIndex ===\n')

// Test 1: String with ANSI codes in the middle.
const test1 = '\x1B[1m\x1B[38;2;139;92;246mSocket\x1B[0m CLI'
const result1 = sliceAtVisibleIndex(test1, 6)
console.log('Test 1: Slice "Socket CLI" at 6 chars')
console.log(`  Input visible: "${visibleLength(test1)}" chars`)
console.log(`  Result: "${result1}"`)
console.log(`  Result visible: "${visibleLength(result1)}" chars`)
console.log(`  Expected: Should include "Socket" + reset code`)
console.log(`  Has reset code: ${result1.includes('\x1B[0m') ? '✅' : '❌'}`)
console.log('')

// Test 2: String exactly at width.
const test2 = '║  \x1B[1mSocket\x1B[0m' + ' '.repeat(110) + '║'
const result2 = sliceAtVisibleIndex(test2, 120)
console.log('Test 2: Slice border line at 120 chars')
console.log(`  Input visible: "${visibleLength(test2)}" chars`)
console.log(`  Result visible: "${visibleLength(result2)}" chars`)
console.log(`  Match: ${visibleLength(result2) === 120 ? '✅' : '❌'}`)
console.log('')

// Test 3: String with reset code at boundary.
const test3 = 'Text\x1B[1mBold\x1B[0m'
const result3 = sliceAtVisibleIndex(test3, 8)
console.log('Test 3: Slice "TextBold" at 8 chars')
console.log(`  Input: "TextBold" with ANSI`)
console.log(`  Result visible: "${visibleLength(result3)}" chars`)
console.log(`  Has reset code: ${result3.includes('\x1B[0m') ? '✅' : '❌'}`)
console.log(`  Result ends properly: ${result3.endsWith('\x1B[0m') ? '✅' : '❌'}`)
console.log('')

// Test 4: Plain string (no ANSI).
const test4 = 'Plain text here'
const result4 = sliceAtVisibleIndex(test4, 10)
console.log('Test 4: Slice plain text at 10 chars')
console.log(`  Result: "${result4}"`)
console.log(`  Expected: "Plain text"`)
console.log(`  Match: ${result4 === 'Plain text' ? '✅' : '❌'}`)
console.log('')

console.log('=== All tests complete ===')
