/**
 * Demo script to showcase the ASCII header with shimmer animation using built files.
 */

// eslint-disable-next-line import-x/no-unresolved, n/no-missing-import
import { renderShimmerFrame } from '../dist/utils/terminal/ascii-header.mjs'

const THEMES = ['default', 'cyberpunk', 'forest', 'ocean', 'sunset']
const FPS = 15
const FRAME_DELAY = 1000 / FPS

/**
 * Animate the header with shimmer effect.
 */
async function animateHeader(theme = 'default', duration = 5000) {
  const startTime = Date.now()
  let frame = 0

  console.log(`\nAnimating with theme: ${theme}\n`)

  while (Date.now() - startTime < duration) {
    // Move cursor to start position.
    process.stdout.write('\x1B[2J\x1B[H')

    console.log(`Theme: ${theme} | Frame: ${frame}\n`)
    console.log(renderShimmerFrame(frame, theme))
    console.log('\n')

    frame++
    await new Promise(resolve => setTimeout(resolve, FRAME_DELAY))
  }
}

/**
 * Cycle through all themes.
 */
async function cycleThemes() {
  console.log('Socket CLI Header Shimmer Demo')
  console.log('===============================\n')
  console.log('Cycling through all themes (3 seconds each)...\n')
  console.log('Press Ctrl+C to stop\n')
  await new Promise(resolve => setTimeout(resolve, 2000))

  for (const theme of THEMES) {
    await animateHeader(theme, 3000)
    await new Promise(resolve => setTimeout(resolve, 500))
  }

  process.stdout.write('\x1B[2J\x1B[H')
  console.log('\n✅ Demo complete!\n')
  console.log('The ASCII header now uses socket-registry\'s applyShimmer')
  console.log('for smooth, themeable gradient animations.\n')
  console.log('Available themes:')
  for (const theme of THEMES) {
    console.log(`  - ${theme}`)
  }
  console.log()
}

// Run demo.
cycleThemes().catch(e => {
  console.error('Demo error:', e)
  process.exit(1)
})
