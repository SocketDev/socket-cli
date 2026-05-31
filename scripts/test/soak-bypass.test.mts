// node --test specs for scripts/soak-bypass.mts.
//
// Covers the pure parts: spec parsing (incl. scoped names), the +7d
// removable-date math, and the YAML splice (append to an existing block,
// create the block from the anchor, idempotent skip, annotation shape).
// The npm-fetch path is exercised via the live CLI, not unit-tested.

import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { addDaysISO, parseSpec, spliceSoakEntry } from '../soak-bypass.mts'

describe('soak-bypass / parseSpec', () => {
  test('splits a plain name@version', () => {
    assert.deepEqual(parseSpec('compromise@14.15.1'), {
      name: 'compromise',
      version: '14.15.1',
    })
  })

  test('splits a scoped name@version', () => {
    assert.deepEqual(parseSpec('@redwoodjs/agent-ci@0.16.2'), {
      name: '@redwoodjs/agent-ci',
      version: '0.16.2',
    })
  })

  test('rejects missing version / bare scope', () => {
    assert.equal(parseSpec('compromise'), undefined)
    assert.equal(parseSpec('@scope/pkg'), undefined)
    assert.equal(parseSpec(''), undefined)
  })
})

describe('soak-bypass / addDaysISO', () => {
  test('adds 7 days', () => {
    assert.equal(addDaysISO('2026-05-22T16:47:56.000Z', 7), '2026-05-29')
  })

  test('crosses a month boundary', () => {
    assert.equal(addDaysISO('2026-05-27T19:14:27.000Z', 7), '2026-06-03')
  })
})

const SPEC = { name: 'compromise', version: '14.15.1' }

describe('soak-bypass / spliceSoakEntry', () => {
  test('appends annotation + bullet to an existing block', () => {
    const yaml = `minimumReleaseAge: 10080
minimumReleaseAgeExclude:
  - '@socketsecurity/*'

catalog:
  x: 1.0.0
`
    const out = spliceSoakEntry(yaml, SPEC, '2026-05-27', '2026-06-03')!
    assert.match(
      out,
      /# published: 2026-05-27 \| removable: 2026-06-03\n {2}- 'compromise@14\.15\.1'/,
    )
    // Inserted inside the block, before the blank line + catalog.
    assert.ok(out.indexOf('compromise@14.15.1') < out.indexOf('catalog:'))
    // Existing entry preserved.
    assert.ok(out.includes("- '@socketsecurity/*'"))
  })

  test('creates the block from the minimumReleaseAge anchor when absent', () => {
    const yaml = `trustPolicy: no-downgrade
minimumReleaseAge: 10080

catalog:
  x: 1.0.0
`
    const out = spliceSoakEntry(yaml, SPEC, '2026-05-27', '2026-06-03')!
    assert.match(out, /minimumReleaseAge: 10080\nminimumReleaseAgeExclude:\n/)
    assert.ok(out.includes("- 'compromise@14.15.1'"))
  })

  test('is idempotent when the exact tag is already present', () => {
    const yaml = `minimumReleaseAge: 10080
minimumReleaseAgeExclude:
  - 'compromise@14.15.1'
`
    assert.equal(spliceSoakEntry(yaml, SPEC, '2026-05-27', '2026-06-03'), yaml)
  })

  test('returns undefined with no minimumReleaseAge anchor', () => {
    const yaml = `catalog:\n  x: 1.0.0\n`
    assert.equal(
      spliceSoakEntry(yaml, SPEC, '2026-05-27', '2026-06-03'),
      undefined,
    )
  })
})
