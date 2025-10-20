#!/usr/bin/env node
/**
 * Test replaceAt with border characters.
 */

function visibleLength(str) {
  return str.replace(/\x1B\[[0-9;]*m/g, '').length
}

function replaceAt(str, visibleIndex, replacement) {
  if (visibleIndex < 0) return str

  // Find the byte index that corresponds to the visible index.
  let byteIndex = 0
  let visibleCount = 0
  let inAnsiCode = false

  for (let i = 0; i < str.length; i++) {
    if (str[i] === '\x1B') {
      inAnsiCode = true
    }

    if (!inAnsiCode) {
      if (visibleCount === visibleIndex) {
        byteIndex = i
        break
      }
      visibleCount++
    }

    if (inAnsiCode && str[i] === 'm') {
      inAnsiCode = false
    }
  }

  // If we didn't find enough visible chars, append at end.
  if (visibleCount < visibleIndex) {
    return str + ' '.repeat(visibleIndex - visibleCount) + replacement
  }

  // Find where to end the replacement (skip ANSI codes in the middle).
  let endByteIndex = byteIndex
  let replacementVisible = visibleLength(replacement)
  visibleCount = 0
  inAnsiCode = false

  for (let i = byteIndex; i < str.length && visibleCount < replacementVisible; i++) {
    if (str[i] === '\x1B') {
      inAnsiCode = true
    }

    if (!inAnsiCode) {
      visibleCount++
    }

    if (inAnsiCode && str[i] === 'm') {
      inAnsiCode = false
    }

    endByteIndex = i + 1
  }

  return str.slice(0, byteIndex) + replacement + str.slice(endByteIndex)
}

// Simulate the scenario.
const cols = 150
const contentX = 3 // Position where content starts (after left border + padding).
const contentWidth = cols - 6 // Total width minus outer borders and padding.

// Initial buffer line (simulating outer frame with ║).
const bufferLine = '║ ' + ' '.repeat(cols - 4) + ' ║'

// Output box line to insert (with │ borders and spacing).
const outputBoxLine = `│ ${' '.repeat(contentWidth - 4)} │`

console.log('Buffer line visible length:', visibleLength(bufferLine))
console.log('Output box line visible length:', visibleLength(outputBoxLine))
console.log('contentX:', contentX)
console.log('contentWidth:', contentWidth)
console.log('')

// Try the replace.
const result = replaceAt(bufferLine, contentX, outputBoxLine)

console.log('Original buffer:')
console.log(bufferLine)
console.log('Length:', visibleLength(bufferLine))
console.log('')

console.log('Output box line to insert:')
console.log(outputBoxLine)
console.log('Length:', visibleLength(outputBoxLine))
console.log('')

console.log('Result after replaceAt:')
console.log(result)
console.log('Length:', visibleLength(result))
console.log('')

// Check if we see double borders.
const resultVisible = result.replace(/\x1B\[[0-9;]*m/g, '')
const pipeCount = (resultVisible.match(/[│║]/g) || []).length
console.log('Pipe characters in result:', pipeCount, '(should be 4: 2 outer ║, 2 inner │)')

// Visual check - mark positions.
console.log('\nVisual check:')
console.log('Position:  0    5    10   15   20')
console.log('          |....|....|....|....|')
console.log(result.slice(0, 25))
