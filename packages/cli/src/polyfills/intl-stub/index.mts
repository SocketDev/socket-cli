/**
 * @fileoverview Intl stub polyfill - Install all Intl stubs if Intl is missing.
 *
 * This module installs minimal Intl stubs when Node.js is built with --with-intl=none.
 * It provides basic internationalization functionality sufficient for CLI tools.
 */

export { CollatorStub } from './collator.mts'
export { DateTimeFormatStub } from './date-time-format.mts'
export { DisplayNamesStub } from './display-names.mts'
export { ListFormatStub } from './list-format.mts'
export { LocaleStub } from './locale.mts'
export { NumberFormatStub } from './number-format.mts'
export { PluralRulesStub } from './plural-rules.mts'
export { RelativeTimeFormatStub } from './relative-time-format.mts'
export { SegmenterStub } from './segmenter.mts'

import { CollatorStub } from './collator.mts'
import { DateTimeFormatStub } from './date-time-format.mts'
import { DisplayNamesStub } from './display-names.mts'
import { getCanonicalLocales, supportedValuesOf } from './helpers.mts'
import { ListFormatStub } from './list-format.mts'
import { LocaleStub } from './locale.mts'
import { NumberFormatStub } from './number-format.mts'
import { PluralRulesStub } from './plural-rules.mts'
import { RelativeTimeFormatStub } from './relative-time-format.mts'
import { SegmenterStub } from './segmenter.mts'

/**
 * Install Intl stubs globally if Intl is not defined.
 * This happens automatically when this module is imported.
 */
if (typeof globalThis.Intl === 'undefined') {
  // Create Intl global object with all stubs.
  ;(globalThis as typeof globalThis & { Intl: typeof Intl }).Intl = {
    Collator: CollatorStub as unknown as typeof Intl.Collator,
    DateTimeFormat: DateTimeFormatStub as unknown as typeof Intl.DateTimeFormat,
    DisplayNames: DisplayNamesStub as unknown as typeof Intl.DisplayNames,
    ListFormat: ListFormatStub as unknown as typeof Intl.ListFormat,
    Locale: LocaleStub as unknown as typeof Intl.Locale,
    NumberFormat: NumberFormatStub as unknown as typeof Intl.NumberFormat,
    PluralRules: PluralRulesStub as unknown as typeof Intl.PluralRules,
    RelativeTimeFormat:
      RelativeTimeFormatStub as unknown as typeof Intl.RelativeTimeFormat,
    Segmenter: SegmenterStub as unknown as typeof Intl.Segmenter,

    // Static methods.
    getCanonicalLocales,
    supportedValuesOf,
  }

  // Make it non-configurable like the real Intl.
  Object.defineProperty(globalThis, 'Intl', {
    configurable: false,
    enumerable: false,
    value: (globalThis as typeof globalThis & { Intl: typeof Intl }).Intl,
    writable: false,
  })
}
