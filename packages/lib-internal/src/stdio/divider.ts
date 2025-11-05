/**
 * @fileoverview Console divider and separator utilities.
 * Provides various line styles for visual separation in CLI output.
 */

import { repeatString } from '../strings'

export interface DividerOptions {
  /**
   * Width of the divider line in characters.
   * @default 55
   */
  width?: number | undefined
  /**
   * Character to repeat for the divider line.
   * @default '═'
   */
  char?: string | undefined
  /**
   * Optional color function to apply to the divider.
   * Accepts a function from `yoctocolors` or similar.
   */
  color?: ((text: string) => string) | undefined
}

/**
 * Create a divider line with custom character and width.
 * Returns a string of repeated characters for visual separation.
 *
 * @param options - Divider formatting options
 * @returns Divider string
 *
 * @example
 * ```ts
 * console.log(divider()) // Default: 55 '═' characters
 * console.log(divider({ char: '-', width: 40 }))
 * console.log(divider({ char: '·', width: 30 }))
 * ```
 */
export function divider(options?: DividerOptions): string {
  const opts = { __proto__: null, ...options } as DividerOptions
  const { char = '═', width = 55 } = opts
  return repeatString(char, width)
}

/**
 * Print a divider line directly to console.
 *
 * @param options - Divider formatting options
 *
 * @example
 * ```ts
 * printDivider() // Prints default divider
 * printDivider({ char: '─', width: 60 })
 * ```
 */
export function printDivider(options?: DividerOptions): void {
  console.log(divider(options))
}

/**
 * Common divider style presets.
 * Provides quick access to popular divider styles.
 *
 * @example
 * ```ts
 * console.log(dividers.thick()) // ═══════...
 * console.log(dividers.thin())  // ───────...
 * console.log(dividers.dotted()) // ·······...
 * ```
 */
export const dividers = {
  /** Thick double-line divider using `═` */
  thick: () => divider({ char: '═' }),
  /** Thin single-line divider using `─` */
  thin: () => divider({ char: '─' }),
  /** Double-line divider (alias for thick) */
  double: () => divider({ char: '═' }),
  /** Simple single dash divider using `-` */
  single: () => divider({ char: '-' }),
  /** Dotted divider using `·` */
  dotted: () => divider({ char: '·' }),
  /** Dashed divider using `╌` */
  dashed: () => divider({ char: '╌' }),
  /** Wave divider using `~` */
  wave: () => divider({ char: '~' }),
  /** Star divider using `*` */
  star: () => divider({ char: '*' }),
  /** Diamond divider using `◆` */
  diamond: () => divider({ char: '◆' }),
  /** Arrow divider using `→` */
  arrow: () => divider({ char: '→' }),
} as const

/**
 * Print a thick divider line (default style).
 * Convenience function using `═` character.
 *
 * @example
 * ```ts
 * printThickDivider()
 * // ═══════════════════════════════════════════════════
 * ```
 */
export function printThickDivider(): void {
  printDivider({ char: '═' })
}

/**
 * Print a thin divider line.
 * Convenience function using `─` character.
 *
 * @example
 * ```ts
 * printThinDivider()
 * // ───────────────────────────────────────────────────
 * ```
 */
export function printThinDivider(): void {
  printDivider({ char: '─' })
}

/**
 * Print a dotted divider line.
 * Convenience function using `·` character.
 *
 * @example
 * ```ts
 * printDottedDivider()
 * // ·······················································
 * ```
 */
export function printDottedDivider(): void {
  printDivider({ char: '·' })
}

/**
 * Create a section break with blank lines before and after the divider.
 * Useful for creating visual separation between major sections.
 *
 * @param options - Divider formatting options
 * @returns Section break string with newlines
 *
 * @example
 * ```ts
 * console.log('Previous section')
 * console.log(sectionBreak())
 * console.log('Next section')
 * // Output:
 * // Previous section
 * //
 * // ═══════════════════════════════════════════════════
 * //
 * // Next section
 * ```
 */
export function sectionBreak(options?: DividerOptions): string {
  const div = divider(options)
  return `\n${div}\n`
}

/**
 * Print a section break with spacing directly to console.
 *
 * @param options - Divider formatting options
 *
 * @example
 * ```ts
 * console.log('Previous section')
 * printSectionBreak()
 * console.log('Next section')
 * ```
 */
export function printSectionBreak(options?: DividerOptions): void {
  console.log(sectionBreak(options))
}
