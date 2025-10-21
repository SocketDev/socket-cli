/**
 * Test what happens to scroll during expansion when user manually scrolls.
 */

const rows = 50
const headerStartY = 2
const logoLines = 4
const outputBoxStartY = headerStartY + logoLines + 2

// Simulate state with MORE content (30 lines).
const state = {
  inputLines: ['> '],
  outputLines: Array(30)
    .fill(null)
    .map((_, i) => `Line ${i + 1}`),
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
  const visibleEnd = Math.min(
    state.scrollOffset + layout.outputBoxContentHeight,
    state.outputLines.length,
  )

  console.log(`\n=== ${label} ===`)
  console.log(`outputLines: ${state.outputLines.length}`)
  console.log(`scrollOffset: ${state.scrollOffset}`)
  console.log(`outputBoxContentHeight: ${layout.outputBoxContentHeight}`)
  console.log(
    `Visible lines: ${visibleStart}-${visibleEnd} of ${state.outputLines.length}`,
  )
  console.log(
    `First visible: "${state.outputLines[state.scrollOffset] || 'NONE'}"`,
  )
  console.log(
    `Last visible: "${state.outputLines[Math.min(state.scrollOffset + layout.outputBoxContentHeight - 1, state.outputLines.length - 1)] || 'NONE'}"`,
  )
}

// Initial state (collapsed, showing lines 1-35).
showState('INITIAL (collapsed, 30 lines fit)')

// Simulate pressing Ctrl+N 10 times (expand).
console.log('\n>>> User presses Ctrl+N 10 times...')
for (let i = 0; i < 10; i++) {
  state.inputLines.push('')
}
showState('AFTER EXPANDING (scroll NOT adjusted)')

console.log('\n⚠️  PROBLEM: Output box shrunk from 35 to 25 lines capacity.')
console.log(
  "⚠️  But scrollOffset is still 0, so we're still trying to show lines 1-25.",
)
console.log('⚠️  This is fine because all content fits.')
console.log('')
console.log("But what if scrollOffset was NOT 0? Let's test...")

// Reset and test with initial scroll.
state.inputLines = ['> ']
state.scrollOffset = 5 // User had scrolled down 5 lines.
showState('INITIAL with scroll=5 (showing lines 6-40)')

// Expand.
for (let i = 0; i < 10; i++) {
  state.inputLines.push('')
}
showState('AFTER EXPANDING (scroll=5, BUT box shrunk!)')

calculateLayout()
console.log(`\n⚠️  PROBLEM: Box capacity is now 25, but we're at scrollOffset=5`)
console.log('⚠️  Showing lines 6-30, which is fine... BUT wait...')
console.log('⚠️  The box shrinkage pushed lines 31-35 OUT OF VIEW')
console.log(`⚠️  User can't see them anymore!`)

// Collapse.
state.inputLines = ['> ']
state.outputLines.push('> submitted')
state.outputLines.push('')

// Apply collapse logic.
const newLayout = calculateLayout()
if (state.outputLines.length <= newLayout.outputBoxContentHeight) {
  state.scrollOffset = 0
} else {
  state.scrollOffset =
    state.outputLines.length - newLayout.outputBoxContentHeight
}

showState('AFTER COLLAPSING (scroll adjusted)')

console.log(`\n⚠️  NOW: scrollOffset reset to ${state.scrollOffset}`)
console.log('⚠️  Box expanded back to 35 lines capacity')
console.log(
  `⚠️  Showing lines ${state.scrollOffset + 1}-${Math.min(state.scrollOffset + newLayout.outputBoxContentHeight, state.outputLines.length)}`,
)
console.log(
  `⚠️  THE GAP: Lines 1-${state.scrollOffset} are NOT visible (scrolled off top)`,
)
