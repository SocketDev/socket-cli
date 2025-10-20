#!/usr/bin/env node
/**
 * Test what happens when content overflows after collapse.
 */

const rows = 50
const headerStartY = 2
const logoLines = 4
const outputBoxStartY = headerStartY + logoLines + 2

// Start with 40 lines of content (more than will fit).
const state = {
  inputLines: ['> '],
  outputLines: Array(40).fill(null).map((_, i) => `Line ${i + 1}`),
  scrollOffset: 0,
}

function calculateLayout() {
  const textareaHeight = state.inputLines.length + 2
  const textareaBottomY = rows - 3
  const textareaTopY = textareaBottomY - textareaHeight + 1
  const outputBoxHeight = textareaTopY - outputBoxStartY
  const outputBoxContentHeight = outputBoxHeight - 2

  return {
    textareaHeight,
    textareaTopY,
    outputBoxHeight,
    outputBoxContentHeight,
  }
}

function showState(label) {
  const layout = calculateLayout()
  const visibleStart = state.scrollOffset + 1
  const visibleEnd = Math.min(state.scrollOffset + layout.outputBoxContentHeight, state.outputLines.length)

  console.log(`\n=== ${label} ===`)
  console.log(`outputLines: ${state.outputLines.length}`)
  console.log(`scrollOffset: ${state.scrollOffset}`)
  console.log(`outputBoxContentHeight: ${layout.outputBoxContentHeight}`)
  console.log(`Visible: lines ${visibleStart}-${visibleEnd} of ${state.outputLines.length}`)
  console.log(`Invisible at top: ${state.scrollOffset} lines`)
  console.log(`Invisible at bottom: ${Math.max(0, state.outputLines.length - visibleEnd)} lines`)
}

// Initial (40 lines, box shows 35).
showState('INITIAL (40 lines, showing first 35)')

// Expand.
console.log('\n>>> User expands textarea (Ctrl+N x10)...')
for (let i = 0; i < 10; i++) {
  state.inputLines.push('')
}
showState('AFTER EXPANDING (box shrunk to 25 capacity)')

console.log('\n⚠️  Lines 26-40 are now hidden! They got pushed out.')

// Collapse and submit.
console.log('\n>>> User collapses (Enter)...')
state.inputLines = ['> ']
state.outputLines.push('> submitted text')
state.outputLines.push('')

// Apply collapse scroll logic.
const layout = calculateLayout()
if (state.outputLines.length <= layout.outputBoxContentHeight) {
  console.log('Setting scrollOffset = 0 (content fits)')
  state.scrollOffset = 0
} else {
  state.scrollOffset = state.outputLines.length - layout.outputBoxContentHeight
  console.log(`Setting scrollOffset = ${state.scrollOffset} (showing bottom ${layout.outputBoxContentHeight} lines)`)
}

showState('AFTER COLLAPSING')

console.log(`\n🔴 THE BUG: Lines 1-${state.scrollOffset} are scrolled OFF TOP!`)
console.log(`🔴 User sees lines ${state.scrollOffset + 1}-${state.outputLines.length} at the BOTTOM of the box.`)
console.log(`🔴 There's EMPTY SPACE at the top of the box where lines 1-${state.scrollOffset} should be!`)
console.log(`\n💡 FIX: Should set scrollOffset = 0 to show content from the TOP, not the BOTTOM!`)
