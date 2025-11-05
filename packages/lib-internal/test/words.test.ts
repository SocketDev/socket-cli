/**
 * @fileoverview Unit tests for English word manipulation utilities.
 *
 * Tests text transformation helpers for natural language:
 * - capitalize() capitalizes first letter of words
 * - pluralize() handles English pluralization rules (singular ↔ plural)
 * - determineArticle() chooses correct indefinite article (a/an)
 * - Special case handling: irregular plurals, acronyms, vowel sounds
 * Used by Socket CLI for grammatically correct user-facing messages.
 */

import {
  capitalize,
  determineArticle,
  pluralize,
} from '@socketsecurity/lib/words'
import { describe, expect, it } from 'vitest'

describe('words', () => {
  describe('capitalize', () => {
    it('should capitalize first letter of lowercase word', () => {
      expect(capitalize('hello')).toBe('Hello')
      expect(capitalize('world')).toBe('World')
    })

    it('should capitalize and lowercase rest of word', () => {
      expect(capitalize('HELLO')).toBe('Hello')
      expect(capitalize('wORLD')).toBe('World')
      expect(capitalize('MiXeD')).toBe('Mixed')
    })

    it('should handle single character', () => {
      expect(capitalize('a')).toBe('A')
      expect(capitalize('Z')).toBe('Z')
    })

    it('should handle empty string', () => {
      expect(capitalize('')).toBe('')
    })

    it('should handle words with numbers', () => {
      expect(capitalize('test123')).toBe('Test123')
      expect(capitalize('123test')).toBe('123test')
    })

    it('should handle words with special characters', () => {
      expect(capitalize('hello-world')).toBe('Hello-world')
      expect(capitalize('test_case')).toBe('Test_case')
      expect(capitalize('@special')).toBe('@special')
    })

    it('should handle unicode characters', () => {
      expect(capitalize('école')).toBe('École')
      expect(capitalize('ÉCOLE')).toBe('École')
      expect(capitalize('über')).toBe('Über')
    })

    it('should handle words with spaces', () => {
      expect(capitalize('hello world')).toBe('Hello world')
      expect(capitalize(' hello')).toBe(' hello')
    })

    it('should handle words with leading numbers', () => {
      expect(capitalize('2nd')).toBe('2nd')
      expect(capitalize('3rd')).toBe('3rd')
    })

    it('should handle emoji', () => {
      expect(capitalize('😀hello')).toBe('😀hello')
      expect(capitalize('hello😀')).toBe('Hello😀')
    })

    it('should handle already capitalized words', () => {
      expect(capitalize('Hello')).toBe('Hello')
      expect(capitalize('World')).toBe('World')
    })

    it('should handle two character words', () => {
      expect(capitalize('ab')).toBe('Ab')
      expect(capitalize('AB')).toBe('Ab')
      expect(capitalize('Ab')).toBe('Ab')
    })
  })

  describe('determineArticle', () => {
    it('should return "an" for words starting with vowels', () => {
      expect(determineArticle('apple')).toBe('an')
      expect(determineArticle('elephant')).toBe('an')
      expect(determineArticle('igloo')).toBe('an')
      expect(determineArticle('orange')).toBe('an')
      expect(determineArticle('umbrella')).toBe('an')
    })

    it('should return "a" for words starting with consonants', () => {
      expect(determineArticle('banana')).toBe('a')
      expect(determineArticle('cat')).toBe('a')
      expect(determineArticle('dog')).toBe('a')
      expect(determineArticle('table')).toBe('a')
      expect(determineArticle('zebra')).toBe('a')
    })

    it('should be case-sensitive (lowercase vowels)', () => {
      expect(determineArticle('Apple')).toBe('a')
      expect(determineArticle('Elephant')).toBe('a')
      expect(determineArticle('Orange')).toBe('a')
    })

    it('should handle uppercase vowels at start', () => {
      expect(determineArticle('apple')).toBe('an')
      expect(determineArticle('APPLE')).toBe('a')
    })

    it('should handle empty string', () => {
      expect(determineArticle('')).toBe('a')
    })

    it('should handle single vowel characters', () => {
      expect(determineArticle('a')).toBe('an')
      expect(determineArticle('e')).toBe('an')
      expect(determineArticle('i')).toBe('an')
      expect(determineArticle('o')).toBe('an')
      expect(determineArticle('u')).toBe('an')
    })

    it('should handle single consonant characters', () => {
      expect(determineArticle('b')).toBe('a')
      expect(determineArticle('x')).toBe('a')
      expect(determineArticle('z')).toBe('a')
    })

    it('should handle words with numbers', () => {
      expect(determineArticle('8ball')).toBe('a')
      expect(determineArticle('eleven')).toBe('an')
    })

    it('should handle special characters', () => {
      expect(determineArticle('@mention')).toBe('a')
      expect(determineArticle('#hashtag')).toBe('a')
      expect(determineArticle('_underscore')).toBe('a')
    })

    it('should not treat unicode vowels as vowels', () => {
      expect(determineArticle('école')).toBe('a')
      expect(determineArticle('über')).toBe('a')
    })

    it('should handle words with leading whitespace', () => {
      expect(determineArticle(' apple')).toBe('a')
      expect(determineArticle('\tapple')).toBe('a')
    })

    it('should handle y as consonant', () => {
      expect(determineArticle('yellow')).toBe('a')
      expect(determineArticle('yak')).toBe('a')
    })
  })

  describe('pluralize', () => {
    it('should return singular for count of 1', () => {
      expect(pluralize('item', { count: 1 })).toBe('item')
      expect(pluralize('word', { count: 1 })).toBe('word')
    })

    it('should return plural for count of 0', () => {
      expect(pluralize('item', { count: 0 })).toBe('items')
      expect(pluralize('word', { count: 0 })).toBe('words')
    })

    it('should return plural for count > 1', () => {
      expect(pluralize('item', { count: 2 })).toBe('items')
      expect(pluralize('item', { count: 5 })).toBe('items')
      expect(pluralize('item', { count: 100 })).toBe('items')
    })

    it('should return plural for negative counts', () => {
      expect(pluralize('item', { count: -1 })).toBe('items')
      expect(pluralize('item', { count: -5 })).toBe('items')
    })

    it('should return plural for decimal counts', () => {
      expect(pluralize('item', { count: 1.5 })).toBe('items')
      expect(pluralize('item', { count: 0.5 })).toBe('items')
      expect(pluralize('item', { count: 2.7 })).toBe('items')
    })

    it('should default to singular when no options provided', () => {
      expect(pluralize('item')).toBe('item')
      expect(pluralize('word')).toBe('word')
    })

    it('should default to singular when options provided but count not specified', () => {
      expect(pluralize('item', {})).toBe('item')
    })

    it('should handle empty string', () => {
      expect(pluralize('', { count: 1 })).toBe('')
      expect(pluralize('', { count: 2 })).toBe('s')
    })

    it('should add "s" to any word for pluralization', () => {
      expect(pluralize('cat', { count: 2 })).toBe('cats')
      expect(pluralize('dog', { count: 3 })).toBe('dogs')
      expect(pluralize('box', { count: 2 })).toBe('boxs')
      expect(pluralize('child', { count: 2 })).toBe('childs')
    })

    it('should handle words already ending in s', () => {
      expect(pluralize('glass', { count: 2 })).toBe('glasss')
      expect(pluralize('class', { count: 2 })).toBe('classs')
    })

    it('should handle single character words', () => {
      expect(pluralize('a', { count: 1 })).toBe('a')
      expect(pluralize('a', { count: 2 })).toBe('as')
    })

    it('should handle words with numbers', () => {
      expect(pluralize('test123', { count: 2 })).toBe('test123s')
      expect(pluralize('item1', { count: 3 })).toBe('item1s')
    })

    it('should handle words with special characters', () => {
      expect(pluralize('test-case', { count: 2 })).toBe('test-cases')
      expect(pluralize('file_name', { count: 2 })).toBe('file_names')
    })

    it('should handle unicode words', () => {
      expect(pluralize('café', { count: 2 })).toBe('cafés')
      expect(pluralize('naïve', { count: 2 })).toBe('naïves')
    })

    it('should handle count of exactly 1.0', () => {
      expect(pluralize('item', { count: 1.0 })).toBe('item')
    })

    it('should handle very large counts', () => {
      expect(pluralize('item', { count: 999_999 })).toBe('items')
      expect(pluralize('item', { count: Number.MAX_SAFE_INTEGER })).toBe(
        'items',
      )
    })

    it('should handle zero as explicit option', () => {
      expect(pluralize('error', { count: 0 })).toBe('errors')
      expect(pluralize('warning', { count: 0 })).toBe('warnings')
    })

    it('should handle undefined options', () => {
      expect(pluralize('item', undefined)).toBe('item')
    })

    it('should handle NaN count', () => {
      expect(pluralize('item', { count: Number.NaN })).toBe('items')
    })

    it('should handle Infinity', () => {
      expect(pluralize('item', { count: Number.POSITIVE_INFINITY })).toBe(
        'items',
      )
      expect(pluralize('item', { count: Number.NEGATIVE_INFINITY })).toBe(
        'items',
      )
    })
  })
})
