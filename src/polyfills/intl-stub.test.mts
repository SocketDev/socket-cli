/**
 * Unit tests for Intl stub polyfill.
 *
 * These tests verify that the Intl stub provides basic functionality
 * when Node.js is built with --with-intl=none.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

describe('Intl stub polyfill', () => {
  let originalIntl: typeof Intl | undefined

  beforeEach(() => {
    // Save original Intl (if it exists).
    originalIntl = globalThis.Intl

    // Delete Intl to simulate --with-intl=none build.
    // @ts-expect-error - Intentionally deleting Intl for testing.
    delete globalThis.Intl

    // Re-import the polyfill to activate it.
    // This is a workaround since the polyfill checks `typeof Intl === 'undefined'`.
    // In a real --with-intl=none build, this check would pass automatically.
    void import('./intl-stub.mts')
  })

  afterEach(() => {
    // Restore original Intl.
    if (originalIntl) {
      // @ts-expect-error - Restoring Intl after test.
      globalThis.Intl = originalIntl
    }
  })

  describe('Intl.DateTimeFormat', () => {
    it('should exist and be constructible', () => {
      expect(typeof Intl.DateTimeFormat).toBe('function')
      const dtf = new Intl.DateTimeFormat()
      expect(dtf).toBeDefined()
    })

    it('should format dates as ISO-8601 strings', () => {
      const dtf = new Intl.DateTimeFormat('en-US')
      const date = new Date('2025-10-15T12:00:00.000Z')
      const result = dtf.format(date)

      expect(result).toBe('2025-10-15T12:00:00.000Z')
    })

    it('should ignore locale parameter', () => {
      const dtfEn = new Intl.DateTimeFormat('en-US')
      const dtfFr = new Intl.DateTimeFormat('fr-FR')
      const dtfJa = new Intl.DateTimeFormat('ja-JP')
      const date = new Date('2025-10-15T12:00:00.000Z')

      // All should return same ISO-8601 format.
      expect(dtfEn.format(date)).toBe(dtfFr.format(date))
      expect(dtfFr.format(date)).toBe(dtfJa.format(date))
    })

    it('should handle date argument types', () => {
      const dtf = new Intl.DateTimeFormat()

      // Date object.
      expect(dtf.format(new Date('2025-10-15T00:00:00.000Z'))).toContain(
        '2025-10-15',
      )

      // Timestamp number.
      expect(dtf.format(1729036800000)).toContain('2024-10-16')

      // Undefined (current date).
      expect(dtf.format()).toMatch(
        /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/,
      )
    })

    it('should provide formatToParts method', () => {
      const dtf = new Intl.DateTimeFormat()
      const date = new Date('2025-10-15T12:00:00.000Z')
      const parts = dtf.formatToParts(date)

      expect(Array.isArray(parts)).toBe(true)
      expect(parts).toHaveLength(1)
      expect(parts[0]).toEqual({
        type: 'literal',
        value: '2025-10-15T12:00:00.000Z',
      })
    })

    it('should provide resolvedOptions method', () => {
      const dtf = new Intl.DateTimeFormat()
      const options = dtf.resolvedOptions()

      expect(options).toEqual({
        calendar: 'gregory',
        locale: 'en-US',
        numberingSystem: 'latn',
        timeZone: 'UTC',
      })
    })
  })

  describe('Intl.NumberFormat', () => {
    it('should exist and be constructible', () => {
      expect(typeof Intl.NumberFormat).toBe('function')
      const nf = new Intl.NumberFormat()
      expect(nf).toBeDefined()
    })

    it('should format numbers as plain strings', () => {
      const nf = new Intl.NumberFormat('en-US')
      expect(nf.format(1234.56)).toBe('1234.56')
      expect(nf.format(42)).toBe('42')
    })

    it('should format currency with simple prefix', () => {
      const nf = new Intl.NumberFormat('en-US', {
        currency: 'USD',
        style: 'currency',
      })
      expect(nf.format(1234.56)).toBe('USD 1234.56')
    })

    it('should format percentages', () => {
      const nf = new Intl.NumberFormat('en-US', {
        style: 'percent',
      })
      expect(nf.format(0.95)).toBe('95%')
      expect(nf.format(0.5)).toBe('50%')
    })

    it('should ignore locale parameter', () => {
      const nfEn = new Intl.NumberFormat('en-US')
      const nfDe = new Intl.NumberFormat('de-DE')

      // Both should return same plain format.
      expect(nfEn.format(1234.56)).toBe('1234.56')
      expect(nfDe.format(1234.56)).toBe('1234.56')
    })

    it('should provide formatToParts method', () => {
      const nf = new Intl.NumberFormat()
      const parts = nf.formatToParts(1234.56)

      expect(Array.isArray(parts)).toBe(true)
      expect(parts).toHaveLength(1)
      expect(parts[0]).toEqual({
        type: 'integer',
        value: '1234.56',
      })
    })

    it('should provide resolvedOptions method', () => {
      const nf = new Intl.NumberFormat('en-US', {
        currency: 'USD',
        style: 'currency',
      })
      const options = nf.resolvedOptions()

      expect(options).toMatchObject({
        currency: 'USD',
        locale: 'en-US',
        numberingSystem: 'latn',
        style: 'currency',
      })
    })
  })

  describe('Intl.Collator', () => {
    it('should exist and be constructible', () => {
      expect(typeof Intl.Collator).toBe('function')
      const collator = new Intl.Collator()
      expect(collator).toBeDefined()
    })

    it('should compare strings with ASCII ordering', () => {
      const collator = new Intl.Collator()

      expect(collator.compare('a', 'b')).toBe(-1)
      expect(collator.compare('b', 'a')).toBe(1)
      expect(collator.compare('a', 'a')).toBe(0)
    })

    it('should handle case-sensitive comparison', () => {
      const collator = new Intl.Collator()

      expect(collator.compare('A', 'a')).toBe(-1) // ASCII: A < a.
      expect(collator.compare('Z', 'a')).toBe(-1) // ASCII: Z < a.
    })

    it('should ignore locale parameter', () => {
      const collatorEn = new Intl.Collator('en-US')
      const collatorSv = new Intl.Collator('sv')

      // Both should use ASCII comparison.
      expect(collatorEn.compare('z', 'ö')).toBe(collatorSv.compare('z', 'ö'))
    })

    it('should provide resolvedOptions method', () => {
      const collator = new Intl.Collator()
      const options = collator.resolvedOptions()

      expect(options).toEqual({
        caseFirst: 'false',
        collation: 'default',
        ignorePunctuation: false,
        locale: 'en-US',
        numeric: false,
        sensitivity: 'variant',
        usage: 'sort',
      })
    })
  })

  describe('Intl.PluralRules', () => {
    it('should exist and be constructible', () => {
      expect(typeof Intl.PluralRules).toBe('function')
      const pr = new Intl.PluralRules()
      expect(pr).toBeDefined()
    })

    it('should return "one" for 1', () => {
      const pr = new Intl.PluralRules()
      expect(pr.select(1)).toBe('one')
    })

    it('should return "other" for non-1 values', () => {
      const pr = new Intl.PluralRules()
      expect(pr.select(0)).toBe('other')
      expect(pr.select(2)).toBe('other')
      expect(pr.select(42)).toBe('other')
      expect(pr.select(1.5)).toBe('other')
    })

    it('should ignore locale parameter', () => {
      const prEn = new Intl.PluralRules('en-US')
      const prAr = new Intl.PluralRules('ar')

      // Both should use English rules.
      expect(prEn.select(3)).toBe('other')
      expect(prAr.select(3)).toBe('other') // Arabic would normally return "few".
    })

    it('should provide resolvedOptions method', () => {
      const pr = new Intl.PluralRules()
      const options = pr.resolvedOptions()

      expect(options).toMatchObject({
        locale: 'en-US',
        pluralCategories: ['one', 'other'],
        type: 'cardinal',
      })
    })
  })

  describe('Intl.RelativeTimeFormat', () => {
    it('should exist and be constructible', () => {
      expect(typeof Intl.RelativeTimeFormat).toBe('function')
      const rtf = new Intl.RelativeTimeFormat()
      expect(rtf).toBeDefined()
    })

    it('should format past times with "ago"', () => {
      const rtf = new Intl.RelativeTimeFormat('en')
      expect(rtf.format(-1, 'day')).toBe('1 day ago')
      expect(rtf.format(-5, 'hour')).toBe('5 hours ago')
      expect(rtf.format(-1, 'second')).toBe('1 second ago')
    })

    it('should format future times with "in"', () => {
      const rtf = new Intl.RelativeTimeFormat('en')
      expect(rtf.format(1, 'day')).toBe('in 1 day')
      expect(rtf.format(5, 'hour')).toBe('in 5 hours')
      expect(rtf.format(10, 'minute')).toBe('in 10 minutes')
    })

    it('should handle singular vs plural', () => {
      const rtf = new Intl.RelativeTimeFormat('en')
      expect(rtf.format(-1, 'day')).toBe('1 day ago')
      expect(rtf.format(-2, 'day')).toBe('2 days ago')
    })

    it('should handle zero', () => {
      const rtf = new Intl.RelativeTimeFormat('en')
      expect(rtf.format(0, 'day')).toBe('in 0 days')
    })

    it('should ignore locale parameter', () => {
      const rtfEn = new Intl.RelativeTimeFormat('en')
      const rtfEs = new Intl.RelativeTimeFormat('es')

      // Both should return English format.
      expect(rtfEn.format(-3, 'day')).toBe('3 days ago')
      expect(rtfEs.format(-3, 'day')).toBe('3 days ago')
    })

    it('should provide formatToParts method', () => {
      const rtf = new Intl.RelativeTimeFormat('en')
      const parts = rtf.formatToParts(-5, 'day')

      expect(Array.isArray(parts)).toBe(true)
      expect(parts).toHaveLength(1)
      expect(parts[0]).toEqual({
        type: 'literal',
        value: '5 days ago',
      })
    })

    it('should provide resolvedOptions method', () => {
      const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'always' })
      const options = rtf.resolvedOptions()

      expect(options).toMatchObject({
        locale: 'en-US',
        numeric: 'always',
        style: 'long',
      })
    })
  })

  describe('Intl.ListFormat', () => {
    it('should exist and be constructible', () => {
      expect(typeof Intl.ListFormat).toBe('function')
      const lf = new Intl.ListFormat()
      expect(lf).toBeDefined()
    })

    it('should format empty list', () => {
      const lf = new Intl.ListFormat()
      expect(lf.format([])).toBe('')
    })

    it('should format single item', () => {
      const lf = new Intl.ListFormat()
      expect(lf.format(['apple'])).toBe('apple')
    })

    it('should format two items with "and"', () => {
      const lf = new Intl.ListFormat()
      expect(lf.format(['apple', 'banana'])).toBe('apple and banana')
    })

    it('should format three+ items with Oxford comma', () => {
      const lf = new Intl.ListFormat()
      expect(lf.format(['apple', 'banana', 'cherry'])).toBe(
        'apple, banana, and cherry',
      )
      expect(lf.format(['a', 'b', 'c', 'd'])).toBe('a, b, c, and d')
    })

    it('should ignore locale parameter', () => {
      const lfEn = new Intl.ListFormat('en')
      const lfJa = new Intl.ListFormat('ja')

      // Both should return English format.
      const items = ['a', 'b', 'c']
      expect(lfEn.format(items)).toBe('a, b, and c')
      expect(lfJa.format(items)).toBe('a, b, and c')
    })

    it('should provide formatToParts method', () => {
      const lf = new Intl.ListFormat()
      const parts = lf.formatToParts(['a', 'b'])

      expect(Array.isArray(parts)).toBe(true)
      expect(parts).toHaveLength(1)
      expect(parts[0]).toEqual({
        type: 'element',
        value: 'a and b',
      })
    })

    it('should provide resolvedOptions method', () => {
      const lf = new Intl.ListFormat()
      const options = lf.resolvedOptions()

      expect(options).toMatchObject({
        locale: 'en-US',
        style: 'long',
        type: 'conjunction',
      })
    })
  })

  describe('Intl.DisplayNames', () => {
    it('should exist and be constructible', () => {
      expect(typeof Intl.DisplayNames).toBe('function')
      const dn = new Intl.DisplayNames('en', { type: 'language' })
      expect(dn).toBeDefined()
    })

    it('should return input code unchanged', () => {
      const dn = new Intl.DisplayNames('en', { type: 'language' })
      expect(dn.of('en-US')).toBe('en-US')
      expect(dn.of('fr')).toBe('fr')
    })

    it('should work with different types', () => {
      const dnLang = new Intl.DisplayNames('en', { type: 'language' })
      const dnRegion = new Intl.DisplayNames('en', { type: 'region' })
      const dnCurrency = new Intl.DisplayNames('en', { type: 'currency' })

      expect(dnLang.of('en')).toBe('en')
      expect(dnRegion.of('US')).toBe('US')
      expect(dnCurrency.of('USD')).toBe('USD')
    })

    it('should ignore locale parameter', () => {
      const dnEn = new Intl.DisplayNames('en', { type: 'region' })
      const dnFr = new Intl.DisplayNames('fr', { type: 'region' })

      // Both should return the code unchanged.
      expect(dnEn.of('US')).toBe('US')
      expect(dnFr.of('US')).toBe('US')
    })

    it('should provide resolvedOptions method', () => {
      const dn = new Intl.DisplayNames('en', { type: 'language' })
      const options = dn.resolvedOptions()

      expect(options).toMatchObject({
        fallback: 'code',
        locale: 'en-US',
        type: 'language',
      })
    })
  })

  describe('Intl.Segmenter', () => {
    it('should exist and be constructible', () => {
      expect(typeof Intl.Segmenter).toBe('function')
      const segmenter = new Intl.Segmenter()
      expect(segmenter).toBeDefined()
    })

    it('should segment text character-by-character', () => {
      const segmenter = new Intl.Segmenter()
      const segments = segmenter.segment('abc')

      expect(Array.isArray(segments)).toBe(true)
      expect(segments).toHaveLength(3)
      expect(segments[0]).toEqual({
        index: 0,
        input: 'abc',
        segment: 'a',
      })
      expect(segments[1]).toEqual({
        index: 1,
        input: 'abc',
        segment: 'b',
      })
      expect(segments[2]).toEqual({
        index: 2,
        input: 'abc',
        segment: 'c',
      })
    })

    it('should handle empty string', () => {
      const segmenter = new Intl.Segmenter()
      const segments = segmenter.segment('')

      expect(segments).toHaveLength(0)
    })

    it('should ignore locale parameter', () => {
      const segmenterEn = new Intl.Segmenter('en')
      const segmenterTh = new Intl.Segmenter('th')

      // Both should segment character-by-character.
      expect(segmenterEn.segment('ab')).toHaveLength(2)
      expect(segmenterTh.segment('ab')).toHaveLength(2)
    })

    it('should provide resolvedOptions method', () => {
      const segmenter = new Intl.Segmenter('en', { granularity: 'word' })
      const options = segmenter.resolvedOptions()

      expect(options).toMatchObject({
        granularity: 'word',
        locale: 'en-US',
      })
    })
  })

  describe('Intl static methods', () => {
    it('should provide getCanonicalLocales', () => {
      expect(typeof Intl.getCanonicalLocales).toBe('function')

      expect(Intl.getCanonicalLocales('en-US')).toEqual(['en-US'])
      expect(Intl.getCanonicalLocales(['fr', 'de'])).toEqual(['en-US'])
      expect(Intl.getCanonicalLocales([])).toEqual([])
    })

    it('should provide supportedValuesOf', () => {
      expect(typeof Intl.supportedValuesOf).toBe('function')

      expect(Intl.supportedValuesOf('calendar')).toEqual(['gregory'])
      expect(Intl.supportedValuesOf('collation')).toEqual(['default'])
      expect(Intl.supportedValuesOf('currency')).toEqual(['USD'])
      expect(Intl.supportedValuesOf('numberingSystem')).toEqual(['latn'])
      expect(Intl.supportedValuesOf('timeZone')).toEqual(['UTC'])
      expect(Intl.supportedValuesOf('unit')).toEqual([
        'meter',
        'second',
        'byte',
      ])
    })

    it('should return empty array for unknown keys', () => {
      expect(Intl.supportedValuesOf('unknown' as never)).toEqual([])
    })
  })

  describe('Intl object properties', () => {
    it('should be non-configurable', () => {
      const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Intl')

      expect(descriptor?.configurable).toBe(false)
      expect(descriptor?.enumerable).toBe(false)
      expect(descriptor?.writable).toBe(false)
    })

    it('should have all expected classes', () => {
      expect(Intl.DateTimeFormat).toBeDefined()
      expect(Intl.NumberFormat).toBeDefined()
      expect(Intl.Collator).toBeDefined()
      expect(Intl.PluralRules).toBeDefined()
      expect(Intl.RelativeTimeFormat).toBeDefined()
      expect(Intl.ListFormat).toBeDefined()
      expect(Intl.DisplayNames).toBeDefined()
      expect(Intl.Segmenter).toBeDefined()
    })
  })
})
