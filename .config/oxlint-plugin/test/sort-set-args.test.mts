/**
 * @fileoverview Unit tests for socket/sort-set-args.
 */

import { describe, test } from 'node:test'

import { RuleTester } from '../lib/rule-tester.mts'
import rule from '../rules/sort-set-args.mts'

describe('socket/sort-set-args', () => {
  test('valid + invalid cases', () => {
    new RuleTester().run('sort-set-args', rule, {
      valid: [
        {
          name: 'sorted Set literal',
          code: 'export const s = new Set(["alpha", "beta", "gamma"])\n',
        },
      ],
      invalid: [
        {
          name: 'unsorted Set literal',
          code: 'export const s = new Set(["gamma", "alpha", "beta"])\n',
          errors: [{ messageId: 'unsorted' }],
        },
      ],
    })
  })
})
