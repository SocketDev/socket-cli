/**
 * Capture raw TUI output to analyze rendering issues.
 */

import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'

console.log('Starting TUI output capture...\n')

const outputFile = '/tmp/tui-raw-output.txt'
const outputStream = await fs.open(outputFile, 'w')

// Start the demo.
const demo = spawn('node', ['scripts/load.mjs', 'demo-final-tui'], {
  stdio: ['pipe', 'pipe', 'inherit']
})

let frameCount = 0
const frames = []

demo.stdout.on('data', (data) => {
  frameCount++
  const str = data.toString()
  frames.push({
    number: frameCount,
    data: str,
    length: str.length,
    lines: str.split('\n').length
  })

  // Write to file.
  outputStream.write(`\n=== FRAME ${frameCount} ===\n`)
  outputStream.write(data)
})

// After 3 seconds, send Ctrl+N 5 times.
setTimeout(() => {
  console.log('Sending Ctrl+N x5...')
  for (let i = 0; i < 5; i++) {
    demo.stdin.write('\x0E')
  }
}, 3000)

// After 5 seconds, send Enter.
setTimeout(() => {
  console.log('Sending Enter...')
  demo.stdin.write('\r')
}, 5000)

// After 7 seconds, send Ctrl+N 5 times again.
setTimeout(() => {
  console.log('Sending Ctrl+N x5 again...')
  for (let i = 0; i < 5; i++) {
    demo.stdin.write('\x0E')
  }
}, 7000)

// After 9 seconds, send Enter and quit.
setTimeout(async () => {
  console.log('Sending Enter and quitting...')
  demo.stdin.write('\r')

  setTimeout(() => {
    demo.stdin.write('q')

    setTimeout(async () => {
      await outputStream.close()

      console.log(`\nCapture complete!`)
      console.log(`Frames captured: ${frameCount}`)
      console.log(`Output saved to: ${outputFile}`)
      console.log(`\nFrame summary:`)
      frames.slice(0, 5).forEach(f => {
        console.log(`  Frame ${f.number}: ${f.length} bytes, ${f.lines} lines`)
      })

      process.exit(0)
    }, 500)
  }, 1000)
}, 9000)
