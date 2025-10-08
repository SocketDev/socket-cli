/**
 * @fileoverview Theme transitions with animations for Socket CLI.
 */

import { stdout } from 'node:process'

import colors from 'yoctocolors-cjs'

import { getContextTheme, getTheme, getThemeByName, getTransitionConfig, setTheme } from './theme.mts'

import type { Theme } from './theme.mts'

/**
 * Current context stack
 */
const contextStack: string[] = []

/**
 * Animation frame duration in milliseconds
 */
const FRAME_DURATION = 50


/**
 * Create transition animation frames
 */
function* createTransitionFrames(
  fromTheme: Theme,
  toTheme: Theme,
  message: string
): Generator<string, void, unknown> {
  const config = getTransitionConfig()
  const duration = config.duration || 500
  const steps = Math.floor(duration / FRAME_DURATION)

  for (let i = 0; i <= steps; i++) {
    const progress = i / steps

    // Create a gradual color shift effect
    let output = ''

    // Apply different effects based on progress
    if (progress < 0.2) {
      // Fade out phase
      output = colors.dim(fromTheme.primary(message))
    } else if (progress < 0.4) {
      // Glitch effect
      const glitched = message.split('').map((char) => {
        if (Math.random() < 0.3) {
          return colors.gray(char)
        }
        return fromTheme.primary(char)
      }).join('')
      output = glitched
    } else if (progress < 0.6) {
      // Color mixing phase
      output = colors.strikethrough(fromTheme.primary(message))
    } else if (progress < 0.8) {
      // Glitch into new color
      const glitched = message.split('').map((char) => {
        if (Math.random() < 0.3) {
          return toTheme.primary(char)
        }
        return colors.gray(char)
      }).join('')
      output = glitched
    } else {
      // Fade in phase
      output = toTheme.primary(message)
    }

    yield output
  }
}

/**
 * Animate theme transition
 */
async function animateTransition(
  fromTheme: Theme,
  toTheme: Theme,
  message: string = '⚡ Switching context...'
): Promise<void> {
  const frames = createTransitionFrames(fromTheme, toTheme, message)

  // Clear line
  stdout.write('\r\x1b[K')

  for (const frame of frames) {
    stdout.write(`\r${frame}`)
    // eslint-disable-next-line no-await-in-loop
    await new Promise(resolve => setTimeout(resolve, FRAME_DURATION))
  }

  // Clear the transition message
  stdout.write('\r\x1b[K')
}

/**
 * Push a new context and transition theme
 */
export async function pushContext(
  context: 'python' | 'firewall' | 'coana',
  animate: boolean = true
): Promise<void> {
  const currentTheme = getTheme()
  const targetThemeName = getContextTheme(context)
  const config = getTransitionConfig()

  if (!targetThemeName) {
    return
  }

  contextStack.push(context)

  if (animate && config.enabled) {
    const targetTheme = getThemeByName(targetThemeName)
    if (targetTheme) {
      const animation = config.animations[context]
      const message = animation?.enterMessage ||
        (context === 'python' ? '🐍 Entering Python context...' : '🔥 Activating Socket Firewall...')

      await animateTransition(currentTheme, targetTheme, message)
    }
  }

  setTheme(targetThemeName)
}

/**
 * Pop context and restore previous theme
 */
export async function popContext(animate: boolean = true): Promise<void> {
  if (contextStack.length === 0) {
    return
  }

  const currentTheme = getTheme()
  const poppedContext = contextStack.pop()
  const config = getTransitionConfig()

  const previousContext = contextStack.length > 0
    ? contextStack[contextStack.length - 1] as 'python' | 'firewall' | 'coana'
    : 'default'

  const targetThemeName = getContextTheme(previousContext)

  if (animate && config.enabled) {
    const targetTheme = getThemeByName(targetThemeName)
    if (targetTheme) {
      const animation = poppedContext ? config.animations[poppedContext] : undefined
      const message = animation?.exitMessage || '↩️  Returning to Socket CLI...'
      await animateTransition(currentTheme, targetTheme, message)
    }
  }

  setTheme(targetThemeName)
}

/**
 * Context-aware command wrapper
 */
export async function withContext<T>(
  context: 'python' | 'firewall' | 'coana',
  callback: () => Promise<T>,
  animate: boolean = true
): Promise<T> {
  await pushContext(context, animate)

  try {
    return await callback()
  } finally {
    await popContext(animate)
  }
}


/**
 * Color wave animation for special events
 */
export async function colorWave(
  text: string,
  duration: number = 2000
): Promise<void> {
  const waveColors = [
    colors.red,
    colors.magenta,
    colors.blue,
    colors.cyan,
    colors.green,
    colors.yellow,
  ]

  const steps = Math.floor(duration / FRAME_DURATION)

  for (let step = 0; step < steps; step++) {
    const chars = text.split('').map((char, i) => {
      const colorIndex = (i + step) % waveColors.length
      return waveColors[colorIndex]!(char)
    }).join('')

    stdout.write(`\r${chars}`)
    // eslint-disable-next-line no-await-in-loop
    await new Promise(resolve => setTimeout(resolve, FRAME_DURATION))
  }

  stdout.write('\r\x1b[K')
}

/**
 * Pulse animation for alerts
 */
export async function pulse(
  text: string,
  color: (text: string) => string,
  pulses: number = 3
): Promise<void> {
  for (let i = 0; i < pulses; i++) {
    // Bright
    stdout.write(`\r${color(text)}`)
    // eslint-disable-next-line no-await-in-loop
    await new Promise(resolve => setTimeout(resolve, 200))

    // Dim
    stdout.write(`\r${colors.dim(color(text))}`)
    // eslint-disable-next-line no-await-in-loop
    await new Promise(resolve => setTimeout(resolve, 200))
  }

  // Final bright state
  stdout.write(`\r${color(text)}\n`)
}