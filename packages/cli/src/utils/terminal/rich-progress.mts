/** @fileoverview Rich progress indicators for better CLI UX. */

import colors from 'yoctocolors-cjs'

import { onExit } from '@socketsecurity/lib/signal-exit'

import type { Writable } from 'node:stream'

const MAX_CONCURRENT_TASKS = 100

interface MultiProgressOptions {
  stream?: Writable
  format?: string
  hideCursor?: boolean
}

interface TaskProgress {
  id: string
  name: string
  current: number
  total: number
  status: 'pending' | 'running' | 'done' | 'failed'
  startTime?: number
  tokens?: Record<string, string>
}

/**
 * Create a multi-progress bar manager for parallel operations
 */
export class MultiProgress {
  private tasks: Map<string, TaskProgress> = new Map()
  private renderInterval: NodeJS.Timeout | undefined
  private stream: Writable
  private lastLineCount = 0
  private options: MultiProgressOptions

  constructor(options: MultiProgressOptions = {}) {
    this.options = options
    this.stream = options.stream || process.stderr
  }

  /**
   * Add a new task to track
   */
  addTask(id: string, name: string, total: number): void {
    // Prevent unbounded Map growth by enforcing max concurrent tasks.
    if (this.tasks.size >= MAX_CONCURRENT_TASKS) {
      // Remove oldest completed/failed task to make room.
      for (const [taskId, task] of this.tasks) {
        if (task.status === 'done' || task.status === 'failed') {
          this.tasks.delete(taskId)
          break
        }
      }
      // If still at max (all tasks are pending/running), remove oldest task.
      if (this.tasks.size >= MAX_CONCURRENT_TASKS) {
        const oldestId = this.tasks.keys().next().value
        if (oldestId) {
          this.tasks.delete(oldestId)
        }
      }
    }

    this.tasks.set(id, {
      id,
      name,
      current: 0,
      total,
      status: 'pending',
    })

    if (!this.renderInterval) {
      this.start()
    }
  }

  /**
   * Update task progress
   */
  updateTask(
    id: string,
    current: number,
    tokens?: Record<string, string>,
  ): void {
    const task = this.tasks.get(id)
    if (!task) {
      return
    }

    task.current = current
    task.status = 'running'
    if (tokens) {
      task.tokens = tokens
    }

    if (!task.startTime) {
      task.startTime = Date.now()
    }

    if (current >= task.total) {
      task.status = 'done'
    }
  }

  /**
   * Mark task as failed
   */
  failTask(id: string, error?: string): void {
    const task = this.tasks.get(id)
    if (!task) {
      return
    }

    task.status = 'failed'
    task.tokens = { error: error || 'Failed' }
  }

  /**
   * Remove a task from tracking to prevent unbounded Map growth.
   */
  removeTask(id: string): void {
    this.tasks.delete(id)
  }

  /**
   * Start rendering
   */
  private start(): void {
    if (this.options.hideCursor) {
      this.stream.write('\x1B[?25l') // Hide cursor
    }

    this.renderInterval = setInterval(() => {
      try {
        this.render()
      } catch {
        // Stop interval on render error to prevent error spam.
        this.stop()
      }
    }, 100)

    // Ensure interval is cleared on process exit to prevent leaks.
    const cleanup = () => this.stop()
    onExit(cleanup)
  }

  /**
   * Stop all progress tracking and cleanup tasks.
   */
  stop(): void {
    if (this.renderInterval) {
      clearInterval(this.renderInterval)
      this.renderInterval = undefined
    }

    this.clearLines()

    if (this.options.hideCursor) {
      this.stream.write('\x1B[?25h') // Show cursor
    }

    // Clear all tasks to prevent memory leaks in long-running processes.
    this.tasks.clear()
  }

  /**
   * Clear previous output lines
   */
  private clearLines(): void {
    for (let i = 0; i < this.lastLineCount; i++) {
      this.stream.write('\x1B[1A\x1B[2K') // Move up and clear line
    }
    this.lastLineCount = 0
  }

  /**
   * Render all progress bars
   */
  private render(): void {
    this.clearLines()

    const lines: string[] = []

    for (const task of this.tasks.values()) {
      lines.push(this.renderTask(task))
    }

    const output = lines.join('\n')
    if (output) {
      this.stream.write(`${output}\n`)
      this.lastLineCount = lines.length
    }
  }

  /**
   * Render a single task
   */
  private renderTask(task: TaskProgress): string {
    // Clamp percentage to 0-100 to prevent negative repeat counts.
    const percentage =
      task.total > 0
        ? Math.min(100, Math.floor((task.current / task.total) * 100))
        : 0
    const barLength = 30
    const filledLength = Math.floor((percentage / 100) * barLength)

    const bar = '█'.repeat(filledLength) + '░'.repeat(barLength - filledLength)

    let status = ''
    switch (task.status) {
      case 'done':
        status = colors.green('✓')
        break
      case 'failed':
        status = colors.red('✗')
        break
      case 'running':
        status = colors.cyan('→')
        break
      default:
        status = colors.gray('○')
    }

    const elapsed = task.startTime
      ? `${((Date.now() - task.startTime) / 1000).toFixed(1)}s`
      : ''
    const tokens = task.tokens ? ` ${Object.values(task.tokens).join(' ')}` : ''

    return `${status} ${task.name.padEnd(20)} ${bar} ${percentage.toString().padStart(3)}% ${colors.gray(elapsed)}${tokens}`
  }
}

/**
 * Create a simple spinner with message
 */
export class Spinner {
  private frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
  private current = 0
  private interval: NodeJS.Timeout | undefined
  private stream: Writable
  private message: string

  constructor(message: string, stream?: Writable) {
    this.message = message
    this.stream = stream || process.stderr
  }

  start(): void {
    this.interval = setInterval(() => {
      try {
        this.stream.write(
          `\r${colors.cyan(this.frames[this.current]!)} ${this.message}`,
        )
        this.current = (this.current + 1) % this.frames.length
      } catch {
        // Stop interval on write error to prevent error spam.
        this.stop()
      }
    }, 80)

    // Ensure interval is cleared on process exit to prevent leaks.
    const cleanup = () => this.stop()
    onExit(cleanup)
  }

  update(message: string): void {
    this.message = message
  }

  succeed(message?: string): void {
    this.stop()
    this.stream.write(`\r${colors.green('✓')} ${message || this.message}\n`)
  }

  fail(message?: string): void {
    this.stop()
    this.stream.write(`\r${colors.red('✗')} ${message || this.message}\n`)
  }

  private stop(): void {
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = undefined
      this.stream.write('\r\x1B[2K') // Clear line
    }
  }
}

/**
 * Progress indicator for file operations
 */
export class FileProgress {
  private processed = 0
  private total: number
  private startTime = Date.now()
  // private files: string[]
  private operation: string

  constructor(files: string[], operation = 'Processing') {
    // this.files = files
    this.operation = operation
    this.total = files.length
  }

  next(file: string): void {
    this.processed++
    const percentage =
      this.total > 0 ? Math.floor((this.processed / this.total) * 100) : 0
    const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1)

    process.stderr.write(
      `\r${this.operation}: [${this.processed}/${this.total}] ${percentage}% ${colors.gray(`(${elapsed}s)`)} ${colors.cyan(file)}`,
    )

    if (this.processed === this.total) {
      process.stderr.write('\n')
    }
  }
}
