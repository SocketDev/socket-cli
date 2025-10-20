#!/usr/bin/env node
/**
 * Demo script to showcase the ASCII header with shimmer animation.
 * Uses socket-registry's applyShimmer for smooth gradient effects.
 */

import { renderShimmerFrame } from '../src/utils/terminal/ascii-header.mts'

const THEMES = ['default', 'cyberpunk', 'forest', 'ocean', 'sunset']
const FPS = 15
const FRAME_DELAY = 1000 / FPS

/**
 * Clear screen and move cursor to top.
 */
function clearScreen() {
  process.stdout.write('\x1Bc')
}

/**
 * Animate the header with shimmer effect.
 */
async function animateHeader(theme = 'default', duration = 5000) {
  const startTime = Date.now()
  let frame = 0

  // Hide cursor during animation.
  process.stdout.write('\x1B[?25l')

  console.log(`\nAnimating with theme: ${theme}\n`)
  console.log('Press Ctrl+C to stop\n')

  while (Date.now() - startTime < duration) {
    // Move cursor to home and clear from cursor down.
    process.stdout.write('\x1B[H\x1B[J')

    console.log(`Theme: ${theme} | Frame: ${frame}\n`)
    console.log(renderShimmerFrame(frame, theme))

    frame++
    await new Promise(resolve => setTimeout(resolve, FRAME_DELAY))
  }

  // Show cursor again.
  process.stdout.write('\x1B[?25h')
}

/**
 * Cycle through all themes.
 */
async function cycleThemes() {
  console.log('Socket CLI Header Shimmer Demo')
  console.log('===============================\n')
  console.log('Cycling through all themes...\n')

  for (const theme of THEMES) {
    await animateHeader(theme, 3000)
    await new Promise(resolve => setTimeout(resolve, 500))
  }

  clearScreen()
  console.log('\n✓ Demo complete!\n')
  console.log('The ASCII header now uses socket-registry\'s applyShimmer')
  console.log('for smooth, themeable gradient animations.\n')
  process.exit(0)
}

// Run demo.
cycleThemes().catch(e => {
  console.error('Demo error:', e)
  process.exit(1)
})
