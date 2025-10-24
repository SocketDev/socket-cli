/**
 * @fileoverview Intl.PluralRules stub - Simple English plural rules.
 *
 * Real behavior:
 * - Returns plural category according to locale-specific rules
 * - Example (Arabic): select(3) → "few" (Arabic has 6 plural forms)
 *
 * Stub behavior:
 * - Simple English rules: "one" for 1, "other" for everything else
 * - Example: select(1) → "one", select(2) → "other"
 * - Ignores all locale parameters
 *
 * Trade-off: English-only plural rules are sufficient for CLI messages.
 */

import { IntlBase } from './base.mts'

export class PluralRulesStub extends IntlBase {
  locale: string

  constructor(
    _locales?: string | string[],
    _options?: Intl.PluralRulesOptions,
  ) {
    super()
    this.locale = 'en-US'
  }

  select(number: number): Intl.LDMLPluralRule {
    // Simple English plural rules.
    return number === 1 ? 'one' : 'other'
  }

  resolvedOptions(): Intl.ResolvedPluralRulesOptions {
    return {
      locale: 'en-US',
      maximumFractionDigits: 3,
      minimumFractionDigits: 0,
      minimumIntegerDigits: 1,
      pluralCategories: ['one', 'other'],
      type: 'cardinal',
    }
  }
}
