#!/usr/bin/env node
/**
 * Simple SIGINT test script.
 */

console.log('Testing SIGINT handling...')
console.log('Press Ctrl+C to exit')

let count = 0

process.on('SIGINT', () => {
  console.log('\nReceived SIGINT! Exiting...')
  process.exit(0)
})

setInterval(() => {
  console.log(`Count: ${count++}`)
}, 1000)
