#!/usr/bin/env node
/* oxlint-disable-next-line socket/no-file-scope-oxlint-disable -- legitimate file-scope: domain-grouped layout or test fixture; per-call would produce many redundant disables. */
/* oxlint-disable socket/no-logger-newline-literal -- CLI output formatting: multi-line user-facing messages where embedded \n produces the intended layout. Splitting into logger.log("") + logger.log(...) pairs is the canonical rewrite but doesnt preserve the visual flow for these specific outputs. */
/**
 * @file Minimal test case to demonstrate iocraft layout bug. ISSUE: Layout
 *   properties (flex_direction, border_style, etc.) are not being applied
 *   during rendering. Run: node scripts/test-iocraft-layout.mts.
 */

import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const iocraft = require('@socketaddon/iocraft')
const io = iocraft.default || iocraft

io.init()

logger.log('Testing iocraft layout engine')
logger.log('')
logger.log('='.repeat(60))

// Test 1: Column layout.
logger.log('')
logger.log('1. Column Layout Test')
logger.log('-'.repeat(60))
const columnBox = io.view([
  io.text('Line 1'),
  io.text('Line 2'),
  io.text('Line 3'),
])
columnBox.flex_direction = 'column'

logger.log('Expected: Lines stacked vertically')
logger.log('Actual output:')
io.printComponent(columnBox)
logger.log('\nComponent tree:', JSON.stringify(columnBox, null, 2))

// Test 2: Border rendering.
logger.log('')
logger.log('2. Border Test')
logger.log('-'.repeat(60))
const borderBox = io.view([io.text('Content')])
borderBox.border_style = 'single'
borderBox.padding = 1

logger.log('Expected: Box with single-line border around padded content')
logger.log('Actual output:')
io.printComponent(borderBox)
logger.log('\nComponent tree:', JSON.stringify(borderBox, null, 2))

// Test 3: Gap spacing.
logger.log('')
logger.log('3. Gap Test')
logger.log('-'.repeat(60))
const gapBox = io.view([io.text('A'), io.text('B'), io.text('C')])
gapBox.flex_direction = 'column'
gapBox.gap = 1

logger.log('Expected: Items stacked vertically with 1 line gap between them')
logger.log('Actual output:')
io.printComponent(gapBox)

logger.log('\n' + '='.repeat(60))
logger.log('')
logger.log('SUMMARY:')
logger.log('- flex_direction: "column" → NOT WORKING (items render in row)')
logger.log('- border_style: "single" → NOT WORKING (no border drawn)')
logger.log('- gap → PARTIALLY WORKING (adds space in row layout)')
logger.log('')
logger.log(
  'The layout engine does not appear to be processing flexbox properties.',
)
