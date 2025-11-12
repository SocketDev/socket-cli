/**
 * @fileoverview Tests for Intl stub polyfill.
 *
 * These tests verify that the Intl stubs provide basic functionality
 * when Node.js is built with --with-intl=none.
 *
 * Tests import stub classes directly for reliable unit testing.
 */

import { describe, expect, it } from 'vitest'

import { CollatorStub } from '../../../src/polyfills/intl-stub/collator.mts'
import { DateTimeFormatStub } from '../../../src/polyfills/intl-stub/date-time-format.mts'
import { DisplayNamesStub } from '../../../src/polyfills/intl-stub/display-names.mts'
import {
  getCanonicalLocales,
  supportedValuesOf,
} from '../../../src/polyfills/intl-stub/helpers.mts'
import { ListFormatStub } from '../../../src/polyfills/intl-stub/list-format.mts'
import { LocaleStub } from '../../../src/polyfills/intl-stub/locale.mts'
import { NumberFormatStub } from '../../../src/polyfills/intl-stub/number-format.mts'
import { PluralRulesStub } from '../../../src/polyfills/intl-stub/plural-rules.mts'
import { RelativeTimeFormatStub } from '../../../src/polyfills/intl-stub/relative-time-format.mts'
import { SegmenterStub } from '../../../src/polyfills/intl-stub/segmenter.mts'

describe('Intl stub polyfill', () => {
  describe('DateTimeFormatStub', () => {
    it('should exist and be constructible', () => {
      const dtf = new DateTimeFormatStub()
      expect(dtf).toBeDefined()
    })

    it('should format dates as ISO-8601 strings', () => {
      const dtf = new DateTimeFormatStub('en-US')
      const date = new Date('2025-10-15T12:00:00.000Z')
      const result = dtf.format(date)

      expect(result).toBe('2025-10-15T12:00:00.000Z')
    })

    it('should ignore locale parameter', () => {
      const dtfEn = new DateTimeFormatStub('en-US')
      const dtfFr = new DateTimeFormatStub('fr-FR')
      const date = new Date('2025-10-15T12:00:00.000Z')

      expect(dtfEn.format(date)).toBe(dtfFr.format(date))
    })

    it('should handle date argument types', () => {
      const dtf = new DateTimeFormatStub()

      // Date object.
      expect(dtf.format(new Date('2025-10-15T00:00:00.000Z'))).toBe(
        '2025-10-15T00:00:00.000Z',
      )
      // Timestamp number.
      expect(dtf.format(1728950400000)).toContain('2024-10-15')
    })

    it('should provide formatToParts method', () => {
      const dtf = new DateTimeFormatStub()
      const date = new Date('2025-10-15T12:00:00.000Z')
      const parts = dtf.formatToParts(date)

      expect(Array.isArray(parts)).toBe(true)
      expect(parts[0]).toHaveProperty('type')
      expect(parts[0]).toHaveProperty('value')
    })

    it('should provide resolvedOptions method', () => {
      const dtf = new DateTimeFormatStub()
      const options = dtf.resolvedOptions()

      expect(options).toHaveProperty('locale', 'en-US')
      expect(options).toHaveProperty('timeZone', 'UTC')
    })
  })

  describe('NumberFormatStub', () => {
    it('should exist and be constructible', () => {
      const nf = new NumberFormatStub()
      expect(nf).toBeDefined()
    })

    it('should format numbers as plain strings', () => {
      const nf = new NumberFormatStub('en-US')
      expect(nf.format(1234.56)).toBe('1234.56')
    })

    it('should format currency with simple prefix', () => {
      const nf = new NumberFormatStub('en-US', {
        currency: 'USD',
        style: 'currency',
      })
      expect(nf.format(1234.56)).toBe('USD 1234.56')
    })

    it('should format percentages', () => {
      const nf = new NumberFormatStub('en-US', { style: 'percent' })
      expect(nf.format(0.95)).toBe('95%')
    })

    it('should ignore locale parameter', () => {
      const nfEn = new NumberFormatStub('en-US')
      const nfDe = new NumberFormatStub('de-DE')

      expect(nfEn.format(1234.56)).toBe(nfDe.format(1234.56))
    })

    it('should provide formatToParts method', () => {
      const nf = new NumberFormatStub()
      const parts = nf.formatToParts(1234)

      expect(Array.isArray(parts)).toBe(true)
      expect(parts[0]).toHaveProperty('type')
      expect(parts[0]).toHaveProperty('value')
    })

    it('should provide resolvedOptions method', () => {
      const nf = new NumberFormatStub()
      const options = nf.resolvedOptions()

      expect(options).toHaveProperty('locale', 'en-US')
      expect(options).toHaveProperty('style')
    })
  })

  describe('CollatorStub', () => {
    it('should exist and be constructible', () => {
      const col = new CollatorStub()
      expect(col).toBeDefined()
    })

    it('should compare strings with ASCII ordering', () => {
      const col = new CollatorStub('en-US')

      expect(col.compare('a', 'b')).toBeLessThan(0)
      expect(col.compare('b', 'a')).toBeGreaterThan(0)
      expect(col.compare('a', 'a')).toBe(0)
    })

    it('should handle case-sensitive comparison', () => {
      const col = new CollatorStub()

      expect(col.compare('A', 'a')).toBeLessThan(0)
    })

    it('should ignore locale parameter', () => {
      const colEn = new CollatorStub('en-US')
      const colSv = new CollatorStub('sv')

      expect(colEn.compare('z', 'ö')).toBe(colSv.compare('z', 'ö'))
    })

    it('should provide resolvedOptions method', () => {
      const col = new CollatorStub()
      const options = col.resolvedOptions()

      expect(options).toHaveProperty('locale', 'en-US')
      expect(options).toHaveProperty('usage', 'sort')
    })
  })

  describe('PluralRulesStub', () => {
    it('should exist and be constructible', () => {
      const pr = new PluralRulesStub()
      expect(pr).toBeDefined()
    })

    it('should return "one" for 1', () => {
      const pr = new PluralRulesStub('en-US')
      expect(pr.select(1)).toBe('one')
    })

    it('should return "other" for non-1 values', () => {
      const pr = new PluralRulesStub('en-US')

      expect(pr.select(0)).toBe('other')
      expect(pr.select(2)).toBe('other')
      expect(pr.select(100)).toBe('other')
    })

    it('should ignore locale parameter', () => {
      const prEn = new PluralRulesStub('en-US')
      const prAr = new PluralRulesStub('ar')

      expect(prEn.select(3)).toBe(prAr.select(3))
    })

    it('should provide resolvedOptions method', () => {
      const pr = new PluralRulesStub()
      const options = pr.resolvedOptions()

      expect(options).toHaveProperty('locale', 'en-US')
      expect(options).toHaveProperty('pluralCategories')
    })
  })

  describe('RelativeTimeFormatStub', () => {
    it('should exist and be constructible', () => {
      const rtf = new RelativeTimeFormatStub()
      expect(rtf).toBeDefined()
    })

    it('should format past time correctly', () => {
      const rtf = new RelativeTimeFormatStub('en-US')

      expect(rtf.format(-3, 'day')).toBe('3 days ago')
      expect(rtf.format(-1, 'hour')).toBe('1 hour ago')
    })

    it('should format future time correctly', () => {
      const rtf = new RelativeTimeFormatStub('en-US')

      expect(rtf.format(5, 'day')).toBe('in 5 days')
      expect(rtf.format(1, 'hour')).toBe('in 1 hour')
    })

    it('should provide formatToParts method', () => {
      const rtf = new RelativeTimeFormatStub()
      const parts = rtf.formatToParts(-3, 'day')

      expect(Array.isArray(parts)).toBe(true)
      expect(parts[0]).toHaveProperty('value')
    })

    it('should provide resolvedOptions method', () => {
      const rtf = new RelativeTimeFormatStub()
      const options = rtf.resolvedOptions()

      expect(options).toHaveProperty('locale', 'en-US')
      expect(options).toHaveProperty('numeric')
    })
  })

  describe('ListFormatStub', () => {
    it('should exist and be constructible', () => {
      const lf = new ListFormatStub()
      expect(lf).toBeDefined()
    })

    it('should format two-item lists', () => {
      const lf = new ListFormatStub('en-US')
      expect(lf.format(['a', 'b'])).toBe('a and b')
    })

    it('should format three-item lists with Oxford comma', () => {
      const lf = new ListFormatStub('en-US')
      expect(lf.format(['a', 'b', 'c'])).toBe('a, b, and c')
    })

    it('should handle single-item lists', () => {
      const lf = new ListFormatStub()
      expect(lf.format(['solo'])).toBe('solo')
    })

    it('should handle empty lists', () => {
      const lf = new ListFormatStub()
      expect(lf.format([])).toBe('')
    })

    it('should provide formatToParts method', () => {
      const lf = new ListFormatStub()
      const parts = lf.formatToParts(['a', 'b'])

      expect(Array.isArray(parts)).toBe(true)
    })

    it('should provide resolvedOptions method', () => {
      const lf = new ListFormatStub()
      const options = lf.resolvedOptions()

      expect(options).toHaveProperty('locale', 'en-US')
      expect(options).toHaveProperty('type')
    })
  })

  describe('DisplayNamesStub', () => {
    it('should exist and be constructible', () => {
      const dn = new DisplayNamesStub('en-US', { type: 'region' })
      expect(dn).toBeDefined()
    })

    it('should return input code unchanged', () => {
      const dn = new DisplayNamesStub('en-US', { type: 'region' })
      expect(dn.of('US')).toBe('US')
      expect(dn.of('GB')).toBe('GB')
    })

    it('should provide resolvedOptions method', () => {
      const dn = new DisplayNamesStub('en-US', { type: 'language' })
      const options = dn.resolvedOptions()

      expect(options).toHaveProperty('locale', 'en-US')
      expect(options).toHaveProperty('type')
    })
  })

  describe('LocaleStub', () => {
    it('should exist and be constructible', () => {
      const loc = new LocaleStub('en-GB')
      expect(loc).toBeDefined()
    })

    it('should always return en-US as baseName', () => {
      const loc = new LocaleStub('fr-FR')
      expect(loc.baseName).toBe('en-US')
    })

    it('should provide toString method', () => {
      const loc = new LocaleStub()
      expect(loc.toString()).toBe('en-US')
    })
  })

  describe('SegmenterStub', () => {
    it('should exist and be constructible', () => {
      const seg = new SegmenterStub()
      expect(seg).toBeDefined()
    })

    it('should segment text by character', () => {
      const seg = new SegmenterStub('en-US')
      const segments = seg.segment('abc')

      expect(Array.isArray(segments)).toBe(true)
      expect(segments).toHaveLength(3)
    })

    it('should provide resolvedOptions method', () => {
      const seg = new SegmenterStub()
      const options = seg.resolvedOptions()

      expect(options).toHaveProperty('locale', 'en-US')
      expect(options).toHaveProperty('granularity')
    })
  })

  describe('Helper functions', () => {
    it('getCanonicalLocales should return en-US', () => {
      expect(getCanonicalLocales('fr-FR')).toEqual(['en-US'])
      expect(getCanonicalLocales(['de-DE'])).toEqual(['en-US'])
      expect(getCanonicalLocales([])).toEqual([])
    })

    it('supportedValuesOf should return basic values', () => {
      expect(supportedValuesOf('calendar')).toContain('gregory')
      expect(supportedValuesOf('currency')).toContain('USD')
      expect(supportedValuesOf('timeZone')).toContain('UTC')
    })
  })
})
