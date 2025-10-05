/** @fileoverview Lightweight spinner utility for coordinating CLI operations. */

import process from 'node:process'
import { clearInterval, setInterval } from 'node:timers'

import colors from 'yoctocolors-cjs'

import { logger } from '@socketsecurity/registry/lib/logger'

import { isDebug } from './debug.mts'

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const SPINNER_INTERVAL = 80

type SpinnerState = {
  frame: number
  interval: NodeJS.Timeout | undefined
  isSpinning: boolean
  message: string
  paused: boolean
  progress?: ProgressInfo | undefined
}

type ProgressInfo = {
  current: number
  total: number
  unit?: string | undefined
}

const spinnerStack: SpinnerState[] = []

/**
 * Get current active spinner or undefined.
 */
function getCurrentSpinner(): SpinnerState | undefined {
  return spinnerStack[spinnerStack.length - 1]
}

/**
 * Format progress information.
 */
function formatProgress(progress: ProgressInfo): string {
  const { current, total, unit } = progress
  const percentage = Math.round((current / total) * 100)
  const bar = renderProgressBar(percentage)
  const count = unit ? `${current}/${total} ${unit}` : `${current}/${total}`
  return `${bar} ${percentage}% (${count})`
}

/**
 * Render a progress bar.
 */
function renderProgressBar(percentage: number, width: number = 20): string {
  const filled = Math.round((percentage / 100) * width)
  const empty = width - filled
  const bar = '█'.repeat(filled) + '░'.repeat(empty)
  return colors.cyan(bar)
}

/**
 * Render spinner frame to stderr.
 */
function renderSpinner(state: SpinnerState): void {
  if (!process.stderr.isTTY || state.paused) {
    return
  }

  const frame = SPINNER_FRAMES[state.frame % SPINNER_FRAMES.length]
  let text = `${colors.cyan(frame ?? '')} ${state.message}`

  // Add progress if available
  if (state.progress) {
    text += ` ${formatProgress(state.progress)}`
  }

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
  if (isDebug('error') || isDebug('stdio') || !process.stderr.isTTY) {
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
 * Update progress of current active spinner.
 *
 * @param current - Current progress value
 * @param total - Total progress value
 * @param unit - Optional unit label (e.g., 'files', 'packages')
 *
 * @example
 * const stop = startSpinner('Processing files')
 * for (let i = 0; i < files.length; i++) {
 *   updateSpinnerProgress(i + 1, files.length, 'files')
 *   await processFile(files[i])
 * }
 * stop()
 */
export function updateSpinnerProgress(
  current: number,
  total: number,
  unit?: string | undefined,
): void {
  const spinner = getCurrentSpinner()
  if (spinner) {
    spinner.progress = { current, total, unit }
    renderSpinner(spinner)
  }
}

/**
 * Increment progress of current active spinner by 1.
 *
 * @example
 * const stop = startSpinner('Scanning packages')
 * updateSpinnerProgress(0, packages.length, 'packages')
 * for (const pkg of packages) {
 *   await scanPackage(pkg)
 *   incrementSpinnerProgress()
 * }
 * stop()
 */
export function incrementSpinnerProgress(): void {
  const spinner = getCurrentSpinner()
  if (spinner?.progress) {
    spinner.progress.current++
    renderSpinner(spinner)
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
