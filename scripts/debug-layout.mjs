/**
 * Debug layout calculations to find the gap.
 */

const rows = 50

// Simulate initial state (collapsed).
console.log('=== COLLAPSED STATE ===')
const headerStartY = 2
const logoLines = 4
const outputBoxStartY = headerStartY + logoLines + 2
console.log(`outputBoxStartY: ${outputBoxStartY}`)

const textareaBottomY = rows - 3
const textareaHeight_collapsed = 1 + 2 // 1 line + 2 borders
const textareaTopY_collapsed = textareaBottomY - textareaHeight_collapsed + 1
console.log(`textareaTopY (collapsed): ${textareaTopY_collapsed}`)
console.log(`textareaBottomY: ${textareaBottomY}`)

const outputBoxHeight_collapsed = textareaTopY_collapsed - outputBoxStartY
console.log(`outputBoxHeight (collapsed): ${outputBoxHeight_collapsed}`)
console.log(
  `Output box occupies rows: ${outputBoxStartY} to ${outputBoxStartY + outputBoxHeight_collapsed - 1}`,
)
console.log(
  `Textarea occupies rows: ${textareaTopY_collapsed} to ${textareaBottomY}`,
)
console.log(
  `Gap between: ${outputBoxStartY + outputBoxHeight_collapsed - 1 + 1} to ${textareaTopY_collapsed - 1}`,
)

// Simulate expanded state.
console.log('\n=== EXPANDED STATE (10 input lines) ===')
const textareaHeight_expanded = 10 + 2 // 10 lines + 2 borders
const textareaTopY_expanded = textareaBottomY - textareaHeight_expanded + 1
console.log(`textareaTopY (expanded): ${textareaTopY_expanded}`)
console.log(`textareaBottomY: ${textareaBottomY}`)

const outputBoxHeight_expanded = textareaTopY_expanded - outputBoxStartY
console.log(`outputBoxHeight (expanded): ${outputBoxHeight_expanded}`)
console.log(
  `Output box occupies rows: ${outputBoxStartY} to ${outputBoxStartY + outputBoxHeight_expanded - 1}`,
)
console.log(
  `Textarea occupies rows: ${textareaTopY_expanded} to ${textareaBottomY}`,
)

const gapStart = outputBoxStartY + outputBoxHeight_expanded
const gapEnd = textareaTopY_expanded - 1
if (gapStart <= gapEnd) {
  console.log(
    `❌ GAP DETECTED: rows ${gapStart} to ${gapEnd} (${gapEnd - gapStart + 1} rows)`,
  )
} else {
  console.log('✅ No gap')
}

// Check boundary.
console.log('\nBoundary check:')
console.log(
  `  Last output box row: ${outputBoxStartY + outputBoxHeight_expanded - 1}`,
)
console.log(`  First textarea row: ${textareaTopY_expanded}`)
console.log(
  `  Should be adjacent: ${outputBoxStartY + outputBoxHeight_expanded - 1 + 1 === textareaTopY_expanded ? '✅' : '❌'}`,
)
