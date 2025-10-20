#!/usr/bin/env node
/**
 * Automated test that simulates user interaction with the TUI.
 * This will help identify the "jumping garbling" issue.
 */

import { spawn } from 'node:child_process'

console.log('=== AUTOMATED TUI INTERACTION TEST ===\n')
console.log('This will:')
console.log('1. Start the TUI demo')
console.log('2. Wait 2 seconds for initialization')
console.log('3. Send Ctrl+N 5 times (expand textarea)')
console.log('4. Wait 1 second')
console.log('5. Send Enter (collapse textarea)')
console.log('6. Wait 1 second')
console.log('7. Repeat the cycle once more')
console.log('8. Send Ctrl+C to exit\n')
console.log('Observing for garbling artifacts...\n')
console.log('---\n')

// Spawn the TUI demo.
const child = spawn('node', ['/Users/jdalton/projects/socket-cli/scripts/demo-final-tui.mjs'], {
  stdio: ['pipe', 'inherit', 'inherit']
})

// Helper to send keys.
function sendKey(key, delay = 100) {
  return new Promise(resolve => {
    setTimeout(() => {
      child.stdin.write(key)
      resolve()
    }, delay)
  })
}

// Run the test sequence.
async function runTest() {
  // Wait for initialization.
  await new Promise(resolve => setTimeout(resolve, 2000))
  console.log('[TEST] Initialization complete\n')

  // Cycle 1: Expand.
  console.log('[TEST] Cycle 1: Expanding textarea (Ctrl+N x5)...')
  for (let i = 0; i < 5; i++) {
    await sendKey('\x0E', 200) // Ctrl+N.
    console.log(`[TEST]   Sent Ctrl+N (${i + 1}/5)`)
  }
  await new Promise(resolve => setTimeout(resolve, 1000))

  // Cycle 1: Collapse.
  console.log('[TEST] Cycle 1: Collapsing textarea (Enter)...')
  await sendKey('\r', 500) // Enter.
  console.log('[TEST]   Sent Enter')
  await new Promise(resolve => setTimeout(resolve, 1000))

  // Cycle 2: Expand.
  console.log('[TEST] Cycle 2: Expanding textarea (Ctrl+N x5)...')
  for (let i = 0; i < 5; i++) {
    await sendKey('\x0E', 200) // Ctrl+N.
    console.log(`[TEST]   Sent Ctrl+N (${i + 1}/5)`)
  }
  await new Promise(resolve => setTimeout(resolve, 1000))

  // Cycle 2: Collapse.
  console.log('[TEST] Cycle 2: Collapsing textarea (Enter)...')
  await sendKey('\r', 500) // Enter.
  console.log('[TEST]   Sent Enter')
  await new Promise(resolve => setTimeout(resolve, 1000))

  // Exit.
  console.log('[TEST] Exiting (Ctrl+C)...')
  await sendKey('\x03', 500) // Ctrl+C.
}

runTest().catch(console.error)

child.on('exit', (code) => {
  console.log(`\n[TEST] Demo exited with code ${code}`)
  console.log('\n=== TEST COMPLETE ===')
})
