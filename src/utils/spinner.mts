/** @fileoverview Lightweight spinner utility for coordinating CLI operations. */

import process from 'node:process'
import { clearInterval, setInterval } from 'node:timers'

import colors from 'yoctocolors-cjs'

import { logger } from '@socketsecurity/registry/lib/logger'

import { isDebugNs } from './debug.mts'

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const SPINNER_INTERVAL = 80

type SpinnerState = {
  frame: number
  interval: NodeJS.Timeout | undefined
  isSpinning: boolean
  message: string
  paused: boolean
}

const spinnerStack: SpinnerState[] = []

/**
 * Get current active spinner or undefined.
 */
function getCurrentSpinner(): SpinnerState | undefined {
  return spinnerStack[spinnerStack.length - 1]
}

/**
 * Render spinner frame to stderr.
 */
function renderSpinner(state: SpinnerState): void {
  if (!process.stderr.isTTY || state.paused) {
    return
  }

  const frame = SPINNER_FRAMES[state.frame % SPINNER_FRAMES.length]
  const text = `${colors.cyan(frame ?? '')} ${state.message}`

  // Clear line and write spinner.
  process.stderr.write(`\r\x1b[K${text}`)
}

/**
 * Clear current spinner line.
 */
function clearSpinnerLine(): void {
  if (process.stderr.isTTY) {
    process.stderr.write('\r\x1b[K')
  }
}

/**
 * Start a new spinner with given message.
 * Returns a function to stop the spinner.
 *
 * @throws {Error} If DEBUG is enabled (spinners disabled in debug mode).
 */
export function startSpinner(message: string): () => void {
  // Disable spinners in debug mode to avoid interfering with debug output.
  if (isDebugNs('error') || isDebugNs('stdio') || !process.stderr.isTTY) {
    // Return no-op stop function.
    return () => {}
  }

  const state: SpinnerState = {
    frame: 0,
    interval: undefined,
    isSpinning: true,
    message,
    paused: false,
  }

  // Pause parent spinner if exists.
  const parent = getCurrentSpinner()
  if (parent) {
    parent.paused = true
    clearSpinnerLine()
  }

  spinnerStack.push(state)

  // Start animation.
  state.interval = setInterval(() => {
    if (!state.paused) {
      state.frame++
      renderSpinner(state)
    }
  }, SPINNER_INTERVAL)

  // Initial render.
  renderSpinner(state)

  // Return stop function.
  return () => stopSpinner(state)
}

/**
 * Stop a specific spinner.
 */
function stopSpinner(state: SpinnerState): void {
  if (!state.isSpinning) {
    return
  }

  state.isSpinning = false

  // Clear interval.
  if (state.interval) {
    clearInterval(state.interval)
    state.interval = undefined
  }

  // Remove from stack.
  const index = spinnerStack.indexOf(state)
  if (index !== -1) {
    spinnerStack.splice(index, 1)
  }

  // Clear spinner line.
  clearSpinnerLine()

  // Resume parent spinner if exists.
  const parent = getCurrentSpinner()
  if (parent) {
    parent.paused = false
  }
}

/**
 * Pause all active spinners.
 * Use before outputting text to prevent visual conflicts.
 */
export function pauseSpinners(): void {
  const current = getCurrentSpinner()
  if (current) {
    current.paused = true
    clearSpinnerLine()
  }
}

/**
 * Resume all active spinners.
 * Use after outputting text to restore spinner animation.
 */
export function resumeSpinners(): void {
  const current = getCurrentSpinner()
  if (current) {
    current.paused = false
    renderSpinner(current)
  }
}

/**
 * Run an async operation with a spinner.
 * Automatically manages spinner lifecycle and coordinates output.
 *
 * @throws {Error} When operation throws.
 */
export async function withSpinner<T>(
  message: string,
  operation: () => Promise<T>,
): Promise<T> {
  const stop = startSpinner(message)

  try {
    const result = await operation()
    stop()
    return result
  } catch (e) {
    stop()
    throw e
  }
}

/**
 * Log message while coordinating with active spinners.
 * Pauses spinners, logs message, then resumes spinners.
 */
export function logWithSpinnerCoordination(
  level: 'log' | 'error' | 'warn',
  message: string,
): void {
  pauseSpinners()

  switch (level) {
    case 'log':
      logger.log(message)
      break
    case 'error':
      logger.error(message)
      break
    case 'warn':
      logger.warn(message)
      break
  }

  resumeSpinners()
}

/**
 * Update message of current active spinner.
 */
export function updateSpinnerMessage(message: string): void {
  const current = getCurrentSpinner()
  if (current) {
    current.message = message
    renderSpinner(current)
  }
}

/**
 * Stop all active spinners.
 * Use for cleanup on error or exit.
 */
export function stopAllSpinners(): void {
  // Copy array since stopSpinner modifies spinnerStack.
  const spinners = [...spinnerStack]
  for (const spinner of spinners) {
    stopSpinner(spinner)
  }
}

// Cleanup on process exit.
process.on('exit', () => {
  stopAllSpinners()
})

process.on('SIGINT', () => {
  stopAllSpinners()
  // eslint-disable-next-line n/no-process-exit
  process.exit(130)
})

process.on('SIGTERM', () => {
  stopAllSpinners()
  // eslint-disable-next-line n/no-process-exit
  process.exit(143)
})
