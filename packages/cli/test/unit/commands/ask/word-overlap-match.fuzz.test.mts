/**
 * @file Property/fuzz tests for commands/ask/word-overlap-match (Tier-1
 *   fast-check).
 *   Two pure functions from the `socket ask` fast path:
 *
 *   - `extractWords(text)`: lowercase, strip non-word/space/hyphen chars, split
 *     on whitespace, keep tokens of length > 2. Contract: never throws; every
 *     emitted token is lowercase, length > 2, and drawn only from word
 *     characters and `-`.
 *   - `wordOverlap(querySet, commandWords)`: Jaccard similarity. Contract: result
 *     in [0, 1]; symmetric in its two operands; 1 for a non-empty set against
 *     itself; 0 whenever the query set is empty or the operands are disjoint.
 *     The symmetry check compares two SUT calls, so both sides are computed
 *     into variables before the assertion (never a src call inside expect()).
 */

import fc from 'fast-check'
import { describe, expect, test } from 'vitest'

import {
  extractWords,
  wordOverlap,
} from '../../../../src/commands/ask/word-overlap-match.mts'

// A token guaranteed to survive extractWords verbatim: lowercase word chars
// (a-z, 0-9, _) plus `-`, length >= 3 so it clears the length filter. Built so
// the tokenization outcome is knowable without reimplementing the SUT.
const WORD_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789_-'

const keepableWord = fc
  .array(fc.constantFrom(...WORD_CHARS), { minLength: 3, maxLength: 12 })
  .map(chars => chars.join(''))

// A short lowercase token (length 1..2) that extractWords always drops.
const droppedWord = fc
  .array(fc.constantFrom(...WORD_CHARS), { minLength: 1, maxLength: 2 })
  .map(chars => chars.join(''))

describe('commands/ask/word-overlap-match (fuzz)', () => {
  // INVARIANT + never-throws: extractWords tolerates any string and every
  // emitted token is lowercase, length > 2, and word-char/hyphen only.
  test('extractWords never throws and every token is well-formed', () => {
    fc.assert(
      fc.property(fc.string(), text => {
        const words = extractWords(text)
        expect(Array.isArray(words)).toBe(true)
        for (const word of words) {
          expect(typeof word).toBe('string')
          expect(word.length).toBeGreaterThan(2)
          expect(word).toBe(word.toLowerCase())
          expect(/^[\w-]+$/.test(word)).toBe(true)
        }
      }),
    )
  })

  // ORACLE (derived-from-input): keepable words joined by single spaces
  // tokenize back to exactly those words. Constructed so the answer is known.
  test('extractWords round-trips space-joined keepable words', () => {
    fc.assert(
      fc.property(
        fc.array(keepableWord, { minLength: 0, maxLength: 8 }),
        words => {
          expect(extractWords(words.join(' '))).toEqual(words)
        },
      ),
    )
  })

  // RESTRICTED-INPUT: tokens of length <= 2 are always filtered out.
  test('extractWords drops all short (<=2 char) tokens', () => {
    fc.assert(
      fc.property(
        fc.array(droppedWord, { minLength: 1, maxLength: 8 }),
        shortWords => {
          expect(extractWords(shortWords.join(' '))).toEqual([])
        },
      ),
    )
  })

  // INVARIANT: Jaccard similarity is always within [0, 1].
  test('wordOverlap stays within [0, 1]', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string()),
        fc.array(fc.string()),
        (queryWords, commandWords) => {
          const score = wordOverlap(new Set(queryWords), commandWords)
          expect(score).toBeGreaterThanOrEqual(0)
          expect(score).toBeLessThanOrEqual(1)
        },
      ),
    )
  })

  // INVARIANT: a non-empty set scored against itself is a perfect 1.
  test('wordOverlap of a non-empty set against itself is 1', () => {
    fc.assert(
      fc.property(fc.array(fc.string(), { minLength: 1 }), words => {
        const set = new Set(words)
        expect(wordOverlap(set, [...set])).toBe(1)
      }),
    )
  })

  // RESTRICTED-INPUT: an empty query set overlaps nothing.
  test('wordOverlap with an empty query set is 0', () => {
    fc.assert(
      fc.property(fc.array(fc.string()), commandWords => {
        expect(wordOverlap(new Set(), commandWords)).toBe(0)
      }),
    )
  })

  // ORACLE: disjoint operands (a `q` prefix vs a `c` prefix guarantees no
  // shared token) have zero overlap when at least one side is non-empty.
  test('wordOverlap of disjoint operands is 0', () => {
    fc.assert(
      fc.property(
        fc.array(keepableWord, { minLength: 1, maxLength: 6 }),
        fc.array(keepableWord, { minLength: 1, maxLength: 6 }),
        (a, b) => {
          const querySet = new Set(a.map(w => `q_${w}`))
          const commandWords = b.map(w => `c_${w}`)
          expect(wordOverlap(querySet, commandWords)).toBe(0)
        },
      ),
    )
  })

  // INVARIANT: Jaccard similarity is symmetric in its two operands. Both sides
  // are SUT calls, so compute them into variables before comparing.
  test('wordOverlap is symmetric', () => {
    fc.assert(
      fc.property(fc.array(fc.string()), fc.array(fc.string()), (a, b) => {
        const setA = new Set(a)
        const setB = new Set(b)
        const ab = wordOverlap(setA, b)
        const ba = wordOverlap(setB, a)
        expect(ab).toBeCloseTo(ba)
      }),
    )
  })
})
