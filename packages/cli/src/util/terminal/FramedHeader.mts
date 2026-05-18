/* oxlint-disable-next-line socket/no-file-scope-oxlint-disable -- legitimate file-scope: domain-grouped layout or test fixture; per-call would produce many redundant disables. */
/* oxlint-disable socket/no-logger-newline-literal -- CLI output formatting: multi-line user-facing messages where embedded \n produces the intended layout. Splitting into logger.log("") + logger.log(...) pairs is the canonical rewrite but doesnt preserve the visual flow for these specific outputs. */
/**
 * @file Framed ASCII header with terminal-native rendering. Provides a bordered
 *   container for the animated Socket CLI header using ANSI escape codes.
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
export function drawBorder(content: string, width: number): string {
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

  // Hide cursor — raw ANSI escape, must hit stdout directly.
  process.stdout.write('\x1B[?25l') // socket-hook: allow logger

  let frame = 0
  const frameDelay = 1000 / fps

  const renderFrame = () => {
    const logo = renderShimmerFrame(frame, theme)
    const width = 40
    const framedLogo = drawBorder(logo, width)

    // Move cursor home + clear from cursor down — raw ANSI, direct stdout.
    process.stdout.write('\x1B[H\x1B[J') // socket-hook: allow logger
    logger.log(`\nTheme: ${theme} | Frame: ${frame}\n`)
    logger.log(framedLogo)

    frame++
  }

  if (!animate) {
    renderFrame()
    // Restore cursor — raw ANSI, direct stdout.
    process.stdout.write('\x1B[?25h') // socket-hook: allow logger
    return
  }

  // Render frames in a loop.
  const interval = setInterval(renderFrame, frameDelay)

  const cleanup = () => {
    clearInterval(interval)
    // Restore cursor — raw ANSI, direct stdout.
    process.stdout.write('\x1B[?25h') // socket-hook: allow logger
  }

  // Handle cleanup on interrupt.
  process.once('SIGINT', () => {
    cleanup()
    // eslint-disable-next-line n/no-process-exit
    process.exit(0)
  })

  // Maximum animation duration to prevent runaway intervals.
  const MAX_ANIMATION_TIME = 30_000 // 30 seconds
  const timeoutId = setTimeout(() => {
    cleanup()
  }, MAX_ANIMATION_TIME)

  // Keep process alive until interrupted or process exits.
  await new Promise<void>(resolve => {
    process.once('SIGTERM', () => {
      clearTimeout(timeoutId)
      cleanup()
      resolve()
    })
    process.once('beforeExit', () => {
      clearTimeout(timeoutId)
      cleanup()
      resolve()
    })
  })
}
