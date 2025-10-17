if (typeof globalThis.Intl === 'undefined') {
  // Base class for all Intl implementations.
  class IntlBase {}

  // Intl.DateTimeFormat - Returns ISO-8601 strings.
  class DateTimeFormat extends IntlBase {
    constructor(_locales, options) {
      super()
      this.locale = 'en-US'
      this.options = options || {}
    }

    format(date) {
      const dateObj = date instanceof Date ? date : new Date(date || Date.now())
      return dateObj.toISOString()
    }

    formatToParts(date) {
      return [{ type: 'literal', value: this.format(date) }]
    }

    resolvedOptions() {
      return {
        calendar: 'gregory',
        locale: 'en-US',
        numberingSystem: 'latn',
        timeZone: 'UTC',
      }
    }
  }

  // Intl.NumberFormat - Plain number formatting.
  class NumberFormat extends IntlBase {
    constructor(_locales, options) {
      super()
      this.locale = 'en-US'
      this.options = options || {}
      this.style = options?.style || 'decimal'
      this.currency = options?.currency
    }

    format(number) {
      if (this.style === 'currency' && this.currency) {
        return `${this.currency} ${number.toFixed(2)}`
      }
      if (this.style === 'percent') {
        return `${(number * 100).toFixed(0)}%`
      }
      return String(number)
    }

    formatToParts(number) {
      return [{ type: 'integer', value: this.format(number) }]
    }

    resolvedOptions() {
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
        style: this.style,
        trailingZeroDisplay: 'auto',
        useGrouping: 'auto',
      }
    }
  }

  // Intl.Collator - ASCII string comparison.
  class Collator extends IntlBase {
    constructor(_locales, options) {
      super()
      this.locale = 'en-US'
      this.options = options || {}
    }

    compare(a, b) {
      if (a < b) return -1
      if (a > b) return 1
      return 0
    }

    resolvedOptions() {
      return {
        caseFirst: 'false',
        collation: 'default',
        ignorePunctuation: false,
        locale: 'en-US',
        numeric: false,
        sensitivity: 'variant',
        usage: 'sort',
      }
    }
  }

  // Intl.PluralRules - Simple English plural rules.
  class PluralRules extends IntlBase {
    constructor(_locales, _options) {
      super()
      this.locale = 'en-US'
    }

    select(number) {
      return number === 1 ? 'one' : 'other'
    }

    resolvedOptions() {
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

  // Intl.RelativeTimeFormat - English relative time.
  class RelativeTimeFormat extends IntlBase {
    constructor(_locales, options) {
      super()
      this.locale = 'en-US'
      this.numeric = options?.numeric || 'always'
    }

    format(value, unit) {
      const abs = Math.abs(value)
      const prefix = value < 0 ? '' : 'in '
      const suffix = value < 0 ? ' ago' : ''
      return `${prefix + abs} ${unit}${abs !== 1 ? 's' : ''}${suffix}`
    }

    formatToParts(value, unit) {
      return [{ type: 'literal', value: this.format(value, unit) }]
    }

    resolvedOptions() {
      return {
        locale: 'en-US',
        numberingSystem: 'latn',
        numeric: this.numeric,
        style: 'long',
      }
    }
  }

  // Intl.ListFormat - Comma-separated lists with "and".
  class ListFormat extends IntlBase {
    constructor(_locales, options) {
      super()
      this.locale = 'en-US'
      this.type = options?.type || 'conjunction'
    }

    format(list) {
      if (!Array.isArray(list) || list.length === 0) return ''
      if (list.length === 1) return String(list[0])
      if (list.length === 2) return `${list[0]} and ${list[1]}`

      const last = list[list.length - 1]
      const rest = list.slice(0, -1).join(', ')
      return `${rest}, and ${last}`
    }

    formatToParts(list) {
      return [{ type: 'element', value: this.format(list) }]
    }

    resolvedOptions() {
      return {
        locale: 'en-US',
        style: 'long',
        type: this.type,
      }
    }
  }

  // Intl.DisplayNames - Returns code unchanged.
  class DisplayNames extends IntlBase {
    constructor(_locales, options) {
      super()
      this.locale = 'en-US'
      this.type = options?.type || 'language'
    }

    of(code) {
      return code
    }

    resolvedOptions() {
      return {
        fallback: 'code',
        locale: 'en-US',
        style: 'long',
        type: this.type,
      }
    }
  }

  // Intl.Locale - Simple locale representation.
  class Locale extends IntlBase {
    constructor(_tag, _options) {
      super()
      this.baseName = 'en-US'
      this.language = 'en'
    }

    toString() {
      return this.baseName
    }
  }

  // Intl.Segmenter - Character-by-character segmentation.
  class Segmenter extends IntlBase {
    constructor(_locales, options) {
      super()
      this.locale = 'en-US'
      this.granularity = options?.granularity || 'grapheme'
    }

    segment(text) {
      const segments = []
      for (let i = 0; i < text.length; i++) {
        segments.push({
          index: i,
          input: text,
          segment: text[i],
        })
      }
      return segments
    }

    resolvedOptions() {
      return {
        granularity: this.granularity,
        locale: 'en-US',
      }
    }
  }

  // Create Intl global.
  globalThis.Intl = {
    Collator: Collator,
    DateTimeFormat: DateTimeFormat,
    DisplayNames: DisplayNames,
    ListFormat: ListFormat,
    Locale: Locale,
    NumberFormat: NumberFormat,
    PluralRules: PluralRules,
    RelativeTimeFormat: RelativeTimeFormat,
    Segmenter: Segmenter,

    getCanonicalLocales: locales => {
      if (Array.isArray(locales)) {
        return locales.length > 0 ? ['en-US'] : []
      }
      return locales ? ['en-US'] : []
    },

    supportedValuesOf: key => {
      const values = {
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

  // Also polyfill String.prototype.normalize if missing.
  if (typeof String.prototype.normalize === 'undefined') {
    String.prototype.normalize = function () {
      return this.toString()
    }
  }

  // Make Intl non-configurable like real Intl.
  Object.defineProperty(globalThis, 'Intl', {
    configurable: false,
    enumerable: false,
    value: globalThis.Intl,
    writable: false,
  })
}
