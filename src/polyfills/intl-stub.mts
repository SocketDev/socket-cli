/**
 * Intl Stub Implementation for --with-intl=none builds.
 *
 * When Node.js is compiled with `--with-intl=none`, the `Intl` global object
 * doesn't exist, causing ReferenceError crashes in any code that uses Intl APIs.
 * This polyfill provides minimal fallback implementations that:
 * - Prevent crashes by providing stub Intl APIs
 * - Return basic English-only formatting (ignore locale parameters)
 * - Add only ~2-5 KB to bundle size
 *
 * ## Why This is Needed
 *
 * Socket CLI uses Intl APIs in several places:
 * - `Intl.RelativeTimeFormat` in src/utils/home-cache-time.mts
 * - `String.localeCompare()` in src/utils/executable/build.mts (uses Intl internally)
 *
 * Dependencies may also use Intl APIs, so this polyfill ensures compatibility.
 *
 * ## Behavior Differences
 *
 * ### Real Intl (with ICU support):
 * ```javascript
 * new Intl.DateTimeFormat('fr-FR').format(new Date('2025-10-15'))
 * // "15/10/2025" (French format: day/month/year)
 *
 * new Intl.NumberFormat('de-DE').format(1234.56)
 * // "1.234,56" (German format: period for thousands, comma for decimal)
 * ```
 *
 * ### Stub Intl (without ICU):
 * ```javascript
 * new Intl.DateTimeFormat('fr-FR').format(new Date('2025-10-15'))
 * // "2025-10-15T00:00:00.000Z" (ISO-8601, ignores locale)
 *
 * new Intl.NumberFormat('de-DE').format(1234.56)
 * // "1234.56" (plain English format, ignores locale)
 * ```
 *
 * ## Trade-offs
 *
 * ✅ Advantages:
 * - Binary size reduction: -6-8 MB (ICU library removed)
 * - No crashes when Intl APIs are called
 * - Minimal overhead: ~2-5 KB stub code
 * - Acceptable for CLI tools (English-only output is fine)
 *
 * ⚠️ Limitations:
 * - All formatting is English-only (ignores locale parameter)
 * - Number/date formatting is simplified
 * - Collation is ASCII-based (no locale-aware sorting)
 * - Not suitable for internationalized user-facing applications
 *
 * @see .claude/intl-stub-implementation.md for detailed implementation notes
 */

'use strict'

if (typeof globalThis.Intl === 'undefined') {
  /**
   * Base class for all Intl stub implementations.
   * Accepts any constructor arguments but ignores them.
   */
  class IntlBase {
    constructor() {
      // Accept any arguments, ignore them.
    }
  }

  /**
   * Intl.DateTimeFormat stub - Formats dates as ISO-8601 strings.
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
  class DateTimeFormat extends IntlBase {
    locale: string
    options: Intl.DateTimeFormatOptions

    constructor(
      _locales?: string | string[],
      options?: Intl.DateTimeFormatOptions,
    ) {
      super()
      this.locale = 'en-US' // Always English.
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

  /**
   * Intl.NumberFormat stub - Formats numbers as plain strings.
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
  class NumberFormat extends IntlBase {
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
        // Simple currency format: $1,234.56
        return `${this.currency} ${number.toFixed(2)}`
      }
      if (this.style === 'percent') {
        return `${(number * 100).toFixed(0)}%`
      }
      // Default: plain number.
      return String(number)
    }

    formatToParts(number: number): Intl.NumberFormatPart[] {
      return [{ type: 'integer', value: this.format(number) }]
    }

    resolvedOptions(): Intl.ResolvedNumberFormatOptions {
      // Stub implementation with minimal required properties.
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

  /**
   * Intl.Collator stub - Simple ASCII string comparison.
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
   * May produce incorrect sort order for non-ASCII characters.
   */
  class Collator extends IntlBase {
    locale: string
    options: Intl.CollatorOptions

    constructor(_locales?: string | string[], options?: Intl.CollatorOptions) {
      super()
      this.locale = 'en-US'
      this.options = options || {}
    }

    compare(a: string, b: string): number {
      // Simple ASCII comparison (no locale rules).
      if (a < b) {return -1}
      if (a > b) {return 1}
      return 0
    }

    resolvedOptions(): Intl.ResolvedCollatorOptions {
      return {
        caseFirst: 'false' as 'false',
        collation: 'default',
        ignorePunctuation: false,
        locale: 'en-US',
        numeric: false,
        sensitivity: 'variant',
        usage: 'sort',
      }
    }
  }

  /**
   * Intl.PluralRules stub - Simple English plural rules.
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
   * Will not correctly pluralize in other languages.
   */
  class PluralRules extends IntlBase {
    locale: string

    constructor(_locales?: string | string[], _options?: Intl.PluralRulesOptions) {
      super()
      this.locale = 'en-US'
    }

    select(number: number): Intl.LDMLPluralRule {
      // Simple English plural rules.
      return number === 1 ? 'one' : 'other'
    }

    resolvedOptions(): Intl.ResolvedPluralRulesOptions {
      // Stub implementation with required numeric properties.
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

  /**
   * Intl.RelativeTimeFormat stub - Simple English relative time.
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
   * Used in Socket CLI's home-cache-time.mts for cache age display.
   */
  class RelativeTimeFormat extends IntlBase {
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

    format(
      value: number,
      unit: Intl.RelativeTimeFormatUnit,
    ): string {
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

  /**
   * Intl.ListFormat stub - English comma-separated lists.
   *
   * Real behavior:
   * - Formats lists according to locale-specific rules
   * - Example (Japanese): format(['a', 'b', 'c']) → "a、b、c" (uses 、 separator)
   *
   * Stub behavior:
   * - English format with "and": "a, b, and c"
   * - Always uses conjunction style with Oxford comma
   * - Example: format(['a', 'b']) → "a and b"
   * - Ignores all locale and type parameters
   *
   * Trade-off: English list format is standard and readable for CLI output.
   */
  class ListFormat extends IntlBase {
    locale: string
    type: string

    constructor(
      _locales?: string | string[],
      options?: Intl.ListFormatOptions,
    ) {
      super()
      this.locale = 'en-US'
      this.type = options?.type || 'conjunction'
    }

    format(list: string[]): string {
      if (!Array.isArray(list) || list.length === 0) {return ''}
      if (list.length === 1) {return String(list[0])}
      if (list.length === 2) {return `${list[0]} and ${list[1]}`}

      // 3+ items: "a, b, and c"
      const last = list[list.length - 1]
      const rest = list.slice(0, -1).join(', ')
      return `${rest}, and ${last}`
    }

    formatToParts(list: string[]): Array<{ type: 'element' | 'literal'; value: string }> {
      return [{ type: 'element', value: this.format(list) }]
    }

    resolvedOptions(): Intl.ResolvedListFormatOptions {
      return {
        locale: 'en-US',
        style: 'long',
        type: this.type as 'conjunction' | 'disjunction' | 'unit',
      }
    }
  }

  /**
   * Intl.DisplayNames stub - Returns input code without translation.
   *
   * Real behavior:
   * - Translates language/region/currency codes to localized names
   * - Example: of('US') with type 'region' → "United States" (in English)
   *
   * Stub behavior:
   * - Returns the input code unchanged (no translation database)
   * - Example: of('US') → "US"
   * - Ignores all locale and type parameters
   *
   * Trade-off: Codes are understandable without translation (e.g., "en-US", "USD").
   * Acceptable for CLI tools where codes are commonly used.
   */
  class DisplayNames extends IntlBase {
    locale: string
    type: string

    constructor(_locales: string | string[], options: Intl.DisplayNamesOptions) {
      super()
      this.locale = 'en-US'
      this.type = options?.type || 'language'
    }

    of(code: string): string | undefined {
      // Just return the code itself (no translation).
      return code
    }

    resolvedOptions(): Intl.ResolvedDisplayNamesOptions {
      return {
        fallback: 'code',
        locale: 'en-US',
        style: 'long',
        type: this.type as Intl.DisplayNamesType,
      }
    }
  }

  /**
   * Intl.Locale stub - Simple locale representation.
   *
   * Real behavior:
   * - Parses and canonicalizes locale identifiers
   * - Provides properties like language, region, script, etc.
   * - Example: new Intl.Locale('en-GB') → {language: 'en', region: 'GB'}
   *
   * Stub behavior:
   * - Always returns 'en-US' as the base name
   * - Provides minimal properties with defaults
   * - Ignores all options
   *
   * Trade-off: Simple locale representation is sufficient for CLI tools.
   */
  class Locale extends IntlBase {
    baseName: string
    language: string

    constructor(_tag?: string, _options?: Intl.LocaleOptions) {
      super()
      this.baseName = 'en-US'
      this.language = 'en'
    }

    override toString(): string {
      return this.baseName
    }
  }

  /**
   * Intl.Segmenter stub - Character-by-character segmentation.
   *
   * Real behavior:
   * - Segments text into grapheme clusters, words, or sentences
   * - Locale-aware (e.g., Thai has no spaces between words)
   * - Example (grapheme): segments "👨‍👩‍👧‍👦" → single segment (family emoji)
   *
   * Stub behavior:
   * - Simple character-by-character split
   * - No grapheme cluster awareness
   * - Example: segments "👨‍👩‍👧‍👦" → multiple segments (breaks emoji)
   * - Ignores all locale and granularity parameters
   *
   * Trade-off: Character-level split is sufficient for ASCII text.
   * Will incorrectly segment complex Unicode (emojis, combining characters).
   */
  class Segmenter extends IntlBase {
    granularity: string
    locale: string

    constructor(_locales?: string | string[], options?: Intl.SegmenterOptions) {
      super()
      this.locale = 'en-US'
      this.granularity = options?.granularity || 'grapheme'
    }

    segment(text: string): Intl.Segments {
      // Return iterable of segments (simplest: split by character).
      const segments: Intl.SegmentData[] = []
      for (let i = 0; i < text.length; i++) {
        segments.push({
          index: i,
          input: text,
          // Use non-null assertion since array access always returns string for valid indices.
          segment: text[i]!,
        })
      }
      return segments as unknown as Intl.Segments
    }

    resolvedOptions(): Intl.ResolvedSegmenterOptions {
      return {
        granularity: this.granularity as 'grapheme' | 'word' | 'sentence',
        locale: 'en-US',
      }
    }
  }

  // Create Intl global object.
  ;(globalThis as typeof globalThis & { Intl: typeof Intl }).Intl = {
    Collator: Collator as unknown as typeof Intl.Collator,
    DateTimeFormat: DateTimeFormat as unknown as typeof Intl.DateTimeFormat,
    DisplayNames: DisplayNames as unknown as typeof Intl.DisplayNames,
    ListFormat: ListFormat as unknown as typeof Intl.ListFormat,
    Locale: Locale as unknown as typeof Intl.Locale,
    NumberFormat: NumberFormat as unknown as typeof Intl.NumberFormat,
    PluralRules: PluralRules as unknown as typeof Intl.PluralRules,
    RelativeTimeFormat:
      RelativeTimeFormat as unknown as typeof Intl.RelativeTimeFormat,
    Segmenter: Segmenter as unknown as typeof Intl.Segmenter,

    // Static methods.
    getCanonicalLocales(locales?: string | readonly string[]): string[] {
      // Always return ['en-US'].
      if (Array.isArray(locales)) {
        return locales.length > 0 ? ['en-US'] : []
      }
      return locales ? ['en-US'] : []
    },

    supportedValuesOf(key: 'calendar' | 'collation' | 'currency' | 'numberingSystem' | 'timeZone' | 'unit'): string[] {
      // Return minimal support.
      const values: Record<string, string[]> = {
        calendar: ['gregory'],
        collation: ['default'],
        currency: ['USD'],
        numberingSystem: ['latn'],
        timeZone: ['UTC'],
        unit: ['meter', 'second', 'byte'],
      }
      return values[key] || []
    },
  }

  // Make it non-configurable like the real Intl.
  Object.defineProperty(globalThis, 'Intl', {
    configurable: false,
    enumerable: false,
    value: (
      globalThis as typeof globalThis & { Intl: typeof Intl }
    ).Intl,
    writable: false,
  })
}
