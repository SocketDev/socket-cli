#!/usr/bin/env node
/**
 * Test the exact sequence of what gets rendered when expanding/collapsing.
 */

// Simulate terminal size.
const rows = 50
const cols = 120

// Simulate drawing a buffer line by line.
function createBuffer() {
  const buffer = Array(rows).fill(null).map(() => ' '.repeat(cols))

  // Add borders.
  buffer[0] = `╔${'═'.repeat(cols - 2)}╗`
  buffer[rows - 1] = `╚${'═'.repeat(cols - 2)}╝`
  for (let i = 1; i < rows - 1; i++) {
    buffer[i] = `║${' '.repeat(cols - 2)}║`
  }

  return buffer
}

// Simulate the actual problem: when we render a collapsed state,
// there might be leftover content BELOW the buffer.
function testScenario() {
  console.log('=== SCENARIO: Expand then Collapse ===\n')

  // Frame 1: Collapsed (1 line textarea).
  console.log('Frame 1: COLLAPSED (textarea at row 45, height 3)')
  const textareaBottomY = 47
  const textareaTopY_collapsed = 45
  const outputBoxEndY_collapsed = 45
  console.log(`  Output box: rows 8-${outputBoxEndY_collapsed}`)
  console.log(`  Textarea: rows ${textareaTopY_collapsed}-${textareaBottomY}`)
  console.log(`  Buffer rows: 0-${rows - 1}`)
  console.log('')

  // Frame 2: Expanded (11 line textarea).
  console.log('Frame 2: EXPANDED (textarea at row 35, height 13)')
  const textareaTopY_expanded = 35
  const outputBoxEndY_expanded = 35
  console.log(`  Output box: rows 8-${outputBoxEndY_expanded}`)
  console.log(`  Textarea: rows ${textareaTopY_expanded}-${textareaBottomY}`)
  console.log(`  Buffer rows: 0-${rows - 1}`)
  console.log('')

  // Frame 3: Collapsed again.
  console.log('Frame 3: COLLAPSED AGAIN (textarea back to row 45)')
  console.log(`  Output box: rows 8-${outputBoxEndY_collapsed}`)
  console.log(`  Textarea: rows ${textareaTopY_collapsed}-${textareaBottomY}`)
  console.log(`  Buffer rows: 0-${rows - 1}`)
  console.log('')

  console.log('🔴 THE PROBLEM:')
  console.log(`  In Frame 2 (expanded), the textarea was at rows 35-47.`)
  console.log(`  In Frame 3 (collapsed), the textarea is at rows 45-47.`)
  console.log(`  Rows 35-44 were filled with textarea content in Frame 2.`)
  console.log(`  In Frame 3, rows 35-44 are now output box content.`)
  console.log(`  BUT: If we don't clear, the old textarea content from Frame 2`)
  console.log(`  remains visible BELOW the new buffer!`)
  console.log('')

  console.log('💡 WHY \\x1B[K does not help:')
  console.log(`  \\x1B[K clears to END OF LINE, not beyond the buffer.`)
  console.log(`  The buffer is rows 0-${rows - 1}, but the terminal still has`)
  console.log(`  content from previous frames BELOW where our cursor stops.`)
  console.log('')

  console.log('✅ THE FIX:')
  console.log(`  Use \\x1B[J (clear from cursor to end of screen) after the buffer.`)
  console.log(`  OR use \\x1B[2J (clear entire screen) when layout changes.`)
  console.log(`  We're already doing \\x1B[2J when needsClear=true.`)
  console.log('')

  console.log('🔍 WHY IT STILL FAILS:')
  console.log(`  When we call renderFrame() immediately after setting needsClear,`)
  console.log(`  the frame counter increments, so the shimmer animation changes.`)
  console.log(`  But more importantly: we're rendering TWICE per keypress:`)
  console.log(`  1. The immediate renderFrame() call`)
  console.log(`  2. The normal animation loop (66ms later)`)
  console.log(`  Between these two renders, if user types fast, artifacts persist.`)
  console.log('')

  console.log('🎯 REAL FIX:')
  console.log(`  After rendering the buffer, add \\x1B[J to clear everything below.`)
  console.log(`  This ensures no leftover content from previous frames, WITHOUT`)
  console.log(`  needing to clear the entire screen (which causes flicker).`)
}

testScenario()
