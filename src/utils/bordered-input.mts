/** @fileoverview Bordered input field for terminal UI */

import { stdin, stdout } from 'node:process'
import readline from 'node:readline/promises'

import colors from 'yoctocolors-cjs'

/**
 * Box drawing characters for different border styles
 */
export const borderStyles = {
  single: {
    topLeft: '┌',
    topRight: '┐',
    bottomLeft: '└',
    bottomRight: '┘',
    horizontal: '─',
    vertical: '│',
  },
  double: {
    topLeft: '╔',
    topRight: '╗',
    bottomLeft: '╚',
    bottomRight: '╝',
    horizontal: '═',
    vertical: '║',
  },
  rounded: {
    topLeft: '╭',
    topRight: '╮',
    bottomLeft: '╰',
    bottomRight: '╯',
    horizontal: '─',
    vertical: '│',
  },
  thick: {
    topLeft: '┏',
    topRight: '┓',
    bottomLeft: '┗',
    bottomRight: '┛',
    horizontal: '━',
    vertical: '┃',
  },
}

/**
 * Create a bordered box around text
 */
export function createBox(
  content: string,
  width: number = 40,
  style: keyof typeof borderStyles = 'single',
  color: (text: string) => string = colors.blue
): string {
  const border = borderStyles[style]
  const lines = content.split('\n')
  // Account for borders
  const paddedWidth = width - 2

  const result: string[] = []

  // Top border
  result.push(color(
    border.topLeft +
    border.horizontal.repeat(paddedWidth) +
    border.topRight
  ))

  // Content lines with side borders
  for (const line of lines) {
    const paddedLine = line.padEnd(paddedWidth, ' ')
    result.push(
      color(border.vertical) +
      paddedLine +
      color(border.vertical)
    )
  }

  // Bottom border
  result.push(color(
    border.bottomLeft +
    border.horizontal.repeat(paddedWidth) +
    border.bottomRight
  ))

  return result.join('\n')
}

/**
 * Create a bordered input prompt
 */
export async function borderedInput(
  prompt: string,
  options: {
    width?: number
    style?: keyof typeof borderStyles
    color?: (text: string) => string
    placeholder?: string
  } = {}
): Promise<string> {
  const {
    color = colors.blue,
    placeholder = '',
    style = 'single',
    width = 50,
  } = options

  const border = borderStyles[style]
  const innerWidth = width - 2

  // Clear line and draw top border
  stdout.write('\r\x1b[K')
  stdout.write(color(
    border.topLeft +
    border.horizontal.repeat(innerWidth) +
    border.topRight
  ) + '\n')

  // Draw prompt line
  if (prompt) {
    const paddedPrompt = ` ${prompt} `.padEnd(innerWidth, ' ')
    stdout.write(
      color(border.vertical) +
      colors.cyan(paddedPrompt) +
      color(border.vertical) + '\n'
    )

    // Draw separator
    stdout.write(
      color(border.vertical) +
      color(border.horizontal.repeat(innerWidth)) +
      color(border.vertical) + '\n'
    )
  }

  // Draw input line with placeholder
  stdout.write(color(border.vertical) + ' ')

  // Save cursor position for input
  // After border and space
  const cursorX = 3

  // Create readline interface
  const rl = readline.createInterface({
    input: stdin,
    output: stdout,
    prompt: placeholder ? colors.dim(placeholder) : '',
  })

  // Draw right border after input area
  stdout.write(' '.repeat(innerWidth - 1))
  stdout.write(color(border.vertical) + '\n')

  // Draw bottom border
  stdout.write(color(
    border.bottomLeft +
    border.horizontal.repeat(innerWidth) +
    border.bottomRight
  ) + '\n')

  // Move cursor back up to input line
  stdout.write(`\x1b[3A\x1b[${cursorX}C`)

  // Get input
  const answer = await rl.question('')

  // Move cursor to after the box
  stdout.write('\x1b[3B\n')

  rl.close()
  return answer
}

/**
 * Create a live updating bordered box (like a terminal window)
 */
export class BorderedOutput {
  private width: number
  private height: number
  private style: keyof typeof borderStyles
  private color: (text: string) => string
  private title: string
  private lines: string[] = []

  constructor(options: {
    width?: number
    height?: number
    style?: keyof typeof borderStyles
    color?: (text: string) => string
    title?: string
  } = {}) {
    this.width = options.width || 60
    this.height = options.height || 10
    this.style = options.style || 'single'
    this.color = options.color || colors.blue
    this.title = options.title || ''
  }

  /**
   * Draw the initial box
   */
  draw(): void {
    const border = borderStyles[this.style]
    const innerWidth = this.width - 2

    // Top border with title
    if (this.title) {
      const titleStr = ` ${this.title} `
      const leftPad = Math.floor((innerWidth - titleStr.length) / 2)
      const rightPad = innerWidth - titleStr.length - leftPad

      stdout.write(this.color(
        border.topLeft +
        border.horizontal.repeat(leftPad) +
        colors.cyan(titleStr) +
        border.horizontal.repeat(rightPad) +
        border.topRight
      ) + '\n')
    } else {
      stdout.write(this.color(
        border.topLeft +
        border.horizontal.repeat(innerWidth) +
        border.topRight
      ) + '\n')
    }

    // Content area
    for (let i = 0; i < this.height - 2; i++) {
      const line = this.lines[i] || ''
      const paddedLine = line.substring(0, innerWidth).padEnd(innerWidth, ' ')
      stdout.write(
        this.color(border.vertical) +
        paddedLine +
        this.color(border.vertical) + '\n'
      )
    }

    // Bottom border
    stdout.write(this.color(
      border.bottomLeft +
      border.horizontal.repeat(innerWidth) +
      border.bottomRight
    ) + '\n')
  }

  /**
   * Add a line to the output
   */
  addLine(text: string): void {
    this.lines.push(text)
    if (this.lines.length > this.height - 2) {
      // Remove oldest line
      this.lines.shift()
    }
    this.redraw()
  }

  /**
   * Clear and redraw the box
   */
  private redraw(): void {
    // Move cursor up to start of box
    stdout.write(`\x1b[${this.height}A`)
    this.draw()
  }

  /**
   * Clear the box content
   */
  clear(): void {
    this.lines = []
    this.redraw()
  }
}

/**
 * Create a menu with bordered options
 */
export async function borderedMenu(
  title: string,
  options: string[],
  style: keyof typeof borderStyles = 'rounded',
  color: (text: string) => string = colors.cyan
): Promise<number> {
  const width = Math.max(title.length + 4, ...options.map(o => o.length + 6)) + 2
  const border = borderStyles[style]
  const innerWidth = width - 2

  // Draw top border with title
  const titleStr = ` ${title} `
  const leftPad = Math.floor((innerWidth - titleStr.length) / 2)
  const rightPad = innerWidth - titleStr.length - leftPad

  stdout.write(color(
    border.topLeft +
    border.horizontal.repeat(leftPad)
  ))
  stdout.write(colors.bold(colors.white(titleStr)))
  stdout.write(color(
    border.horizontal.repeat(rightPad) +
    border.topRight
  ) + '\n')

  // Draw separator
  stdout.write(
    color(border.vertical) +
    color(border.horizontal.repeat(innerWidth)) +
    color(border.vertical) + '\n'
  )

  // Draw options
  for (let i = 0; i < options.length; i++) {
    const option = `  ${i + 1}. ${options[i]}`
    const paddedOption = option.padEnd(innerWidth, ' ')
    stdout.write(
      color(border.vertical) +
      paddedOption +
      color(border.vertical) + '\n'
    )
  }

  // Draw bottom border
  stdout.write(color(
    border.bottomLeft +
    border.horizontal.repeat(innerWidth) +
    border.bottomRight
  ) + '\n')

  // Get selection
  const rl = readline.createInterface({ input: stdin, output: stdout })
  const answer = await rl.question(colors.cyan('Select an option (1-' + options.length + '): '))
  rl.close()

  return parseInt(answer, 10) || 0
}