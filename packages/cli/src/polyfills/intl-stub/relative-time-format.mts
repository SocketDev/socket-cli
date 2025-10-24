/**
 * @fileoverview Intl.RelativeTimeFormat stub - Simple English relative time.
 *
 * Real behavior:
 * - Formats relative time according to locale-specific rules
 * - Example (Spanish): format(-3, 'day') → "hace 3 días"
 *
 * Stub behavior:
 * - Simple English format: "5 days ago" or "in 3 hours"
 * - Always uses long form with "s" for plural
 * - Example: format(-3, 'day') → "3 days ago"
 * - Ignores all locale and style parameters
 *
 * Trade-off: English-only format is acceptable for CLI time displays.
 */

import { IntlBase } from './base.mts'

export class RelativeTimeFormatStub extends IntlBase {
  locale: string
  numeric: string

  constructor(
    _locales?: string | string[],
    options?: Intl.RelativeTimeFormatOptions,
  ) {
    super()
    this.locale = 'en-US'
    this.numeric = options?.numeric || 'always'
  }

  format(value: number, unit: Intl.RelativeTimeFormatUnit): string {
    // Simple English relative time.
    const abs = Math.abs(value)
    const prefix = value < 0 ? '' : 'in '
    const suffix = value < 0 ? ' ago' : ''

    return `${prefix}${abs} ${unit}${abs !== 1 ? 's' : ''}${suffix}`
  }

  formatToParts(
    value: number,
    unit: Intl.RelativeTimeFormatUnit,
  ): Intl.RelativeTimeFormatPart[] {
    return [{ type: 'literal', value: this.format(value, unit) }]
  }

  resolvedOptions(): Intl.ResolvedRelativeTimeFormatOptions {
    return {
      locale: 'en-US',
      numberingSystem: 'latn',
      numeric: this.numeric as 'always' | 'auto',
      style: 'long',
    }
  }
}
