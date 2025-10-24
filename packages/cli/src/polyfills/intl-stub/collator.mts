/**
 * @fileoverview Intl.Collator stub - Simple ASCII string comparison.
 *
 * Real behavior:
 * - Compares strings according to locale-specific rules
 * - Example (Swedish): new Intl.Collator('sv').compare('z', 'ö') → -1 (ö comes after z)
 *
 * Stub behavior:
 * - Simple ASCII comparison (no locale awareness)
 * - Example: compare('z', 'ö') → 1 (z < ö in ASCII)
 * - Ignores all locale and sensitivity options
 *
 * Trade-off: ASCII comparison is sufficient for English-only CLI tools.
 */

import { IntlBase } from './base.mts'

export class CollatorStub extends IntlBase {
  locale: string
  options: Intl.CollatorOptions

  constructor(_locales?: string | string[], options?: Intl.CollatorOptions) {
    super()
    this.locale = 'en-US'
    this.options = options || {}
  }

  compare(a: string, b: string): number {
    // Simple ASCII comparison (no locale rules).
    if (a < b) {
      return -1
    }
    if (a > b) {
      return 1
    }
    return 0
  }

  resolvedOptions(): Intl.ResolvedCollatorOptions {
    return {
      caseFirst: 'false' as const,
      collation: 'default',
      ignorePunctuation: false,
      locale: 'en-US',
      numeric: false,
      sensitivity: 'variant',
      usage: 'sort',
    }
  }
}
