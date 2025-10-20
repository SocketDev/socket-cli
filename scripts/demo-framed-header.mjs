#!/usr/bin/env node
/**
 * Demo script to showcase the framed ASCII header animation.
 */

import { renderShimmerFrame } from '../src/utils/terminal/ascii-header.mts'

const THEMES = ['default', 'cyberpunk', 'forest', 'ocean', 'sunset']

/**
 * Cycle through all themes.
 */
async function cycleThemes() {
  console.log('Socket CLI Framed Header Demo')
  console.log('==============================\n')
  console.log('Cycling through all themes (5 seconds each)...\n')
  console.log('Press Ctrl+C to stop\n')
  await new Promise(resolve => setTimeout(resolve, 2000))

  for (const theme of THEMES) {
    await renderFramedHeaderWithDuration(theme, 5000)
    await new Promise(resolve => setTimeout(resolve, 500))
  }

  process.stdout.write('\x1B[2J\x1B[H')
  console.log('\nDemo complete!\n')
  process.exit(0)
}

/**
 * Render framed header for a specific duration.
 */
async function renderFramedHeaderWithDuration(theme, duration) {
  const startTime = Date.now()
  let frame = 0

  const renderFrame = () => {
    if (Date.now() - startTime >= duration) {
      return false
    }

    const logo = renderShimmerFrame(frame, theme)
    const width = 40
    const lines = logo.split('\n')
    const topBorder = `╭${'─'.repeat(width)}╮`
    const bottomBorder = `╰${'─'.repeat(width)}╯`
    const framedLines = lines.map(line => {
      const padding = ' '.repeat(Math.max(0, width - line.length))
      return `│ ${line}${padding} │`
    })
    const framedLogo = [topBorder, ...framedLines, bottomBorder].join('\n')

    process.stdout.write('\x1B[H\x1B[J')
    console.log(`\nTheme: ${theme} | Frame: ${frame}\n`)
    console.log(framedLogo)

    frame++
    return true
  }

  process.stdout.write('\x1B[?25l')

  return new Promise(resolve => {
    const interval = setInterval(() => {
      if (!renderFrame()) {
        clearInterval(interval)
        process.stdout.write('\x1B[?25h')
        resolve()
      }
    }, 1000 / 15)

    process.once('SIGINT', () => {
      clearInterval(interval)
      process.stdout.write('\x1B[?25h')
      process.exit(0)
    })
  })
}

// Run demo.
cycleThemes().catch(e => {
  console.error('Demo error:', e)
  process.exit(1)
})
