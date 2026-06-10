/**
 * @file Unit tests for socket/sort-set-args.
 */

import { describe, test } from 'node:test'

import { RuleTester } from '../../../lib/rule-tester.mts'
import rule from '../index.mts'

describe('socket/sort-set-args', () => {
  test('valid + invalid cases', () => {
    new RuleTester().run('sort-set-args', rule, {
      valid: [
        {
          name: 'sorted Set literal',
          code: 'export const s = new Set(["alpha", "beta", "gamma"])\n',
        },
        {
          // Spread-built Sets have no orderable element + dedup regardless
          // of order, so they must not be flagged.
          name: 'spread elements are skipped',
          code: 'export const s = new Set([...a, ...b, ...c])\n',
        },
      ],
      invalid: [
        {
          name: 'unsorted Set literal',
          code: 'export const s = new Set(["gamma", "alpha", "beta"])\n',
          errors: [{ messageId: 'unsorted' }],
        },
        {
          // Mixed literal + non-literal: not auto-sortable, and the
          // raw-text order must NOT suppress the report (regression guard
          // for the dropped raw-text shortcut).
          name: 'mixed-type elements always flagged for manual sort',
          code: 'export const s = new Set(["alpha", foo, "beta"])\n',
          errors: [{ messageId: 'unsortedNoFix' }],
        },
      ],
    })
  })
})
