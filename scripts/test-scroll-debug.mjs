/**
 * Test script to simulate the exact scroll behavior during expand/collapse.
 */

const rows = 50
const headerStartY = 2
const logoLines = 4
const outputBoxStartY = headerStartY + logoLines + 2

// Simulate state.
const state = {
  inputLines: ['> '],
  outputLines: [
    'Socket CLI v1.0.80',
    '',
    'Welcome to Socket CLI!',
    'Type commands below...',
    '',
  ],
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
  console.log(`\n=== ${label} ===`)
  console.log(`inputLines: ${state.inputLines.length}`)
  console.log(`outputLines: ${state.outputLines.length}`)
  console.log(`scrollOffset: ${state.scrollOffset}`)
  console.log(`textareaTopY: ${layout.textareaTopY}`)
  console.log(`outputBoxHeight: ${layout.outputBoxHeight}`)
  console.log(`outputBoxContentHeight: ${layout.outputBoxContentHeight}`)
  console.log(`visibleLines: ${Math.min(layout.outputBoxContentHeight, state.outputLines.length - state.scrollOffset)}`)
  console.log(`emptySpaceInBox: ${layout.outputBoxContentHeight - Math.min(layout.outputBoxContentHeight, state.outputLines.length - state.scrollOffset)}`)
}

// Initial state.
showState('INITIAL (collapsed)')

// Simulate pressing Ctrl+N 10 times (expand).
console.log('\n>>> User presses Ctrl+N 10 times...')
for (let i = 0; i < 10; i++) {
  state.inputLines.push('')
}
showState('AFTER EXPANDING')

// Simulate pressing Enter (submit and collapse).
console.log('\n>>> User presses Enter (submit)...')
state.outputLines.push('> ' + state.inputLines.join('\\n'))
state.outputLines.push('')

// Reset textarea.
state.inputLines = ['> ']

// Calculate new output box size after collapse.
const layout = calculateLayout()

// Apply the scroll adjustment logic from the code.
if (state.outputLines.length <= layout.outputBoxContentHeight) {
  state.scrollOffset = 0
  console.log('Setting scrollOffset = 0 (content fits)')
} else {
  state.scrollOffset = state.outputLines.length - layout.outputBoxContentHeight
  console.log(`Setting scrollOffset = ${state.scrollOffset} (content too long, show bottom)`)
}

showState('AFTER COLLAPSING')
