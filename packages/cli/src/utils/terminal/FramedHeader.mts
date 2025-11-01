/**
 * @fileoverview Framed ASCII header with terminal-native rendering.
 *
 * Provides a bordered container for the animated Socket CLI header using ANSI escape codes.
 */

import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { renderShimmerFrame } from './ascii-header.mts'

import type { HeaderTheme } from './ascii-header.mts'

const logger = getDefaultLogger()

export type FramedHeaderProps = {
  animate?: boolean | undefined
  fps?: number | undefined
  theme?: HeaderTheme | undefined
}

/**
 * Draw a border around the ASCII logo using box-drawing characters.
 */
function drawBorder(content: string, width: number): string {
  const lines = content.split('\n')
  const topBorder = `╭${'─'.repeat(width)}╮`
  const bottomBorder = `╰${'─'.repeat(width)}╯`
  const framedLines = lines.map(line => {
    const padding = ' '.repeat(Math.max(0, width - line.length))
    return `│ ${line}${padding} │`
  })

  return [topBorder, ...framedLines, bottomBorder].join('\n')
}

/**
 * Render framed ASCII header with animation.
 */
export async function renderFramedHeader(
  props?: FramedHeaderProps | undefined,
): Promise<void> {
  const { animate = true, fps = 15, theme = 'default' } = props || {}

  // Hide cursor.
  process.stdout.write('\x1B[?25l')

  let frame = 0
  const frameDelay = 1000 / fps

  const renderFrame = () => {
    const logo = renderShimmerFrame(frame, theme)
    const width = 40
    const framedLogo = drawBorder(logo, width)

    // Move cursor to home and clear from cursor down.
    process.stdout.write('\x1B[H\x1B[J')
    logger.log(`\nTheme: ${theme} | Frame: ${frame}\n`)
    logger.log(framedLogo)

    frame++
  }

  if (!animate) {
    renderFrame()
    process.stdout.write('\x1B[?25h')
    return
  }

  // Render frames in a loop.
  const interval = setInterval(renderFrame, frameDelay)

  // Handle cleanup on interrupt.
  process.once('SIGINT', () => {
    clearInterval(interval)
    process.stdout.write('\x1B[?25h')
    // eslint-disable-next-line n/no-process-exit
    process.exit(0)
  })

  // Keep process alive.
  await new Promise(() => {})
}
