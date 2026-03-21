#!/usr/bin/env node
/**
 * @fileoverview Minimal test case to demonstrate iocraft layout bug.
 *
 * ISSUE: Layout properties (flex_direction, border_style, etc.) are not being
 * applied during rendering.
 *
 * Run: node scripts/test-iocraft-layout.mjs
 */

import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const iocraft = require('@socketaddon/iocraft')
const io = iocraft.default || iocraft

io.init()

console.log('Testing iocraft layout engine\n')
console.log('=' .repeat(60))

// Test 1: Column layout.
console.log('\n1. Column Layout Test')
console.log('-'.repeat(60))
const columnBox = io.view([
  io.text('Line 1'),
  io.text('Line 2'),
  io.text('Line 3'),
])
columnBox.flex_direction = 'column'

console.log('Expected: Lines stacked vertically')
console.log('Actual output:')
io.printComponent(columnBox)
console.log('\nComponent tree:', JSON.stringify(columnBox, null, 2))

// Test 2: Border rendering.
console.log('\n2. Border Test')
console.log('-'.repeat(60))
const borderBox = io.view([io.text('Content')])
borderBox.border_style = 'single'
borderBox.padding = 1

console.log('Expected: Box with single-line border around padded content')
console.log('Actual output:')
io.printComponent(borderBox)
console.log('\nComponent tree:', JSON.stringify(borderBox, null, 2))

// Test 3: Gap spacing.
console.log('\n3. Gap Test')
console.log('-'.repeat(60))
const gapBox = io.view([io.text('A'), io.text('B'), io.text('C')])
gapBox.flex_direction = 'column'
gapBox.gap = 1

console.log('Expected: Items stacked vertically with 1 line gap between them')
console.log('Actual output:')
io.printComponent(gapBox)

console.log('\n' + '='.repeat(60))
console.log('\nSUMMARY:')
console.log('- flex_direction: "column" → NOT WORKING (items render in row)')
console.log('- border_style: "single" → NOT WORKING (no border drawn)')
console.log('- gap → PARTIALLY WORKING (adds space in row layout)')
console.log('\nThe layout engine does not appear to be processing flexbox properties.')
