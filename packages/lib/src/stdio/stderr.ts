/**
 * @fileoverview Standard error stream utilities.
 * Provides utilities for writing to stderr with formatting and control.
 */

// Get the actual stderr stream
const stderr: NodeJS.WriteStream = process.stderr

/**
 * Write a line to stderr with trailing newline.
 * Used for error messages, warnings, and diagnostic output.
 *
 * @param text - Text to write
 * @default text ''
 *
 * @example
 * ```ts
 * writeErrorLine('Error: File not found')
 * writeErrorLine() // Write empty line
 * ```
 */
export function writeErrorLine(text: string = ''): void {
  stderr.write(`${text}\n`)
}

/**
 * Write text to stderr without adding a newline.
 *
 * @param text - Text to write
 *
 * @example
 * ```ts
 * writeError('Downloading...')
 * // Later update progress
 * ```
 */
export function writeError(text: string): void {
  stderr.write(text)
}

/**
 * Clear the current line on stderr.
 * Only works in TTY environments.
 *
 * @example
 * ```ts
 * writeError('Processing...')
 * clearLine()
 * writeError('Done!')
 * ```
 */
export function clearLine(): void {
  if (stderr.isTTY) {
    stderr.cursorTo(0)
    stderr.clearLine(0)
  }
}

/**
 * Move cursor to specific position on stderr.
 * Only works in TTY environments.
 *
 * @param x - Column position (0-based)
 * @param y - Row position (0-based, optional)
 *
 * @example
 * ```ts
 * cursorTo(0) // Move to start of line
 * cursorTo(10, 5) // Move to column 10, row 5
 * ```
 */
export function cursorTo(x: number, y?: number | undefined): void {
  if (stderr.isTTY) {
    stderr.cursorTo(x, y)
  }
}

/**
 * Check if stderr is connected to a TTY (terminal).
 *
 * @returns `true` if stderr is a TTY, `false` if piped/redirected
 *
 * @example
 * ```ts
 * if (isTTY()) {
 *   // Show colored error messages
 * } else {
 *   // Use plain text
 * }
 * ```
 */
export function isTTY(): boolean {
  return stderr.isTTY || false
}

/**
 * Get the number of columns (width) in the terminal.
 *
 * @returns Terminal width in characters
 * @default 80
 *
 * @example
 * ```ts
 * const width = getColumns()
 * console.error(`Terminal is ${width} characters wide`)
 * ```
 */
export function getColumns(): number {
  return stderr.columns || 80
}

/**
 * Get the number of rows (height) in the terminal.
 *
 * @returns Terminal height in lines
 * @default 24
 *
 * @example
 * ```ts
 * const height = getRows()
 * console.error(`Terminal is ${height} lines tall`)
 * ```
 */
export function getRows(): number {
  return stderr.rows || 24
}

/**
 * Write a formatted warning message to stderr.
 *
 * @param message - Warning message text
 * @param prefix - Prefix label for the warning
 * @default prefix 'Warning'
 *
 * @example
 * ```ts
 * writeWarning('Deprecated API usage')
 * // Output: 'Warning: Deprecated API usage'
 *
 * writeWarning('Invalid config', 'Config')
 * // Output: 'Config: Invalid config'
 * ```
 */
export function writeWarning(
  message: string,
  prefix: string = 'Warning',
): void {
  const formatted = `${prefix}: ${message}`
  writeErrorLine(formatted)
}

/**
 * Write a formatted error message to stderr.
 *
 * @param message - Error message text
 * @param prefix - Prefix label for the error
 * @default prefix 'Error'
 *
 * @example
 * ```ts
 * writeErrorFormatted('File not found')
 * // Output: 'Error: File not found'
 *
 * writeErrorFormatted('Connection failed', 'Network')
 * // Output: 'Network: Connection failed'
 * ```
 */
export function writeErrorFormatted(
  message: string,
  prefix: string = 'Error',
): void {
  const formatted = `${prefix}: ${message}`
  writeErrorLine(formatted)
}

/**
 * Write an error's stack trace to stderr.
 * Falls back to formatted error message if no stack is available.
 *
 * @param error - Error object to write
 *
 * @example
 * ```ts
 * try {
 *   throw new Error('Something went wrong')
 * } catch (err) {
 *   writeStackTrace(err as Error)
 * }
 * ```
 */
export function writeStackTrace(error: Error): void {
  if (error.stack) {
    writeErrorLine(error.stack)
  } else {
    writeErrorFormatted(error.message)
  }
}

// Export the raw stream for advanced usage
export { stderr }
