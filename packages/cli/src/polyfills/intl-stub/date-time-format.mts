/**
 * @fileoverview Intl.DateTimeFormat stub - Formats dates as ISO-8601 strings.
 *
 * Real behavior:
 * - Formats dates according to locale-specific rules
 * - Example: new Intl.DateTimeFormat('fr-FR').format(date) → "15/10/2025"
 *
 * Stub behavior:
 * - Always returns ISO-8601 format (YYYY-MM-DDTHH:mm:ss.sssZ)
 * - Ignores all locale parameters
 * - Example: new Intl.DateTimeFormat('fr-FR').format(date) → "2025-10-15T00:00:00.000Z"
 *
 * Trade-off: ISO-8601 is universal and unambiguous, suitable for CLI logging.
 */

import { IntlBase } from './base.mts'

export class DateTimeFormatStub extends IntlBase {
  locale: string
  options: Intl.DateTimeFormatOptions

  constructor(
    _locales?: string | string[],
    options?: Intl.DateTimeFormatOptions,
  ) {
    super()
    this.locale = 'en-US'
    this.options = options || {}
  }

  format(date?: Date | number): string {
    // Return ISO-8601 format (universal, locale-independent).
    if (!(date instanceof Date)) {
      date = new Date(date || Date.now())
    }
    return date.toISOString()
  }

  formatToParts(date?: Date | number): Intl.DateTimeFormatPart[] {
    // Return minimal parts array.
    return [{ type: 'literal', value: this.format(date) }]
  }

  resolvedOptions(): Intl.ResolvedDateTimeFormatOptions {
    return {
      calendar: 'gregory',
      locale: 'en-US',
      numberingSystem: 'latn',
      timeZone: 'UTC',
    }
  }
}
