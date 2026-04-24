/**
 * @fileoverview Simple test to verify iocraft integration.
 *
 * Run with: node src/utils/terminal/iocraft-test.mts
 */

import { Box, Text, print, renderToString } from './iocraft.mts'

// Test 1: Simple text rendering.
console.log('=== Test 1: Simple Text ===')
const simpleText = Text({ children: 'Hello from iocraft!' })
console.log(renderToString(simpleText))

// Test 2: Styled text.
console.log('\n=== Test 2: Styled Text ===')
const styledText = Text({
  bold: true,
  children: 'Bold and Blue Text',
  color: 'blue',
})
print(styledText)

// Test 3: Box with text.
console.log('\n=== Test 3: Box with Text ===')
const boxWithText = Box({
  borderColor: 'green',
  borderStyle: 'single',
  children: [Text({ children: 'Text inside a box' })],
  paddingX: 2,
  paddingY: 1,
})
print(boxWithText)

// Test 4: Nested boxes.
console.log('\n=== Test 4: Nested Boxes ===')
const nestedBoxes = Box({
  borderColor: 'cyan',
  borderStyle: 'rounded',
  children: [
    Text({ bold: true, children: 'Outer Box', color: 'cyan' }),
    Box({
      borderColor: 'yellow',
      borderStyle: 'single',
      children: [Text({ children: 'Inner Box', color: 'yellow' })],
      marginTop: 1,
      paddingX: 1,
    }),
  ],
  flexDirection: 'column',
  paddingX: 2,
  paddingY: 1,
})
print(nestedBoxes)

// Test 5: Flexbox layout.
console.log('\n=== Test 5: Flexbox Row Layout ===')
const rowLayout = Box({
  borderColor: 'magenta',
  borderStyle: 'double',
  children: [
    Box({
      children: [Text({ children: 'Left', color: 'red' })],
      paddingX: 2,
    }),
    Box({
      children: [Text({ children: 'Center', color: 'green' })],
      paddingX: 2,
    }),
    Box({
      children: [Text({ children: 'Right', color: 'blue' })],
      paddingX: 2,
    }),
  ],
  flexDirection: 'row',
  gap: 1,
  paddingY: 1,
})
print(rowLayout)

console.log('\n=== All Tests Complete ===')
