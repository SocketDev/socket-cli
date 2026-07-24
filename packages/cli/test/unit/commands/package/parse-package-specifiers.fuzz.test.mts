/**
 * @file Property/fuzz tests for commands/package/parse-package-specifiers
 *   (Tier-1 fast-check).
 *   `parsePackageSpecifiers` turns untrusted CLI args (an ecosystem token +
 *   package strings) into PURL strings plus a validity flag. Contract (read
 *   from source):
 *
 *   - never throws on any string input
 *   - every emitted purl string starts with `pkg:`
 *   - `valid === true` implies at least one purl was produced
 *   - an empty ecosystem is always invalid with no purls The oracle cases
 *     construct alpha-ecosystem inputs where the exact output is knowable
 *     without reimplementing the branchy parser.
 */

import fc from 'fast-check'
import { describe, expect, test } from 'vitest'

import { parsePackageSpecifiers } from '../../../../src/commands/package/parse-package-specifiers.mts'

// A pure-alpha ecosystem token (matches the /^[a-zA-Z]+$/ fast path).
const alphaEcosystem = fc
  .array(
    fc.constantFrom(
      ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''),
    ),
    { minLength: 1, maxLength: 8 },
  )
  .map(chars => chars.join(''))

// A non-empty package token that carries no `:` (so it can never accidentally
// start with the `pkg:` prefix) and no whitespace/control weirdness — makes the
// alpha-branch output `pkg:${eco}/${pkg}` exactly predictable.
const SAFE_PKG_CHARS =
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@/._-'

const safePkg = fc
  .array(fc.constantFrom(...SAFE_PKG_CHARS.split('')), {
    minLength: 1,
    maxLength: 20,
  })
  .map(chars => chars.join(''))

describe('commands/package/parse-package-specifiers (fuzz)', () => {
  // INVARIANT + never-throws: arbitrary ecosystem + package strings never throw
  // and every produced purl starts with `pkg:`.
  test('never throws and every emitted purl starts with pkg:', () => {
    fc.assert(
      fc.property(fc.string(), fc.array(fc.string()), (ecosystem, pkgs) => {
        const result = parsePackageSpecifiers(ecosystem, pkgs)
        expect(Array.isArray(result.purls)).toBe(true)
        expect(typeof result.valid).toBe('boolean')
        for (const purl of result.purls) {
          expect(typeof purl).toBe('string')
          expect(purl.startsWith('pkg:')).toBe(true)
        }
      }),
    )
  })

  // INVARIANT: a valid result must carry at least one purl (the parser flips
  // valid to false whenever it would otherwise return an empty list).
  test('valid results always contain at least one purl', () => {
    fc.assert(
      fc.property(fc.string(), fc.array(fc.string()), (ecosystem, pkgs) => {
        const result = parsePackageSpecifiers(ecosystem, pkgs)
        if (result.valid) {
          expect(result.purls.length).toBeGreaterThan(0)
        }
      }),
    )
  })

  // RESTRICTED-INPUT: an empty ecosystem is always invalid with no purls,
  // regardless of the package list.
  test('empty ecosystem is invalid with no purls', () => {
    fc.assert(
      fc.property(fc.array(fc.string()), pkgs => {
        const result = parsePackageSpecifiers('', pkgs)
        expect(result.valid).toBe(false)
        expect(result.purls).toEqual([])
      }),
    )
  })

  // ORACLE (derived-from-input): a pure-alpha ecosystem plus non-empty bare
  // package names yields exactly `pkg:${eco}/${pkg}` for each, and is valid.
  test('alpha ecosystem prefixes bare package names', () => {
    fc.assert(
      fc.property(
        alphaEcosystem,
        fc.array(safePkg, { minLength: 1, maxLength: 6 }),
        (ecosystem, pkgs) => {
          const expected = pkgs.map(pkg => `pkg:${ecosystem}/${pkg}`)
          const result = parsePackageSpecifiers(ecosystem, pkgs)
          expect(result.valid).toBe(true)
          expect(result.purls).toEqual(expected)
        },
      ),
    )
  })

  // ORACLE (restricted-input): package tokens already carrying a `pkg:` prefix
  // are kept verbatim under an alpha ecosystem.
  test('alpha ecosystem keeps already-prefixed pkg: tokens verbatim', () => {
    fc.assert(
      fc.property(
        alphaEcosystem,
        fc.array(safePkg, { minLength: 1, maxLength: 6 }),
        (ecosystem, bareNames) => {
          const pkgs = bareNames.map(name => `pkg:${ecosystem}/${name}`)
          const result = parsePackageSpecifiers(ecosystem, pkgs)
          expect(result.valid).toBe(true)
          expect(result.purls).toEqual(pkgs)
        },
      ),
    )
  })

  // RESTRICTED-INPUT: under an alpha ecosystem, any empty package token makes
  // the whole call invalid (the loop breaks on the first empty entry).
  test('alpha ecosystem with an empty package token is invalid', () => {
    fc.assert(
      fc.property(
        alphaEcosystem,
        fc.array(safePkg, { maxLength: 4 }),
        fc.array(safePkg, { maxLength: 4 }),
        (ecosystem, before, after) => {
          const pkgs = [...before, '', ...after]
          const result = parsePackageSpecifiers(ecosystem, pkgs)
          expect(result.valid).toBe(false)
        },
      ),
    )
  })
})
