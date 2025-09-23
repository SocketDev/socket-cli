import { describe, expect, it } from 'vitest'

import { camelToKebab, kebabToCamel, pluralize } from './strings.mts'

describe('strings utilities', () => {
  describe('camelToKebab', () => {
    it('converts camelCase to kebab-case', () => {
      expect(camelToKebab('camelCase')).toBe('camel-case')
      expect(camelToKebab('myVariableName')).toBe('my-variable-name')
      expect(camelToKebab('APIToken')).toBe('apitoken')
    })

    it('handles single words', () => {
      expect(camelToKebab('word')).toBe('word')
      expect(camelToKebab('WORD')).toBe('word')
    })

    it('handles empty string', () => {
      expect(camelToKebab('')).toBe('')
    })

    it('handles already kebab-case', () => {
      expect(camelToKebab('already-kebab')).toBe('already-kebab')
    })

    it('handles numbers', () => {
      expect(camelToKebab('version2')).toBe('version2')
      expect(camelToKebab('v2Update')).toBe('v2update')
    })
  })

  describe('kebabToCamel', () => {
    it('converts kebab-case to camelCase', () => {
      expect(kebabToCamel('kebab-case')).toBe('kebabCase')
      expect(kebabToCamel('my-variable-name')).toBe('myVariableName')
    })

    it('handles single words', () => {
      expect(kebabToCamel('word')).toBe('word')
    })

    it('handles empty string', () => {
      expect(kebabToCamel('')).toBe('')
    })

    it('handles already camelCase', () => {
      expect(kebabToCamel('alreadyCamel')).toBe('alreadyCamel')
    })

    it('handles leading dashes', () => {
      expect(kebabToCamel('-leading')).toBe('Leading')
      expect(kebabToCamel('--double')).toBe('-Double')
    })

    it('handles trailing dashes', () => {
      expect(kebabToCamel('trailing-')).toBe('trailing-')
    })
  })

  describe('pluralize', () => {
    it('returns singular for count of 1', () => {
      expect(pluralize('item', 1)).toBe('item')
      expect(pluralize('package', 1)).toBe('package')
    })

    it('returns plural for count of 0', () => {
      expect(pluralize('item', 0)).toBe('items')
      expect(pluralize('package', 0)).toBe('packages')
    })

    it('returns plural for count > 1', () => {
      expect(pluralize('item', 2)).toBe('items')
      expect(pluralize('package', 10)).toBe('packages')
    })

    it('handles negative counts as plural', () => {
      expect(pluralize('item', -1)).toBe('items')
      expect(pluralize('item', -5)).toBe('items')
    })

    it('handles custom plural form', () => {
      expect(pluralize('child', 2, 'children')).toBe('children')
      expect(pluralize('person', 3, 'people')).toBe('people')
      expect(pluralize('datum', 0, 'data')).toBe('data')
    })

    it('handles custom plural with count of 1', () => {
      expect(pluralize('child', 1, 'children')).toBe('child')
      expect(pluralize('person', 1, 'people')).toBe('person')
    })
  })
})
