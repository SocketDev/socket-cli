/**
 * Test script to simulate expand/collapse and debug the gap issue.
 */

// Simulate the calculations.
const rows = 50 // Example terminal height.

// Initial state (collapsed).
let inputLines = ['> ']

console.log('=== INITIAL STATE (COLLAPSED) ===')
let textareaHeight = inputLines.length + 2
const textareaBottomY = rows - 3
let textareaTopY = textareaBottomY - textareaHeight + 1
const headerStartY = 2
const logoLines = 4
const outputBoxStartY = headerStartY + logoLines + 2
let outputBoxHeight = textareaTopY - outputBoxStartY
let outputBoxEndY = outputBoxStartY + outputBoxHeight

console.log(`inputLines: ${inputLines.length}`)
console.log(`textareaHeight: ${textareaHeight}`)
console.log(`textareaTopY: ${textareaTopY}`)
console.log(`outputBoxStartY: ${outputBoxStartY}`)
console.log(`outputBoxHeight: ${outputBoxHeight}`)
console.log(`outputBoxEndY: ${outputBoxEndY}`)
console.log(`GAP: ${textareaTopY - outputBoxEndY}`)

// Expand (press Ctrl+N 10 times).
console.log('\n=== AFTER EXPANDING (10 LINES) ===')
inputLines = Array(11).fill('').map((_, i) => i === 0 ? '> ' : '')

textareaHeight = inputLines.length + 2
textareaTopY = textareaBottomY - textareaHeight + 1
outputBoxHeight = textareaTopY - outputBoxStartY
outputBoxEndY = outputBoxStartY + outputBoxHeight

console.log(`inputLines: ${inputLines.length}`)
console.log(`textareaHeight: ${textareaHeight}`)
console.log(`textareaTopY: ${textareaTopY}`)
console.log(`outputBoxHeight: ${outputBoxHeight}`)
console.log(`outputBoxEndY: ${outputBoxEndY}`)
console.log(`GAP: ${textareaTopY - outputBoxEndY}`)

// Collapse (press Enter).
console.log('\n=== AFTER COLLAPSING (BACK TO 1 LINE) ===')
inputLines = ['> ']

textareaHeight = inputLines.length + 2
textareaTopY = textareaBottomY - textareaHeight + 1
outputBoxHeight = textareaTopY - outputBoxStartY
outputBoxEndY = outputBoxStartY + outputBoxHeight

console.log(`inputLines: ${inputLines.length}`)
console.log(`textareaHeight: ${textareaHeight}`)
console.log(`textareaTopY: ${textareaTopY}`)
console.log(`outputBoxHeight: ${outputBoxHeight}`)
console.log(`outputBoxEndY: ${outputBoxEndY}`)
console.log(`GAP: ${textareaTopY - outputBoxEndY}`)
