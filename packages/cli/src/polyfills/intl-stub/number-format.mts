/**
 * @fileoverview Intl.NumberFormat stub - Formats numbers as plain strings.
 *
 * Real behavior:
 * - Formats numbers with locale-specific decimal/thousands separators
 * - Example: new Intl.NumberFormat('de-DE').format(1234.56) → "1.234,56"
 *
 * Stub behavior:
 * - Returns plain number string with basic formatting
 * - Currency: "USD 1234.56" (simple prefix)
 * - Percent: "95%" (simple percentage)
 * - Default: "1234.56" (plain number)
 * - Ignores all locale parameters
 *
 * Trade-off: Simplified formatting is readable and acceptable for CLI output.
 */

import { IntlBase } from './base.mts'

export class NumberFormatStub extends IntlBase {
  currency: string | undefined
  locale: string
  options: Intl.NumberFormatOptions
  style: string

  constructor(
    _locales?: string | string[],
    options?: Intl.NumberFormatOptions,
  ) {
    super()
    this.locale = 'en-US'
    this.options = options || {}
    this.style = options?.style || 'decimal'
    this.currency = options?.currency
  }

  format(number: number): string {
    // Basic formatting without locale rules.
    if (this.style === 'currency' && this.currency) {
      return `${this.currency} ${number.toFixed(2)}`
    }
    if (this.style === 'percent') {
      return `${(number * 100).toFixed(0)}%`
    }
    return String(number)
  }

  formatToParts(number: number): Intl.NumberFormatPart[] {
    return [{ type: 'integer', value: this.format(number) }]
  }

  resolvedOptions(): Intl.ResolvedNumberFormatOptions {
    return {
      compactDisplay: 'short',
      currency: this.currency,
      currencyDisplay: 'symbol',
      currencySign: 'standard',
      locale: 'en-US',
      maximumFractionDigits: 3,
      maximumSignificantDigits: 21,
      minimumFractionDigits: 0,
      minimumIntegerDigits: 1,
      minimumSignificantDigits: 1,
      notation: 'standard',
      numberingSystem: 'latn',
      roundingIncrement: 1,
      roundingMode: 'halfExpand',
      roundingPriority: 'auto',
      signDisplay: 'auto',
      style: this.style as 'decimal' | 'currency' | 'percent' | 'unit',
      trailingZeroDisplay: 'auto',
      useGrouping: 'auto',
    } as Intl.ResolvedNumberFormatOptions
  }
}
