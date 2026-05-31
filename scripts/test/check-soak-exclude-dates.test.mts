// node --test specs for scripts/check-soak-exclude-dates.mts.
//
// Covers the pure `scan` (missing / stale detection) and the `--fix`
// promote helper `removeStaleEntries`, which the daily `updating-daily`
// job runs to drop soak-exclude entries whose `removable:` date has
// passed. The promote helper must remove the bullet AND its annotation
// comment while leaving every other entry + comment verbatim.

import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { removeStaleEntries, scan } from '../check-soak-exclude-dates.mts'

const YAML = `minimumReleaseAge: 10080
minimumReleaseAgeExclude:
  - '@socketsecurity/*'
  # published: 2026-05-01 | removable: 2026-05-08
  - 'old-pkg@1.0.0'
  # published: 2026-05-25 | removable: 2026-06-01
  - 'fresh-pkg@2.0.0'
  - 'bare-name'

catalog:
  'x': 1.0.0
`

describe('check-soak-exclude-dates / scan', () => {
  test('flags a stale entry (removable in the past)', () => {
    const stale = scan(YAML, '2026-05-20').filter(f => f.kind === 'stale')
    assert.equal(stale.length, 1)
    assert.equal(stale[0]!.name, 'old-pkg')
    assert.equal(stale[0]!.version, '1.0.0')
  })

  test('does not flag a not-yet-soaked entry', () => {
    // On 2026-05-20, fresh-pkg (removable 2026-06-01) is still active.
    const names = scan(YAML, '2026-05-20')
      .filter(f => f.kind === 'stale')
      .map(f => f.name)
    assert.ok(!names.includes('fresh-pkg'))
  })

  test('bare names + globs are not date-checked', () => {
    const all = scan(YAML, '2026-12-31')
    assert.ok(!all.some(f => f.name === 'bare-name'))
    assert.ok(!all.some(f => f.name === '@socketsecurity/*'))
  })
})

describe('check-soak-exclude-dates / removeStaleEntries', () => {
  test('removes the stale bullet + its annotation, keeps the rest', () => {
    const stale = scan(YAML, '2026-05-20').filter(f => f.kind === 'stale')
    const out = removeStaleEntries(YAML, stale)
    // old-pkg + its annotation gone.
    assert.ok(!out.includes('old-pkg@1.0.0'))
    assert.ok(!out.includes('removable: 2026-05-08'))
    // fresh-pkg + its annotation + bare-name + glob preserved verbatim.
    assert.ok(out.includes("- 'fresh-pkg@2.0.0'"))
    assert.ok(out.includes('removable: 2026-06-01'))
    assert.ok(out.includes("- 'bare-name'"))
    assert.ok(out.includes("- '@socketsecurity/*'"))
    // Unrelated blocks untouched.
    assert.ok(out.includes("'x': 1.0.0"))
  })

  test('no-op when nothing is stale', () => {
    assert.equal(removeStaleEntries(YAML, []), YAML)
  })

  test('removes multiple stale entries in one pass', () => {
    const everythingStale = scan(YAML, '2026-12-31').filter(
      f => f.kind === 'stale',
    )
    // Both dated entries are now past removable.
    assert.equal(everythingStale.length, 2)
    const out = removeStaleEntries(YAML, everythingStale)
    assert.ok(!out.includes('old-pkg@1.0.0'))
    assert.ok(!out.includes('fresh-pkg@2.0.0'))
    assert.ok(!out.includes('removable: 2026-05-08'))
    assert.ok(!out.includes('removable: 2026-06-01'))
    // Bare + glob survive.
    assert.ok(out.includes("- 'bare-name'"))
  })
})
