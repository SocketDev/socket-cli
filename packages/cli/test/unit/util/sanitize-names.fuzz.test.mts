/**
 * @file Property/fuzz tests for util/sanitize-names (Tier-1 fast-check).
 *   `sanitizeName` is an untrusted-input normalizer (repo/owner names from CLI
 *   args, git remotes, API payloads). Its contract (read from source):
 *
 *   - output contains only A-Za-z0-9._- characters
 *   - no run of 2+ special (._-) characters
 *   - no leading or trailing special character
 *   - length <= 100 Truncation to 100 happens AFTER the leading/trailing trim, so
 *     the structural invariants ("no trailing special", idempotence) only hold
 *     when no truncation occurs — the sanitized form of an input is never
 *     longer than the input, so bounding the input to <= 100 chars removes the
 *     truncation confound. never-throws + charset + length are asserted on
 *     unbounded input. `extractName` / `extractOwner` wrap `sanitizeName` with
 *     empty-input fallbacks; those fallbacks are asserted without importing the
 *     default constant (which would make a src value build the expected side).
 */

import fc from 'fast-check'
import { describe, expect, test } from 'vitest'

import {
  extractName,
  extractOwner,
  sanitizeName,
} from '../../../src/util/sanitize-names.mts'

// Characters that survive sanitizeName verbatim: alphanumerics carry no special
// meaning at all (they are never replaced, trimmed, or collapsed).
const ALNUM = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

const alnumWord = fc
  .array(fc.constantFrom(...ALNUM), { minLength: 1, maxLength: 60 })
  .map(chars => chars.join(''))

// Arbitrary input bounded so the sanitized form never exceeds 100 chars, which
// means the post-trim slice(0, 100) is a no-op and the structural invariants
// hold. The sanitized length is always <= input length.
const boundedString = fc.string({ maxLength: 100 })

describe('util/sanitize-names (fuzz)', () => {
  // INVARIANT + never-throws: any string in, a string out containing only the
  // allowed charset, capped at 100 chars.
  test('sanitizeName never throws and yields an allowed, capped string', () => {
    fc.assert(
      fc.property(fc.string(), name => {
        const result = sanitizeName(name)
        expect(typeof result).toBe('string')
        expect(result.length).toBeLessThanOrEqual(100)
        expect(/^[A-Za-z0-9._-]*$/.test(result)).toBe(true)
      }),
    )
  })

  // INVARIANT: the collapse step guarantees no run of 2+ special chars. This
  // holds even under truncation since truncation only removes characters.
  test('sanitizeName never emits a run of 2+ special characters', () => {
    fc.assert(
      fc.property(fc.string(), name => {
        expect(/[._-]{2,}/.test(sanitizeName(name))).toBe(false)
      }),
    )
  })

  // INVARIANT (structural, bounded to avoid the truncation confound): no
  // leading or trailing special character.
  test('sanitizeName has no leading/trailing special char (no truncation)', () => {
    fc.assert(
      fc.property(boundedString, name => {
        const result = sanitizeName(name)
        if (result.length > 0) {
          expect(/^[._-]/.test(result)).toBe(false)
          expect(/[._-]$/.test(result)).toBe(false)
        }
      }),
    )
  })

  // IDEMPOTENCE: re-sanitizing an already-sanitized (non-truncated) name is a
  // no-op. Bounded input avoids the truncation case where a trailing special
  // char could survive the first pass and be trimmed on the second.
  test('sanitizeName is idempotent for non-truncated input', () => {
    fc.assert(
      fc.property(boundedString, name => {
        const once = sanitizeName(name)
        expect(sanitizeName(once)).toBe(once)
      }),
    )
  })

  // RESTRICTED-INPUT / round-trip: a purely-alphanumeric name (<= 100 chars)
  // has nothing to sanitize and passes through verbatim. Constructed so the
  // expected value is known without reimplementing the SUT.
  test('sanitizeName is the identity on alphanumeric-only names', () => {
    fc.assert(
      fc.property(alnumWord, word => {
        expect(sanitizeName(word)).toBe(word)
      }),
    )
  })

  // extractName never returns an empty string, and when sanitizeName produces a
  // non-empty value extractName returns exactly that (the fallback only fires
  // on empty). The default-repo fallback is asserted structurally (non-empty)
  // rather than by importing the constant.
  test('extractName is non-empty and passes through non-empty sanitized names', () => {
    fc.assert(
      fc.property(fc.string(), name => {
        const extracted = extractName(name)
        expect(typeof extracted).toBe('string')
        expect(extracted.length).toBeGreaterThan(0)
        const sanitized = sanitizeName(name)
        if (sanitized.length > 0) {
          expect(extracted).toBe(sanitized)
        }
      }),
    )
  })

  // extractOwner returns undefined exactly when the sanitized owner is empty,
  // otherwise the sanitized value.
  test('extractOwner returns undefined iff the sanitized owner is empty', () => {
    fc.assert(
      fc.property(fc.string(), owner => {
        const extracted = extractOwner(owner)
        const sanitized = sanitizeName(owner)
        if (sanitized.length === 0) {
          expect(extracted).toBeUndefined()
        } else {
          expect(extracted).toBe(sanitized)
        }
      }),
    )
  })
})
