/**
 * @fileoverview Console header/banner formatting utilities.
 * Provides consistent header formatting for CLI applications.
 */

import colors from 'yoctocolors-cjs'
import { centerText, repeatString } from '../strings'

export interface HeaderOptions {
  /**
   * Width of the header in characters.
   * @default 80
   */
  width?: number | undefined
  /**
   * Character to use for border lines.
   * @default '='
   */
  borderChar?: string | undefined
  /**
   * Number of blank lines above and below title.
   * @default 1
   */
  padding?: number | undefined
  /**
   * Color to apply to the title text.
   * @default 'cyan'
   */
  color?:
    | 'cyan'
    | 'green'
    | 'yellow'
    | 'blue'
    | 'magenta'
    | 'red'
    | 'gray'
    | undefined
  /**
   * Apply bold styling to title.
   * @default true
   */
  bold?: boolean | undefined
}

/**
 * Create a formatted header/banner with borders and centered title.
 * Useful for marking the start of CLI output or creating visual sections.
 *
 * @param title - Title text to display in header
 * @param options - Header formatting options
 * @returns Formatted header string with borders and centered title
 *
 * @example
 * ```ts
 * console.log(createHeader('Socket Security Analysis', {
 *   width: 70,
 *   color: 'cyan',
 *   bold: true,
 *   padding: 2
 * }))
 * // Output:
 * // ======================================================================
 * //
 * //                    Socket Security Analysis
 * //
 * // ======================================================================
 * ```
 */
export function createHeader(title: string, options?: HeaderOptions): string {
  const {
    bold = true,
    borderChar = '=',
    color = 'cyan',
    padding = 1,
    width = 80,
  } = { __proto__: null, ...options } as HeaderOptions

  const border = repeatString(borderChar, width)

  // Apply color and bold
  let formattedTitle = title
  if (color && colors[color]) {
    formattedTitle = colors[color](formattedTitle)
  }
  if (bold && colors.bold) {
    formattedTitle = colors.bold(formattedTitle)
  }

  const centeredTitle = centerText(formattedTitle, width)
  const paddingLine = repeatString(' ', width)

  const lines: string[] = [border]

  for (let i = 0; i < padding; i++) {
    lines.push(paddingLine)
  }

  lines.push(centeredTitle)

  for (let i = 0; i < padding; i++) {
    lines.push(paddingLine)
  }

  lines.push(border)

  return lines.join('\n')
}

/**
 * Create a simple section header without padding.
 * A lighter-weight alternative to `createHeader()` for subsections.
 *
 * @param title - Title text to display in header
 * @param options - Header formatting options
 * @returns Formatted section header string
 *
 * @example
 * ```ts
 * console.log(createSectionHeader('Dependencies', {
 *   width: 50,
 *   color: 'blue'
 * }))
 * // Output:
 * // --------------------------------------------------
 * //                   Dependencies
 * // --------------------------------------------------
 * ```
 */
export function createSectionHeader(
  title: string,
  options?: HeaderOptions,
): string {
  const {
    borderChar = '-',
    color = 'blue',
    width = 60,
  } = { __proto__: null, ...options } as HeaderOptions

  return createHeader(title, {
    width,
    borderChar,
    padding: 0,
    color,
    bold: false,
  })
}

/**
 * Print a header directly to stdout with standard formatting.
 * Uses fixed width of 55 characters with `═` borders.
 * Simpler alternative to `createHeader()` for quick headers.
 *
 * @param title - Title text to display
 *
 * @example
 * ```ts
 * printHeader('Package Analysis')
 * // Output:
 * // ═══════════════════════════════════════════════════
 * //   Package Analysis
 * // ═══════════════════════════════════════════════════
 * ```
 */
export function printHeader(title: string): void {
  const border = repeatString('═', 55)
  console.log(border)
  console.log(`  ${title}`)
  console.log(border)
}

/**
 * Print a footer with optional success message.
 * Uses `─` border character for a lighter appearance.
 * Fixed width of 55 characters to match `printHeader()`.
 *
 * @param message - Optional message to display (shown in green)
 *
 * @example
 * ```ts
 * printFooter('Analysis complete')
 * // Output:
 * // ───────────────────────────────────────────────────
 * // Analysis complete (in green)
 * ```
 */
export function printFooter(message?: string | undefined): void {
  const border = repeatString('─', 55)
  console.log(border)
  if (message) {
    console.log(colors.green(message))
  }
}
