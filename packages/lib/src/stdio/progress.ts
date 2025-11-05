/**
 * @fileoverview Progress bar utilities for CLI applications.
 * Provides various progress indicators including bars, percentages, and spinners.
 */

import colors from 'yoctocolors-cjs'
import { repeatString, stripAnsi } from '../strings'

export interface ProgressBarOptions {
  /**
   * Width of the progress bar in characters.
   * @default 40
   */
  width?: number | undefined
  /**
   * Format template for progress bar display.
   * Available tokens: `:bar`, `:percent`, `:current`, `:total`, `:elapsed`, `:eta`.
   * Custom tokens can be passed via the `tokens` parameter in `update()` or `tick()`.
   * @default ':bar :percent :current/:total'
   * @example
   * ```ts
   * format: ':bar :percent :current/:total :eta'
   * ```
   */
  format?: string | undefined
  /**
   * Character(s) to use for completed portion of bar.
   * @default '█'
   */
  complete?: string | undefined
  /**
   * Character(s) to use for incomplete portion of bar.
   * @default '░'
   */
  incomplete?: string | undefined
  /**
   * Character(s) to use for the head of the progress bar.
   * @default ''
   */
  head?: string | undefined
  /**
   * Clear the progress bar when complete.
   * @default false
   */
  clear?: boolean | undefined
  /**
   * Minimum time between renders in milliseconds.
   * ~60fps = 16ms throttle.
   * @default 16
   */
  renderThrottle?: number | undefined
  /**
   * Stream to write progress bar output to.
   * @default process.stderr
   */
  stream?: NodeJS.WriteStream | undefined
  /**
   * Color to apply to the completed portion of the bar.
   * @default 'cyan'
   */
  color?: 'cyan' | 'green' | 'yellow' | 'blue' | 'magenta' | undefined
}

export class ProgressBar {
  private current: number = 0
  private total: number
  private startTime: number
  private lastRender: number = 0
  private stream: NodeJS.WriteStream
  private options: Required<ProgressBarOptions>
  private terminated: boolean = false
  private lastDrawnWidth: number = 0

  /**
   * Create a new progress bar instance.
   *
   * @param total - Total number of units for the progress bar
   * @param options - Configuration options for the progress bar
   *
   * @example
   * ```ts
   * const bar = new ProgressBar(100, {
   *   width: 50,
   *   format: ':bar :percent :current/:total :eta',
   *   color: 'green'
   * })
   * ```
   */
  constructor(total: number, options?: ProgressBarOptions) {
    this.total = total
    this.startTime = Date.now()
    this.stream = options?.stream || process.stderr
    this.options = {
      width: 40,
      format: ':bar :percent :current/:total',
      complete: '█',
      incomplete: '░',
      head: '',
      clear: false,
      // ~60fps.
      renderThrottle: 16,
      stream: this.stream,
      color: 'cyan',
      ...options,
    }
  }

  /**
   * Update progress to a specific value and redraw the bar.
   * Updates are throttled to prevent excessive rendering (default ~60fps).
   *
   * @param current - Current progress value (will be clamped to total)
   * @param tokens - Optional custom tokens to replace in format string
   *
   * @example
   * ```ts
   * bar.update(50)
   * bar.update(75, { status: 'Processing...' })
   * ```
   */
  update(current: number, tokens?: Record<string, unknown>): void {
    if (this.terminated) {
      return
    }

    this.current = Math.min(current, this.total)

    // Throttle rendering
    const now = Date.now()
    if (
      now - this.lastRender < this.options.renderThrottle &&
      this.current < this.total
    ) {
      return
    }
    this.lastRender = now

    this.render(tokens)

    if (this.current >= this.total) {
      this.terminate()
    }
  }

  /**
   * Increment progress by a specified amount.
   * Convenience method for `update(current + amount)`.
   *
   * @param amount - Amount to increment by
   * @param tokens - Optional custom tokens to replace in format string
   * @default amount 1
   *
   * @example
   * ```ts
   * bar.tick() // Increment by 1
   * bar.tick(5) // Increment by 5
   * bar.tick(1, { file: 'data.json' })
   * ```
   */
  tick(amount: number = 1, tokens?: Record<string, unknown>): void {
    this.update(this.current + amount, tokens)
  }

  /**
   * Render the progress bar.
   */
  private render(tokens?: Record<string, unknown>): void {
    const colorFn = colors[this.options.color] || ((s: string) => s)

    // Calculate values
    const percent = Math.floor((this.current / this.total) * 100)
    const elapsed = Date.now() - this.startTime
    const eta =
      this.current === 0
        ? 0
        : (elapsed / this.current) * (this.total - this.current)

    // Build bar
    const availableWidth = this.options.width
    const filledWidth = Math.floor((this.current / this.total) * availableWidth)
    const emptyWidth = availableWidth - filledWidth

    const filled = repeatString(this.options.complete, filledWidth)
    const empty = repeatString(this.options.incomplete, emptyWidth)
    const bar = colorFn(filled) + empty

    // Format output
    let output = this.options.format
    output = output.replace(':bar', bar)
    output = output.replace(':percent', `${percent}%`)
    output = output.replace(':current', String(this.current))
    output = output.replace(':total', String(this.total))
    output = output.replace(':elapsed', this.formatTime(elapsed))
    output = output.replace(':eta', this.formatTime(eta))

    // Replace custom tokens
    if (tokens) {
      for (const [key, value] of Object.entries(tokens)) {
        output = output.replace(`:${key}`, String(value))
      }
    }

    // Clear line and write
    this.clearLine()
    this.stream.write(output)
    this.lastDrawnWidth = stripAnsi(output).length
  }

  /**
   * Clear the current line.
   */
  private clearLine(): void {
    if (this.stream.isTTY) {
      this.stream.cursorTo(0)
      this.stream.clearLine(0)
    } else if (this.lastDrawnWidth > 0) {
      this.stream.write(`\r${repeatString(' ', this.lastDrawnWidth)}\r`)
    }
  }

  /**
   * Format time in seconds to human readable.
   */
  private formatTime(ms: number): string {
    const seconds = Math.round(ms / 1000)
    if (seconds < 60) {
      return `${seconds}s`
    }
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = seconds % 60
    return `${minutes}m${remainingSeconds}s`
  }

  /**
   * Terminate the progress bar and optionally clear it.
   * Called automatically when progress reaches 100%.
   * If `clear` option is true, removes the bar from terminal.
   * Otherwise, moves to next line to preserve the final state.
   */
  terminate(): void {
    if (this.terminated) {
      return
    }
    this.terminated = true

    if (this.options.clear) {
      this.clearLine()
    } else {
      this.stream.write('\n')
    }
  }
}

/**
 * Create a simple progress indicator without a graphical bar.
 * Returns a formatted string showing progress as percentage and fraction.
 *
 * @param current - Current progress value
 * @param total - Total progress value
 * @param label - Optional label prefix
 * @returns Formatted progress indicator string
 *
 * @example
 * ```ts
 * createProgressIndicator(50, 100)
 * // Returns: '[50%] 50/100'
 *
 * createProgressIndicator(3, 10, 'Files')
 * // Returns: 'Files: [30%] 3/10'
 * ```
 */
export function createProgressIndicator(
  current: number,
  total: number,
  label?: string | undefined,
): string {
  const percent = Math.floor((current / total) * 100)
  const progress = `${current}/${total}`

  let output = ''
  if (label) {
    output += `${label}: `
  }

  output += `${colors.cyan(`[${percent}%]`)} ${progress}`

  return output
}
