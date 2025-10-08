/** @fileoverview Inline status line for real-time updates (like Claude Code) */

import { stdout } from 'node:process'

import { getTheme } from './theme.mts'

export interface StatusLineOptions {
  prefix?: string
  suffix?: string
  showSpinner?: boolean
  showTime?: boolean
  width?: number
}

/**
 * Inline status line for real-time updates
 */
export class InlineStatus {
  private active: boolean = false
  private startTime: number = 0
  private spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
  private spinnerIndex = 0
  private spinnerInterval: NodeJS.Timeout | undefined
  private lastMessage: string = ''
  private theme = getTheme()

  private options: StatusLineOptions

  constructor(
    options: StatusLineOptions = {}
  ) {
    this.options = options
  }

  /**
   * Start showing status
   */
  start(message?: string): void {
    if (this.active) {
      this.update(message || this.lastMessage)
      return
    }

    this.active = true
    this.startTime = Date.now()

    if (message) {
      this.lastMessage = message
    }

    if (this.options.showSpinner) {
      this.startSpinner()
    }

    this.render()
  }

  /**
   * Update status message
   */
  update(message: string, options?: { color?: 'primary' | 'success' | 'warning' | 'error' | 'info' }): void {
    this.lastMessage = message
    this.render(options)
  }

  /**
   * Stop and clear status
   */
  stop(finalMessage?: string, persist: boolean = false): void {
    if (!this.active) {return}

    this.active = false

    if (this.spinnerInterval) {
      clearInterval(this.spinnerInterval)
      this.spinnerInterval = undefined
    }

    // Clear the line
    stdout.write('\r\x1b[K')

    // Optionally show final message
    if (finalMessage) {
      if (persist) {
        console.log(finalMessage)
      } else {
        stdout.write(finalMessage)
      }
    }
  }

  /**
   * Success status
   */
  succeed(message: string): void {
    const theme = getTheme()
    this.stop(`${theme.success('✓')} ${message}`, true)
  }

  /**
   * Failure status
   */
  fail(message: string): void {
    const theme = getTheme()
    this.stop(`${theme.error('✗')} ${message}`, true)
  }

  /**
   * Warning status
   */
  warn(message: string): void {
    const theme = getTheme()
    this.stop(`${theme.warning('⚠')} ${message}`, true)
  }

  /**
   * Info status
   */
  info(message: string): void {
    const theme = getTheme()
    this.stop(`${theme.info('ℹ')} ${message}`, true)
  }

  /**
   * Render current status
   */
  private render(options?: { color?: string }): void {
    if (!this.active) {return}

    const parts: string[] = []

    // Add prefix
    if (this.options.prefix) {
      parts.push(this.options.prefix)
    }

    // Add spinner
    if (this.options.showSpinner) {
      parts.push(this.theme.primary(this.spinnerFrames[this.spinnerIndex] || '⠋'))
    }

    // Add message with color
    let message = this.lastMessage
    if (options?.color) {
      const colorFn = (this.theme as any)[options.color]
      if (colorFn) {
        message = colorFn(message)
      }
    } else {
      message = this.theme.primary(message)
    }
    parts.push(message)

    // Add time elapsed
    if (this.options.showTime && this.startTime) {
      const elapsed = Math.floor((Date.now() - this.startTime) / 1000)
      parts.push(this.theme.dim(`[${elapsed}s]`))
    }

    // Add suffix
    if (this.options.suffix) {
      parts.push(this.options.suffix)
    }

    // Truncate if needed
    let output = parts.join(' ')
    const maxWidth = this.options.width || process.stdout.columns || 80
    if (output.length > maxWidth) {
      output = output.slice(0, maxWidth - 3) + '...'
    }

    // Write to stdout
    stdout.write('\r\x1b[K' + output)
  }

  /**
   * Start spinner animation
   */
  private startSpinner(): void {
    if (this.spinnerInterval) {return}

    this.spinnerInterval = setInterval(() => {
      // Check if still active to prevent race condition
      if (this.active) {
        this.spinnerIndex = (this.spinnerIndex + 1) % this.spinnerFrames.length
        this.render()
      } else {
        // Clean up interval if no longer active
        if (this.spinnerInterval) {
          clearInterval(this.spinnerInterval)
          this.spinnerInterval = undefined
        }
      }
    }, 80)
  }
}

/**
 * Progress status line
 */
export class ProgressStatus extends InlineStatus {
  private total: number = 100

  /**
   * Set progress
   */
  setProgress(current: number, total: number, message?: string): void {
    this.total = total

    const percentage = Math.floor((current / total) * 100)
    const progressBar = this.createProgressBar(percentage)

    const progressMessage = message || this['lastMessage']
    this.update(`${progressMessage} ${progressBar} ${percentage}%`)
  }

  /**
   * Create progress bar
   */
  private createProgressBar(percentage: number): string {
    const theme = getTheme()
    const width = 20
    const filled = Math.floor((percentage / 100) * width)
    const empty = width - filled

    return theme.primary('█'.repeat(filled)) + theme.dim('░'.repeat(empty))
  }

  /**
   * Complete progress
   */
  complete(message?: string): void {
    this.setProgress(this.total, this.total, message)
    setTimeout(() => {
      this.succeed(message || 'Complete')
    }, 200)
  }
}

/**
 * Multi-line status manager
 */
export class MultiStatus {
  private lines: Map<string, InlineStatus> = new Map()
  private activeCount: number = 0

  /**
   * Add a status line
   */
  add(id: string, message: string, options?: StatusLineOptions): InlineStatus {
    if (this.lines.has(id)) {
      const line = this.lines.get(id)!
      line.update(message)
      return line
    }

    const line = new InlineStatus(options)
    this.lines.set(id, line)

    // Move to new line for multi-status
    if (this.activeCount > 0) {
      stdout.write('\n')
    }

    line.start(message)
    this.activeCount++

    return line
  }

  /**
   * Update a status line
   */
  update(id: string, message: string): void {
    const line = this.lines.get(id)
    if (line) {
      line.update(message)
    }
  }

  /**
   * Remove a status line
   */
  remove(id: string, finalMessage?: string): void {
    const line = this.lines.get(id)
    if (line) {
      line.stop(finalMessage, true)
      this.lines.delete(id)
      this.activeCount--
    }
  }

  /**
   * Clear all status lines
   */
  clear(): void {
    // Create array copy to avoid iterator invalidation
    const linesToClear = Array.from(this.lines.entries())
    for (const [, line] of linesToClear) {
      line.stop()
    }
    this.lines.clear()
    this.activeCount = 0
  }

  /**
   * Cleanup on process exit
   */
  destroy(): void {
    this.clear()
    // Remove any event listeners if needed
  }
}

/**
 * Helper function for quick status
 */
export function withStatus<T>(
  message: string,
  task: () => Promise<T>,
  options?: StatusLineOptions
): Promise<T> {
  const status = new InlineStatus(options)
  status.start(message)

  return task()
    .then(result => {
      status.succeed(message)
      return result
    })
    .catch(error => {
      status.fail(message)
      throw error
    })
}

/**
 * Helper for progress tracking
 */
export async function withProgress<T>(
  message: string,
  task: (progress: (current: number, total: number) => void) => Promise<T>
): Promise<T> {
  const progress = new ProgressStatus()
  progress.start(message)

  try {
    const result = await task((current, total) => {
      progress.setProgress(current, total, message)
    })
    progress.complete(message)
    return result
  } catch (error) {
    progress.fail(message)
    throw error
  }
}

/**
 * Stream processing with status
 */
export async function* withStreamStatus<T>(
  message: string,
  stream: AsyncIterable<T>,
  options?: {
    showCount?: boolean
    showRate?: boolean
  }
): AsyncGenerator<T> {
  const status = new InlineStatus({ showTime: true })
  status.start(message)

  let count = 0
  const startTime = Date.now()

  try {
    for await (const item of stream) {
      count++

      let updateMessage = message
      if (options?.showCount) {
        updateMessage += ` (${count} items)`
      }
      if (options?.showRate) {
        const elapsed = (Date.now() - startTime) / 1000
        const rate = Math.floor(count / elapsed)
        updateMessage += ` [${rate}/s]`
      }

      status.update(updateMessage)
      yield item
    }

    status.succeed(`${message} (${count} items)`)
  } catch (error) {
    status.fail(message)
    throw error
  }
}